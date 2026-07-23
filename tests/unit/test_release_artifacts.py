import hashlib
import json
from pathlib import PurePosixPath

import pytest

from scripts.verify_release_artifacts import (
    ReleaseVerificationError,
    require_archive_assets,
    validate_runtime_url_policy,
    verify_webview_schema_contract,
)


@pytest.mark.parametrize(
    ("kind", "members"),
    [
        ("wheel", {"vasp_analyzer/web_assets/index.js"}),
        (
            "sdist",
            {
                "vasp-analyzer/vscode/dist/webview/index.js",
            },
        ),
        (
            "vsix",
            {
                "extension/dist/extension.cjs",
                "extension/dist/webview/index.js",
            },
        ),
    ],
)
def test_release_assets_reject_missing_required_css_or_entrypoints(
    kind: str, members: set[str]
) -> None:
    with pytest.raises(ReleaseVerificationError, match="missing"):
        require_archive_assets(kind, members)


def test_release_assets_accept_complete_kind_specific_surfaces() -> None:
    require_archive_assets(
        "wheel",
        {
            "vasp_analyzer/web_assets/index.js",
            "vasp_analyzer/web_assets/index.css",
            "vasp_analyzer/web_assets/contract.json",
        },
    )
    require_archive_assets(
        "sdist",
        {
            "vasp-analyzer/vscode/dist/webview/index.js",
            "vasp-analyzer/vscode/dist/webview/index.css",
            "vasp-analyzer/vscode/dist/webview/contract.json",
        },
    )
    require_archive_assets(
        "vsix",
        {
            "extension/dist/extension.cjs",
            "extension/dist/webview/index.js",
            "extension/dist/webview/index.css",
            "extension/dist/webview/contract.json",
        },
    )


def test_packaged_runtime_url_policy_rejects_application_external_endpoint() -> None:
    surfaces = {
        PurePosixPath("extension/dist/extension.cjs"): (
            'const api = "https://example.invalid/runtime"; '
            "const csp = \"connect-src 'none'\";"
        ),
    }

    with pytest.raises(ReleaseVerificationError, match="forbidden runtime URL"):
        validate_runtime_url_policy(surfaces)


def test_packaged_runtime_url_policy_allows_only_scoped_loopback_and_vendor_literals() -> None:
    surfaces = {
        PurePosixPath("vasp_analyzer/transport/web.py"): (
            'url = f"http://127.0.0.1:{port}"\n'
            'CSP = "connect-src \'self\'"'
        ),
        PurePosixPath("extension/dist/extension.cjs"): (
            "const csp = \"connect-src 'none'\";"
        ),
        PurePosixPath("extension/dist/webview/index.js"): (
            "// https://github.com/kosua20/Rendu\n"
            'const namespace = "http://www.w3.org/2000/svg";'
        ),
        PurePosixPath("extension/dist/webview/index.css"): "body{}",
    }

    validate_runtime_url_policy(surfaces)


def test_packaged_runtime_url_policy_does_not_allow_loopback_in_extension_code() -> None:
    surfaces = {
        PurePosixPath("extension/dist/extension.cjs"): (
            'const endpoint = "http://127.0.0.1:8000"; '
            "const csp = \"connect-src 'none'\";"
        ),
    }

    with pytest.raises(ReleaseVerificationError, match="forbidden runtime URL"):
        validate_runtime_url_policy(surfaces)


@pytest.mark.parametrize(
    "source",
    [
        'const api = "//example.invalid/runtime";',
        'const api = "https:" + "//example.invalid/runtime";',
        'const api = "ht" + "tps://example.invalid/runtime";',
    ],
)
def test_packaged_runtime_url_policy_rejects_constructed_external_endpoints(
    source: str,
) -> None:
    surfaces = {
        PurePosixPath("extension/dist/extension.cjs"): (
            source + "const csp = \"connect-src 'none'\";"
        ),
    }

    with pytest.raises(ReleaseVerificationError, match="forbidden runtime URL"):
        validate_runtime_url_policy(surfaces)


def _schema_surfaces(index: str, schema_version: int = 2):
    return {
        PurePosixPath("extension/dist/webview/index.js"): index,
        PurePosixPath("extension/dist/webview/contract.json"): json.dumps(
            {
                "schemaVersion": schema_version,
                "webviewSha256": hashlib.sha256(index.encode()).hexdigest(),
            }
        ),
    }


def test_packaged_webview_schema_contract_accepts_bound_schema_3_bundle() -> None:
    verify_webview_schema_contract(_schema_surfaces("schemaVersion!==4", schema_version=4))


def test_packaged_webview_schema_contract_rejects_mutated_bundle() -> None:
    surfaces = _schema_surfaces("schemaVersion!==4", schema_version=4)
    surfaces[PurePosixPath("extension/dist/webview/index.js")] = "schemaVersion!==2"

    with pytest.raises(ReleaseVerificationError, match="fingerprint"):
        verify_webview_schema_contract(surfaces)


def test_packaged_webview_schema_contract_rejects_schema_2_manifest() -> None:
    with pytest.raises(ReleaseVerificationError, match="schema 4"):
        verify_webview_schema_contract(
            _schema_surfaces("schemaVersion!==2", schema_version=2)
        )
