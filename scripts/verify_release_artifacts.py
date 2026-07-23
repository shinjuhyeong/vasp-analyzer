"""Deterministic inspection of built VASP Analyzer release artifacts."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
import sys
import tarfile
import warnings
import zipfile
from collections.abc import Mapping, Set
from pathlib import Path, PurePosixPath

_RUNTIME_SUFFIXES = {".py", ".js", ".cjs", ".css", ".html", ".json"}
_URL_PATTERN = re.compile(r"https?://[^\s\"'<>`\\]+")
_PROTOCOL_RELATIVE_PATTERN = re.compile(
    r"(?<!:)//(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:[/:?#][^\s\"'<>`\\]*)?"
)
_JS_STRING_PATTERN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'')
# 3Dmol's bundled code retains attribution/namespace strings and unused remote-loader
# endpoints. The application never calls those loaders, and both shipped CSPs block
# their external connections. Pinning the exact literals makes dependency drift fail.
_CSP_BLOCKED_VENDOR_URLS = {
    "//mmtf.rcsb.org/v1.0/",
    "http://mrl.nyu.edu/~dzorin/cg05/lecture12.pdf",
    "http://stackoverflow.com/questions/9595300/cylinder-impostor-in-glsl",
    "http://www.w3.org/1998/Math/MathML",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/XML/1998/namespace",
    "https://files.rcsb.org/view/",
    "https://github.com/kosua20/Rendu",
    "https://github.com/molstar/molstar/blob/master/src/mol-gl/shader/fxaa.frag.ts",
    "https://models.rcsb.org/",
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/",
    "https://react.dev/errors/",
}


class ReleaseVerificationError(RuntimeError):
    """A built artifact does not satisfy the offline release contract."""


def require_archive_assets(kind: str, members: Set[str]) -> None:
    """Require the runtime assets applicable to one archive kind."""

    exact = {
        "wheel": {
            "vasp_analyzer/web_assets/index.js",
            "vasp_analyzer/web_assets/index.css",
            "vasp_analyzer/web_assets/contract.json",
        },
        "vsix": {
            "extension/dist/extension.cjs",
            "extension/dist/webview/index.js",
            "extension/dist/webview/index.css",
            "extension/dist/webview/contract.json",
        },
    }
    if kind == "sdist":
        suffixes = {
            "/vscode/dist/webview/index.js",
            "/vscode/dist/webview/index.css",
            "/vscode/dist/webview/contract.json",
        }
        missing = sorted(
            suffix for suffix in suffixes if not any(name.endswith(suffix) for name in members)
        )
    elif kind in exact:
        missing = sorted(exact[kind] - set(members))
    else:
        raise ReleaseVerificationError(f"unknown archive kind {kind!r}")
    if missing:
        raise ReleaseVerificationError(
            f"{kind} is missing required runtime assets: {', '.join(missing)}"
        )


def _normalized_url(value: str) -> str:
    return value.rstrip("),.;")


def _decoded_js_string(token: str) -> str | None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            value = ast.literal_eval(token)
    except (SyntaxError, ValueError):
        return None
    return value if isinstance(value, str) else None


def _constructed_js_urls(text: str) -> set[str]:
    """Find protocol-relative literals and endpoints assembled by literal `+`."""

    found: set[str] = set()
    previous_end: int | None = None
    chain = ""
    chain_length = 0
    for match in _JS_STRING_PATTERN.finditer(text):
        value = _decoded_js_string(match.group())
        if value is None:
            previous_end = None
            chain = ""
            chain_length = 0
            continue
        found.update(_PROTOCOL_RELATIVE_PATTERN.findall(value))
        joins_previous = previous_end is not None and re.fullmatch(
            r"\s*\+\s*", text[previous_end : match.start()]
        )
        if joins_previous:
            chain += value
            chain_length += 1
        else:
            chain = value
            chain_length = 1
        if chain_length > 1:
            found.update(_URL_PATTERN.findall(chain))
            found.update(_PROTOCOL_RELATIVE_PATTERN.findall(chain))
        previous_end = match.end()
    return found


def _runtime_urls(path: PurePosixPath, text: str) -> set[str]:
    urls = set(_URL_PATTERN.findall(text))
    if path.suffix in {".js", ".cjs"}:
        urls.update(_constructed_js_urls(text))
    return urls


def validate_runtime_url_policy(
    surfaces: Mapping[PurePosixPath, str],
) -> None:
    """Reject endpoints except scoped loopback and CSP-blocked vendored literals."""

    has_external_vendor_literal = False
    for path, text in surfaces.items():
        normalized_path = path.as_posix()
        for match in _runtime_urls(path, text):
            url = _normalized_url(match)
            allowed = False
            if normalized_path.endswith("vasp_analyzer/transport/web.py"):
                allowed = url == "http://127.0.0.1:{port}"
            elif normalized_path.endswith("/webview/index.js") or normalized_path.endswith(
                "/web_assets/index.js"
            ):
                allowed = url in _CSP_BLOCKED_VENDOR_URLS
                has_external_vendor_literal |= allowed
            if not allowed:
                raise ReleaseVerificationError(
                    f"forbidden runtime URL in {normalized_path}: {url}"
                )

    if has_external_vendor_literal:
        csp_text = "\n".join(
            text
            for path, text in surfaces.items()
            if path.as_posix().endswith("vasp_analyzer/transport/web.py")
            or path.as_posix().endswith("/extension/dist/extension.cjs")
        )
        if "connect-src 'self'" not in csp_text and "connect-src 'none'" not in csp_text:
            raise ReleaseVerificationError(
                "vendored URL literals require a packaged connect-src CSP boundary"
            )


def verify_webview_schema_contract(
    surfaces: Mapping[PurePosixPath, str],
) -> None:
    """Verify a schema-4 manifest cryptographically bound to packaged Webview JS."""

    index_entries = [
        text
        for path, text in surfaces.items()
        if path.as_posix().endswith("/webview/index.js")
        or path.as_posix().endswith("/web_assets/index.js")
    ]
    manifest_entries = [
        text
        for path, text in surfaces.items()
        if path.as_posix().endswith("/webview/contract.json")
        or path.as_posix().endswith("/web_assets/contract.json")
    ]
    if len(index_entries) != 1 or len(manifest_entries) != 1:
        raise ReleaseVerificationError("archive must contain one Webview schema contract")
    try:
        manifest = json.loads(manifest_entries[0])
    except json.JSONDecodeError:
        raise ReleaseVerificationError("Webview schema contract is invalid JSON") from None
    if not isinstance(manifest, dict) or set(manifest) != {
        "schemaVersion",
        "webviewSha256",
    }:
        raise ReleaseVerificationError("Webview schema contract has invalid fields")
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 4:
        raise ReleaseVerificationError("Webview contract must require schema 4")
    fingerprint = hashlib.sha256(index_entries[0].encode("utf-8")).hexdigest()
    if manifest["webviewSha256"] != fingerprint:
        raise ReleaseVerificationError("Webview bundle fingerprint does not match contract")


def _is_runtime_surface(kind: str, name: str) -> bool:
    path = PurePosixPath(name)
    if path.suffix not in _RUNTIME_SUFFIXES:
        return False
    if kind == "wheel":
        return name.startswith("vasp_analyzer/")
    if kind == "vsix":
        return name.startswith("extension/dist/")
    return "/src/vasp_analyzer/" in name or "/vscode/dist/" in name


def _read_zip_surfaces(
    path: Path, kind: str
) -> tuple[set[str], dict[PurePosixPath, str]]:
    with zipfile.ZipFile(path) as archive:
        members = set(archive.namelist())
        surfaces = {
            PurePosixPath(kind, name): archive.read(name).decode("utf-8")
            for name in members
            if _is_runtime_surface(kind, name)
        }
    return members, surfaces


def _read_sdist_surfaces(
    path: Path,
) -> tuple[set[str], dict[PurePosixPath, str]]:
    with tarfile.open(path) as archive:
        members = {member.name for member in archive.getmembers() if member.isfile()}
        surfaces: dict[PurePosixPath, str] = {}
        for name in members:
            if not _is_runtime_surface("sdist", name):
                continue
            extracted = archive.extractfile(name)
            if extracted is None:
                raise ReleaseVerificationError(f"sdist member could not be read: {name}")
            surfaces[PurePosixPath("sdist", name)] = extracted.read().decode("utf-8")
    return members, surfaces


def verify_wheel_schema_contract(wheel: Path) -> None:
    """Exercise schema 4 acceptance/rejection from the archived wheel runtime."""

    code = """
import sys
sys.path.insert(0, sys.argv[1])
import vasp_analyzer
from vasp_analyzer.core import CalculationDataset
payload = {
    "schemaVersion": 4,
    "root": "/calculation",
    "sourceFiles": [],
    "sites": [],
    "initialStructure": None,
    "ionicSteps": [],
    "parameters": [],
    "capabilities": [],
}
dataset = CalculationDataset.model_validate(payload)
assert dataset.model_dump(mode="json", by_alias=True)["schemaVersion"] == 4
try:
    CalculationDataset.model_validate({**payload, "schemaVersion": 2})
except Exception:
    pass
else:
    raise AssertionError("schema 2 payload was accepted")
assert sys.argv[1] in vasp_analyzer.__file__
"""
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(wheel.resolve())],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise ReleaseVerificationError(
            "archived wheel schema 4 runtime contract failed"
        ) from None


def verify_release_artifacts(wheel: Path, sdist: Path, vsix: Path) -> None:
    wheel_members, wheel_surfaces = _read_zip_surfaces(wheel, "wheel")
    sdist_members, sdist_surfaces = _read_sdist_surfaces(sdist)
    vsix_members, vsix_surfaces = _read_zip_surfaces(vsix, "vsix")
    require_archive_assets("wheel", wheel_members)
    require_archive_assets("sdist", sdist_members)
    require_archive_assets("vsix", vsix_members)
    validate_runtime_url_policy(wheel_surfaces)
    validate_runtime_url_policy(sdist_surfaces)
    validate_runtime_url_policy(vsix_surfaces)
    verify_webview_schema_contract(wheel_surfaces)
    verify_webview_schema_contract(sdist_surfaces)
    verify_webview_schema_contract(vsix_surfaces)
    verify_wheel_schema_contract(wheel)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--sdist", type=Path, required=True)
    parser.add_argument("--vsix", type=Path, required=True)
    args = parser.parse_args()
    verify_release_artifacts(args.wheel, args.sdist, args.vsix)
    print("release artifact contracts passed")


if __name__ == "__main__":
    main()
