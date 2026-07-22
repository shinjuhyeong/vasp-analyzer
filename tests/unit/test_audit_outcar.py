from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.audit_outcar import _marker_counts, audit_outcar
from vasp_analyzer.parsing.dialects import HOME_BARRIER


FIXTURES = Path(__file__).parents[1] / "fixtures" / "outcar"
SCRIPT = Path(__file__).parents[2] / "scripts" / "audit_outcar.py"


def test_audit_reports_deterministic_parser_and_marker_counts() -> None:
    path = FIXTURES / "detail-complete-two-step.OUTCAR"

    report = audit_outcar(path)

    assert report == {
        "byteSize": path.stat().st_size,
        "dialect": "home_barrier",
        "energyBlocks": 2,
        "forceBlocks": 2,
        "iterations": 0,
        "parsedSteps": 2,
        "resumeChecks": [],
        "scfMaximum": None,
        "scfMinimum": None,
        "scfNonNull": 0,
        "warnings": [],
    }


def test_audit_command_exits_nonzero_when_counts_do_not_match(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes((FIXTURES / "complete-two-step.OUTCAR").read_bytes() + b" POSITION TOTAL-FORCE\n")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert json.loads(result.stdout)["forceBlocks"] == 3


def test_audit_command_exits_nonzero_on_parser_error(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FREE ENERGIE OF THE ION-ELECTRON SYSTEM (eV)\n"
        + b" ---------------------------------------------------\n"
        + b" malformed assignment = nope eV\n"
        + b" ---------------------------------------------------\n"
    )

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert json.loads(result.stdout)["error"]["type"] == "OutcarFormatError"


def test_resume_cut_matches_fresh_records(tmp_path: Path) -> None:
    path = FIXTURES / "complete-two-step.OUTCAR"
    cut = path.read_bytes().index(b" free energy    TOTEN")

    report = audit_outcar(path, resume_offsets=(cut,))

    assert report["resumeChecks"] == [{"matched": True, "offset": cut}]


def test_marker_counts_count_ionic_cycles_not_every_electronic_iteration(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b"Iteration 1(1)\nIteration 1(2)\nIteration 1(3)\n"
        b"Iteration 2(1)\nIteration 2(2)\n"
    )

    iterations, force_blocks, energy_blocks = _marker_counts(path, HOME_BARRIER)

    assert (iterations, force_blocks, energy_blocks) == (2, 0, 0)
