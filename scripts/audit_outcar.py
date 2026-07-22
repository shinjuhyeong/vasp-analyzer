"""Read-only full-file audit for production OUTCAR parsing."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from vasp_analyzer.parsing.dialects import Dialect, detect_dialect
from vasp_analyzer.parsing.recovery import StepRecord, scan_outcar


def _contains_all(line: bytes, markers: tuple[str, ...]) -> bool:
    lowered = line.lower()
    return bool(markers) and all(marker.encode("utf-8").lower() in lowered for marker in markers)


def _contains_any(line: bytes, markers: tuple[str, ...]) -> bool:
    lowered = line.lower()
    return any(marker.encode("utf-8").lower() in lowered for marker in markers)


def _detect_path_dialect(path: Path) -> Dialect:
    with path.open("rb") as stream:
        head = stream.read(64 * 1024).decode("utf-8", errors="replace")
    return detect_dialect(head).dialect


def _marker_counts(path: Path, dialect: Dialect) -> tuple[int, int, int]:
    iterations = force_blocks = energy_blocks = 0
    with path.open("rb") as stream:
        for line in stream:
            iteration = dialect.profile.outcar.details.iteration.parse(line)
            iterations += iteration is not None and iteration[1] == 1
            force_blocks += _contains_all(line, dialect.profile.outcar.markers.position_force)
            energy_blocks += _contains_any(line, dialect.profile.outcar.details.energy_section)
    return iterations, force_blocks, energy_blocks


def _merge_steps(before: tuple[StepRecord, ...], after: tuple[StepRecord, ...]) -> tuple[StepRecord, ...]:
    by_id = {step.step_id: step for step in before}
    by_id.update((step.step_id, step) for step in after)
    return tuple(by_id[index] for index in sorted(by_id))


def _resume_matches(path: Path, dialect: Dialect, offset: int, fresh: tuple[StepRecord, ...]) -> bool:
    size = path.stat().st_size
    if not 0 <= offset <= size:
        raise ValueError(f"resume offset {offset} is outside the {size}-byte file")
    with tempfile.TemporaryDirectory(prefix="vasp-analyzer-audit-") as temp:
        replay = Path(temp) / "OUTCAR"
        with path.open("rb") as source, replay.open("wb") as destination:
            destination.write(source.read(offset))
        before = scan_outcar(replay, dialect)
        with path.open("rb") as source, replay.open("ab") as destination:
            source.seek(offset)
            shutil.copyfileobj(source, destination)
        after = scan_outcar(replay, dialect, before.checkpoint)
    return _merge_steps(before.steps, after.steps) == fresh


def audit_outcar(path: Path, *, resume_offsets: tuple[int, ...] = ()) -> dict[str, Any]:
    """Audit one OUTCAR without modifying it or its calculation directory."""

    path = Path(path).resolve(strict=True)
    dialect = _detect_path_dialect(path)
    iterations, force_blocks, energy_blocks = _marker_counts(path, dialect)
    scan = scan_outcar(path, dialect)
    scf = [step.scf_iterations for step in scan.steps if step.scf_iterations is not None]
    return {
        "byteSize": path.stat().st_size,
        "dialect": dialect.id,
        "energyBlocks": energy_blocks,
        "forceBlocks": force_blocks,
        "iterations": iterations,
        "parsedSteps": len(scan.steps),
        "resumeChecks": [
            {
                "matched": _resume_matches(path, dialect, offset, scan.steps),
                "offset": offset,
            }
            for offset in resume_offsets
        ],
        "scfMaximum": max(scf, default=None),
        "scfMinimum": min(scf, default=None),
        "scfNonNull": len(scf),
        "warnings": [warning.model_dump(mode="json") for warning in scan.warnings],
    }


def _accepted(report: dict[str, Any]) -> bool:
    count = report["parsedSteps"]
    return (
        count == report["iterations"] == report["forceBlocks"] == report["energyBlocks"]
        and report["scfNonNull"] == count
        and not report["warnings"]
        and all(check["matched"] for check in report["resumeChecks"])
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--resume-at", action="append", default=[], type=int, metavar="BYTE")
    args = parser.parse_args()
    try:
        report = audit_outcar(args.path, resume_offsets=tuple(args.resume_at))
    except Exception as error:  # command boundary reports production parser failures as JSON
        report = {"error": {"message": str(error), "type": type(error).__name__}}
        print(json.dumps(report, sort_keys=True, separators=(",", ":")))
        return 1
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if _accepted(report) else 1


if __name__ == "__main__":
    sys.exit(main())
