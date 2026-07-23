from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.audit_outcar import audit_outcar

FIXTURES = Path(__file__).parents[1] / "fixtures" / "outcar"
SCRIPT = Path(__file__).parents[2] / "scripts" / "audit_outcar.py"


def test_audit_reports_production_parser_normalizer_shapes_and_source_hash(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes((FIXTURES / "ase-complete-one-step.OUTCAR").read_bytes())

    report = audit_outcar(path)

    assert report["adapter"] == report["parser"] == "vaspparser"
    assert report["steps"] == 1
    assert report["atomCount"] == 2
    assert report["normalizer"]["id"] == "standard"
    assert report["normalizer"]["changedLineCount"] == 0
    assert report["shapes"] == {
        "cell": [1, 3, 3],
        "forces": [1, 2, 3],
        "positions": [1, 2, 3],
        "valid": True,
    }
    assert report["finite"] is True
    assert report["sourceUnchanged"] is True
    assert report["sourceSha256"] == report["sourceSha256After"]


def test_audit_command_exits_nonzero_on_parser_error(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_text("not an OUTCAR\n", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "error" in json.loads(result.stdout)
