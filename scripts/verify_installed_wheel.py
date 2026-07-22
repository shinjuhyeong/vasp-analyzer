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


def validate_stdio_output(output: str) -> None:
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) != 1:
        raise InstalledWheelSmokeError("installed stdio smoke returned an invalid envelope")
    try:
        envelope = json.loads(lines[0])
    except json.JSONDecodeError:
        raise InstalledWheelSmokeError(
            "installed stdio smoke returned invalid JSON"
        ) from None
    result = envelope.get("result") if isinstance(envelope, dict) else None
    if not isinstance(result, dict) or result.get("schemaVersion") != 3:
        raise InstalledWheelSmokeError("installed stdio smoke did not return schema 3")


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


def _run_module(
    arguments: list[str],
    *,
    cwd: Path,
    input_text: str | None = None,
    environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-I", "-m", "vasp_analyzer.cli", *arguments],
        cwd=cwd,
        input=input_text,
        capture_output=True,
        text=True,
        env=environment,
        check=False,
        timeout=60,
    )


def verify_installed_wheel(fixture: Path) -> None:
    fixture = fixture.resolve()
    if not fixture.is_file():
        raise InstalledWheelSmokeError("installed-wheel fixture is unavailable")
    with tempfile.TemporaryDirectory(prefix="vasp-analyzer-installed-") as temp:
        root = Path(temp)
        calculation = root / "calculation"
        calculation.mkdir()
        outcar = calculation / "OUTCAR"
        shutil.copyfile(fixture, outcar)

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

        stdio_result = _run_module(
            ["serve", "--stdio", str(outcar)],
            cwd=root,
            input_text='{"id":1,"method":"getDataset","params":{}}\n',
        )
        if stdio_result.returncode:
            raise InstalledWheelSmokeError("installed stdio command smoke failed")
        validate_stdio_output(stdio_result.stdout)

        environment = dict(os.environ)
        environment.pop("VASP_ANALYZER_ENDPOINT", None)
        environment.pop("VASP_ANALYZER_TOKEN", None)
        default_result = _run_module(
            [str(outcar)], cwd=root, environment=environment
        )
        validate_no_browser_result(
            default_result.returncode,
            default_result.stdout + default_result.stderr,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    args = parser.parse_args()
    verify_installed_wheel(args.fixture)
    print("installed wheel CLI, stdio, and no-browser smokes passed")


if __name__ == "__main__":
    main()
