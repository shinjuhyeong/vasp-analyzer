"""Read-only acceptance audit for the production OUTCAR pipeline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

from vasp_analyzer.calculation import load_dataset


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _finite(values: object) -> bool:
    if isinstance(values, (tuple, list)):
        return all(_finite(value) for value in values)
    return isinstance(values, (int, float)) and math.isfinite(float(values))


def audit_outcar(path: Path) -> dict[str, Any]:
    """Parse one OUTCAR through the production pipeline without modifying it."""

    path = Path(path).resolve(strict=True)
    before = _sha256(path)
    dataset = load_dataset(path)
    after = _sha256(path)
    provenance = dataset.provenance
    if provenance is None:
        raise RuntimeError("production dataset omitted parser provenance")
    steps = dataset.ionic_steps
    atom_count = len(dataset.sites)
    shapes_valid = all(
        len(step.lattice) == 3
        and all(len(row) == 3 for row in step.lattice)
        and len(step.cartesian_positions) == atom_count
        and len(step.fractional_positions) == atom_count
        and len(step.raw_forces) == atom_count
        and all(len(row) == 3 for row in step.cartesian_positions)
        and all(len(row) == 3 for row in step.fractional_positions)
        and all(len(row) == 3 for row in step.raw_forces)
        for step in steps
    )
    finite = all(
        _finite(step.lattice)
        and _finite(step.cartesian_positions)
        and _finite(step.fractional_positions)
        and _finite(step.raw_forces)
        and step.total_energy is not None
        and math.isfinite(step.total_energy)
        for step in steps
    )
    return {
        "adapter": provenance.adapter,
        "adapterVersion": provenance.adapter_version,
        "atomCount": atom_count,
        "byteSize": path.stat().st_size,
        "finite": finite,
        "normalizer": {
            "changedLineCount": provenance.normalization_changed_line_count,
            "definitionSha256": provenance.normalizer_definition_sha256,
            "id": provenance.normalizer_id,
            "manifestReference": provenance.normalization_manifest_reference,
            "schemaVersion": provenance.normalizer_schema_version,
            "warnings": list(provenance.normalization_warnings),
        },
        "parser": "vaspparser",
        "shapes": {
            "cell": [len(steps), 3, 3],
            "forces": [len(steps), atom_count, 3],
            "positions": [len(steps), atom_count, 3],
            "valid": shapes_valid,
        },
        "sourceSha256": before,
        "sourceSha256After": after,
        "sourceUnchanged": before == after,
        "steps": len(steps),
    }


def _accepted(report: dict[str, Any]) -> bool:
    return (
        report["adapter"] == report["parser"] == "vaspparser"
        and report["steps"] > 0
        and report["atomCount"] > 0
        and report["finite"]
        and report["shapes"]["valid"]
        and report["sourceUnchanged"]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        report = audit_outcar(args.path)
    except Exception as error:
        report = {"error": {"message": str(error), "type": type(error).__name__}}
        print(json.dumps(report, sort_keys=True, separators=(",", ":")))
        return 1
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if _accepted(report) else 1


if __name__ == "__main__":
    sys.exit(main())
