"""Smoke-test the force-installed wheel outside the repository working tree."""

from __future__ import annotations

import argparse
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
    if not isinstance(result, dict) or result.get("schemaVersion") != 3:
        raise InstalledWheelSmokeError("installed stdio smoke did not return schema 3")
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
