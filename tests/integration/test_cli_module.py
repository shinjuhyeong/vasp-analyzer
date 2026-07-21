import os
import json
import shutil
import subprocess
import sys
from pathlib import Path


def _repository_environment(repository: Path) -> dict[str, str]:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(repository / "src")
    return environment


def test_python_module_entrypoint_prints_help() -> None:
    repository = Path(__file__).parents[2]
    result = subprocess.run(
        [sys.executable, "-m", "vasp_analyzer.cli", "--help"],
        cwd=repository,
        env=_repository_environment(repository),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Usage:" in result.stdout
    assert "serve" in result.stdout
    assert result.stderr == ""


def test_python_module_entrypoint_serves_one_stdio_request(tmp_path: Path) -> None:
    repository = Path(__file__).parents[2]
    calculation = tmp_path / "calculation"
    calculation.mkdir()
    shutil.copyfile(
        repository / "tests" / "fixtures" / "outcar" / "ase-complete-one-step.OUTCAR",
        calculation / "OUTCAR",
    )
    request = '{"id":1,"method":"getDataset","params":{}}\n'

    result = subprocess.run(
        [sys.executable, "-m", "vasp_analyzer.cli", "serve", "--stdio", str(calculation)],
        cwd=repository,
        env=_repository_environment(repository),
        input=request,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["id"] == 1
    assert response["result"]["schemaVersion"] == 2
    assert result.stderr == ""
