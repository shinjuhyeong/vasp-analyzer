"""Smoke-test the force-installed wheel outside the repository working tree."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


class InstalledWheelSmokeError(RuntimeError):
    """The installed wheel command surface failed its release smoke."""


_CURATED_POSCAR = """installed-wheel fixture
1
3 0 0
0 3 0
0 0 3
H
2
Direct
0 0 0
0.5 0.5 0.5
"""


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_normalizer_cli_outputs(
    listed: object,
    validated: object,
    tested: object,
    *,
    candidate_id: str,
    source_sha256: str,
) -> None:
    if not isinstance(listed, dict) or listed.get("schemaVersion") != 1:
        raise InstalledWheelSmokeError("installed normalizer list returned invalid JSON")
    entries = listed.get("normalizers")
    if not isinstance(entries, list):
        raise InstalledWheelSmokeError("installed normalizer list omitted resources")
    built_ins = {
        item.get("id")
        for item in entries
        if isinstance(item, dict) and item.get("builtIn") is True
    }
    if built_ins != {"home-barrier", "standard"}:
        raise InstalledWheelSmokeError("installed normalizer list omitted packaged resources")
    if (
        not isinstance(validated, dict)
        or validated.get("valid") is not True
        or validated.get("id") != candidate_id
        or validated.get("schemaVersion") != 1
    ):
        raise InstalledWheelSmokeError("installed normalizer validate was not wired")
    summary = tested.get("summary") if isinstance(tested, dict) else None
    manifest = tested.get("manifest") if isinstance(tested, dict) else None
    if (
        tested.get("schemaVersion") != 1
        or tested.get("sourceHashVerified") is not True
        or tested.get("temporaryCleaned") is not True
        or not isinstance(summary, dict)
        or summary.get("adapter") != "vaspparser"
        or summary.get("ionicSteps") != 1
        or summary.get("atomCount") != 2
        or not isinstance(manifest, dict)
        or manifest.get("normalizerId") != candidate_id
        or manifest.get("sourceSha256") != source_sha256
    ):
        raise InstalledWheelSmokeError("installed normalizer test was not safely wired")


def validate_stdio_output(
    output: str,
    *,
    expect_initial_structure: bool,
    expected_steps: int | None = None,
) -> None:
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) != 1:
        raise InstalledWheelSmokeError("installed stdio smoke returned an invalid envelope")
    try:
        envelope = json.loads(lines[0])
    except json.JSONDecodeError:
        raise InstalledWheelSmokeError(
            "installed stdio smoke returned invalid JSON"
        ) from None
    if not isinstance(envelope, dict) or "error" in envelope:
        raise InstalledWheelSmokeError("installed stdio smoke returned an error")
    result = envelope.get("result") if isinstance(envelope, dict) else None
    if not isinstance(result, dict) or result.get("schemaVersion") != 4:
        raise InstalledWheelSmokeError("installed stdio smoke did not return schema 4")
    provenance = result.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("adapter") != "vaspparser":
        raise InstalledWheelSmokeError(
            "installed stdio smoke did not use the authoritative vaspparser adapter"
        )
    ionic_steps = result.get("ionicSteps")
    if not isinstance(ionic_steps, list) or not ionic_steps:
        raise InstalledWheelSmokeError(
            "installed stdio smoke did not return step-1 SCF iterations"
        )
    if expected_steps is not None and len(ionic_steps) != expected_steps:
        raise InstalledWheelSmokeError(
            f"installed stdio smoke did not return {expected_steps} ionic steps"
        )
    if any(
        not isinstance(step, dict) or step.get("scfIterations") is None
        for step in ionic_steps
    ):
        raise InstalledWheelSmokeError(
            "installed stdio smoke did not return SCF iterations for every step"
        )
    initial_structure = result.get("initialStructure")
    if expect_initial_structure:
        if (
            not isinstance(initial_structure, dict)
            or initial_structure.get("source") != "POSCAR"
        ):
            raise InstalledWheelSmokeError(
                "installed stdio smoke did not return the POSCAR initial structure"
            )
    elif "initialStructure" not in result or initial_structure is not None:
        raise InstalledWheelSmokeError(
            "installed stdio smoke returned Initial data for an OUTCAR-only calculation"
        )


def validate_no_browser_result(returncode: int, output: str) -> None:
    lowered = output.lower()
    if (
        returncode == 0
        or "vs code extension handoff unavailable" not in lowered
        or "explicit browser mode" not in lowered
        or "http://" in lowered
        or "https://" in lowered
    ):
        raise InstalledWheelSmokeError(
            "installed default command did not preserve the no-browser handoff failure"
        )


def _run_console(
    console: Path,
    arguments: list[str],
    *,
    cwd: Path,
    input_text: str | None = None,
    environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(console), *arguments],
        cwd=cwd,
        input=input_text,
        capture_output=True,
        text=True,
        env=environment,
        check=False,
        timeout=60,
    )


def verify_installed_wheel(
    fixture: Path, audit_outcars: tuple[tuple[Path, int], ...] = ()
) -> None:
    fixture = fixture.resolve()
    if not fixture.is_file():
        raise InstalledWheelSmokeError("installed-wheel fixture is unavailable")
    with tempfile.TemporaryDirectory(prefix="vasp-analyzer-installed-") as temp:
        root = Path(temp)
        with_poscar = root / "with-poscar"
        without_poscar = root / "without-poscar"
        with_poscar.mkdir()
        without_poscar.mkdir()
        for calculation in (with_poscar, without_poscar):
            shutil.copyfile(fixture, calculation / "OUTCAR")
        (with_poscar / "POSCAR").write_text(_CURATED_POSCAR, encoding="utf-8")

        location = subprocess.run(
            [
                sys.executable,
                "-I",
                "-c",
                "import vasp_analyzer; print(vasp_analyzer.__file__)",
            ],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        normalized_location = location.stdout.strip().replace("\\", "/").lower()
        if location.returncode or not any(
            segment in normalized_location
            for segment in ("/site-packages/", "/dist-packages/")
        ):
            raise InstalledWheelSmokeError(
                "isolated invocation did not import the installed wheel"
            )

        console = Path(sys.executable).parent / (
            "analyzer.exe" if os.name == "nt" else "analyzer"
        )
        if not console.is_file():
            raise InstalledWheelSmokeError("installed analyzer entrypoint is unavailable")
        help_result = subprocess.run(
            [str(console), "--help"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        if help_result.returncode or "Usage:" not in help_result.stdout:
            raise InstalledWheelSmokeError("installed CLI help smoke failed")

        isolated_config = root / "config"
        environment = dict(os.environ)
        environment["XDG_CONFIG_HOME"] = str(isolated_config)
        candidate_id = "installed-wheel-candidate"
        candidate = root / "candidate.json"
        candidate.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "id": candidate_id,
                    "displayName": "Installed Wheel Candidate",
                    "priority": 50,
                    "detect": {"all": ["VRHFIN"], "any": [], "none": []},
                    "rules": [],
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        normalizer_source = without_poscar / "OUTCAR"
        source_before = _sha256(normalizer_source)
        temporary_before = set(
            Path(tempfile.gettempdir()).glob("vasp-analyzer-normalized-*")
        )
        normalizer_results = []
        for arguments in (
            ["normalizer", "list"],
            ["normalizer", "list"],
            ["normalizer", "validate", str(candidate)],
            ["normalizer", "test", str(candidate), str(normalizer_source)],
        ):
            result = _run_console(
                console,
                arguments,
                cwd=root,
                environment=environment,
            )
            if result.returncode:
                raise InstalledWheelSmokeError(
                    f"installed {' '.join(arguments[:2])} command failed"
                )
            try:
                normalizer_results.append(json.loads(result.stdout))
            except json.JSONDecodeError:
                raise InstalledWheelSmokeError(
                    "installed normalizer command returned invalid JSON"
                ) from None
        if normalizer_results[0] != normalizer_results[1]:
            raise InstalledWheelSmokeError(
                "installed normalizer list output is not deterministic"
            )
        validate_normalizer_cli_outputs(
            normalizer_results[0],
            normalizer_results[2],
            normalizer_results[3],
            candidate_id=candidate_id,
            source_sha256=source_before,
        )
        if _sha256(normalizer_source) != source_before:
            raise InstalledWheelSmokeError("installed normalizer test changed its source")
        temporary_after = set(
            Path(tempfile.gettempdir()).glob("vasp-analyzer-normalized-*")
        )
        if temporary_after != temporary_before:
            raise InstalledWheelSmokeError(
                "installed normalizer test leaked temporary output"
            )

        request = '{"id":1,"method":"getDataset","params":{}}\n'
        for calculation, expect_initial_structure in (
            (with_poscar, True),
            (without_poscar, False),
        ):
            stdio_result = _run_console(
                console,
                ["serve", "--stdio", str(calculation / "OUTCAR")],
                cwd=root,
                input_text=request,
            )
            if stdio_result.returncode:
                raise InstalledWheelSmokeError("installed stdio command smoke failed")
            validate_stdio_output(
                stdio_result.stdout,
                expect_initial_structure=expect_initial_structure,
            )

        for index, (audit_source, expected_steps) in enumerate(audit_outcars):
            audit_source = audit_source.resolve()
            if not audit_source.is_file():
                raise InstalledWheelSmokeError("installed-wheel audit OUTCAR is unavailable")
            audit_calculation = root / f"audit-{index}"
            audit_calculation.mkdir()
            shutil.copyfile(audit_source, audit_calculation / "OUTCAR")
            audit_result = _run_console(
                console,
                ["serve", "--stdio", str(audit_calculation / "OUTCAR")],
                cwd=root,
                input_text=request,
            )
            if audit_result.returncode:
                raise InstalledWheelSmokeError("installed audit stdio command failed")
            validate_stdio_output(
                audit_result.stdout,
                expect_initial_structure=False,
                expected_steps=expected_steps,
            )

        environment = dict(os.environ)
        environment.pop("VASP_ANALYZER_ENDPOINT", None)
        environment.pop("VASP_ANALYZER_TOKEN", None)
        default_result = _run_console(
            console,
            [str(without_poscar / "OUTCAR")],
            cwd=root,
            environment=environment,
        )
        validate_no_browser_result(
            default_result.returncode,
            default_result.stdout + default_result.stderr,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument(
        "--audit-outcar",
        action="append",
        default=[],
        metavar=("PATH", "STEPS"),
        nargs=2,
    )
    args = parser.parse_args()
    audits = tuple((Path(path), int(steps)) for path, steps in args.audit_outcar)
    verify_installed_wheel(args.fixture, audits)
    print("installed wheel CLI, stdio, and no-browser smokes passed")


if __name__ == "__main__":
    main()
