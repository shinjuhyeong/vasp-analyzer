"""Single-pass, byte-oriented indexing of complete OUTCAR ionic records."""

from __future__ import annotations

import math
import re
from hashlib import sha256
from pathlib import Path

from vasp_analyzer.core import (
    FrozenModel,
    Mat3,
    OutcarFormatError,
    ParserWarning,
    Vec3,
)
from vasp_analyzer.parsing.dialects import Dialect

from .checkpoint import ParserCheckpoint, _hash_prefix, checkpoint_is_append_only

_NIONS = re.compile(rb"\bNIONS\s*=\s*(\d+)\b", re.IGNORECASE)
_ENERGY = re.compile(rb"=\s*([^\s]+)")
_LATTICE_MARKER = b"direct lattice vectors"
_NORMAL_FINISH_MARKER = b"general timing and accounting"


class StepRecord(FrozenModel):
    step_id: int
    block_start: int
    block_end: int
    atom_count: int
    lattice: Mat3
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    energy: float | None
    scf_iterations: int | None
    electronic_converged: bool | None
    ionic_converged: bool | None


class ScanResult(FrozenModel):
    steps: tuple[StepRecord, ...]
    warnings: tuple[ParserWarning, ...]
    checkpoint: ParserCheckpoint
    resumed_from: int
    normally_finished: bool


def _contains_all(line: bytes, markers: tuple[str, ...]) -> bool:
    lowered = line.lower()
    return bool(markers) and all(marker.encode("utf-8").lower() in lowered for marker in markers)


def _finite_numbers(line: bytes, *, context: str, offset: int) -> tuple[float, ...]:
    values: list[float] = []
    for token in line.split():
        try:
            value = float(token.replace(b"D", b"E").replace(b"d", b"e"))
        except ValueError as error:
            raise OutcarFormatError(f"{context} at byte {offset} contains a non-numeric value") from error
        if not math.isfinite(value):
            raise OutcarFormatError(f"{context} at byte {offset} contains a non-finite value")
        values.append(value)
    return tuple(values)


def _starts_with_number(line: bytes) -> bool:
    tokens = line.split(maxsplit=1)
    if not tokens:
        return False
    try:
        float(tokens[0].replace(b"D", b"E").replace(b"d", b"e"))
    except ValueError:
        return False
    return True


def _mat3(rows: list[tuple[float, ...]], offset: int) -> Mat3:
    if len(rows) != 3 or any(len(row) < 3 for row in rows):
        raise OutcarFormatError(f"lattice at byte {offset} must contain three numeric rows")
    return (
        (rows[0][0], rows[0][1], rows[0][2]),
        (rows[1][0], rows[1][1], rows[1][2]),
        (rows[2][0], rows[2][1], rows[2][2]),
    )


def _step(
    *,
    step_id: int,
    block_start: int,
    block_end: int,
    atom_count: int,
    lattice: Mat3,
    positions: tuple[Vec3, ...],
    forces: tuple[Vec3, ...],
    energy: float | None,
    ionic_converged: bool | None,
) -> StepRecord:
    return StepRecord(
        step_id=step_id,
        block_start=block_start,
        block_end=block_end,
        atom_count=atom_count,
        lattice=lattice,
        cartesian_positions=positions,
        raw_forces=forces,
        energy=energy,
        scf_iterations=None,
        electronic_converged=None,
        ionic_converged=ionic_converged,
    )


def scan_outcar(
    path: Path, dialect: Dialect, checkpoint: ParserCheckpoint | None = None
) -> ScanResult:
    """Stream new OUTCAR bytes and return only newly verified ionic records."""

    path = Path(path)
    can_resume = checkpoint is not None and checkpoint_is_append_only(path, checkpoint)
    resumed_from = checkpoint.last_verified_offset if can_resume and checkpoint is not None else 0
    expected_atom_count = checkpoint.expected_atom_count if can_resume and checkpoint else 0
    lattice = checkpoint.last_lattice if can_resume and checkpoint else None
    next_step_id = checkpoint.next_step_id if can_resume and checkpoint else 0

    steps: list[StepRecord] = []
    warnings: list[ParserWarning] = []
    normally_finished = False
    last_verified_offset = resumed_from
    pending: dict[str, object] | None = None
    force_rows_just_finished = False
    line_number = 0

    with path.open("rb") as stream:
        if resumed_from:
            digest = _hash_prefix(stream, resumed_from)
        else:
            digest = sha256()
        stream.seek(resumed_from)
        offset = resumed_from

        def read_line() -> tuple[int, bytes] | None:
            nonlocal offset, line_number
            raw = stream.readline()
            if not raw:
                return None
            start = offset
            offset += len(raw)
            line_number += 1
            digest.update(raw)
            return start, raw

        def finalize_pending() -> None:
            nonlocal pending, next_step_id, last_verified_offset
            if pending is None:
                return
            record = _step(step_id=next_step_id, **pending)  # type: ignore[arg-type]
            steps.append(record)
            next_step_id += 1
            last_verified_offset = record.block_end
            pending = None

        def handle_incomplete_tail(message: str, block_offset: int) -> None:
            if not dialect.profile.validation.allow_incomplete_tail:
                raise OutcarFormatError(f"{message} at byte {block_offset}")
            warnings.append(
                ParserWarning(
                    category="IncompleteTail",
                    message=message,
                    byte_offset=block_offset,
                    line_number=line_number,
                )
            )

        while (item := read_line()) is not None:
            line_start, raw = item
            lowered = raw.lower()

            nions = _NIONS.search(raw)
            if nions:
                parsed_count = int(nions.group(1))
                if parsed_count <= 0:
                    raise OutcarFormatError(f"NIONS at byte {line_start} must be positive")
                if expected_atom_count and parsed_count != expected_atom_count:
                    raise OutcarFormatError(
                        f"NIONS changed from {expected_atom_count} to {parsed_count} at byte {line_start}"
                    )
                expected_atom_count = parsed_count

            if _NORMAL_FINISH_MARKER in lowered:
                normally_finished = True

            if pending is not None and _contains_all(
                raw, dialect.profile.outcar.markers.converged
            ):
                pending["ionic_converged"] = True

            if _LATTICE_MARKER in lowered:
                finalize_pending()
                lattice_rows: list[tuple[float, ...]] = []
                for _ in range(3):
                    lattice_item = read_line()
                    if lattice_item is None:
                        raise OutcarFormatError(
                            f"incomplete lattice beginning at byte {line_start}"
                        )
                    lattice_offset, lattice_raw = lattice_item
                    lattice_rows.append(
                        _finite_numbers(
                            lattice_raw, context="lattice row", offset=lattice_offset
                        )
                    )
                lattice = _mat3(lattice_rows, line_start)
                force_rows_just_finished = False
                continue

            if _contains_all(raw, dialect.profile.outcar.markers.position_force):
                finalize_pending()
                if expected_atom_count <= 0:
                    raise OutcarFormatError(
                        f"force block at byte {line_start} appears before a valid NIONS value"
                    )
                if lattice is None:
                    raise OutcarFormatError(
                        f"force block at byte {line_start} appears before a complete lattice"
                    )
                separator = read_line()
                if separator is None:
                    handle_incomplete_tail(
                        "force block ended before its atom rows", line_start
                    )
                    break
                separator_offset, separator_raw = separator
                if separator_raw.strip(b" \t\r\n-"):
                    raise OutcarFormatError(
                        f"force block at byte {separator_offset} is missing its separator"
                    )

                positions: list[Vec3] = []
                forces: list[Vec3] = []
                incomplete = False
                for atom_index in range(expected_atom_count):
                    atom_item = read_line()
                    if atom_item is None:
                        handle_incomplete_tail(
                            f"force block has {atom_index} of "
                            f"{expected_atom_count} atom rows",
                            line_start,
                        )
                        incomplete = True
                        break
                    atom_offset, atom_raw = atom_item
                    values = _finite_numbers(
                        atom_raw, context="position/force row", offset=atom_offset
                    )
                    if len(values) != dialect.profile.validation.expected_force_columns:
                        raise OutcarFormatError(
                            f"position/force row at byte {atom_offset} has {len(values)} columns; expected 6"
                        )
                    positions.append((values[0], values[1], values[2]))
                    forces.append((values[3], values[4], values[5]))
                if incomplete:
                    break
                pending = {
                    "block_start": line_start,
                    "block_end": offset,
                    "atom_count": expected_atom_count,
                    "lattice": lattice,
                    "positions": tuple(positions),
                    "forces": tuple(forces),
                    "energy": None,
                    "ionic_converged": None,
                }
                force_rows_just_finished = True
                continue

            if force_rows_just_finished:
                if (
                    len(raw.split()) == dialect.profile.validation.expected_force_columns
                    and _starts_with_number(raw)
                ):
                    _finite_numbers(raw, context="extra position/force row", offset=line_start)
                    raise OutcarFormatError(
                        f"force block at byte {line_start} contains more than "
                        f"{expected_atom_count} atom rows"
                    )
                force_rows_just_finished = False

            if pending is not None and _contains_all(
                raw, dialect.profile.outcar.markers.total_energy
            ):
                match = _ENERGY.search(raw)
                if match is None:
                    raise OutcarFormatError(f"energy line at byte {line_start} has no value")
                energy_values = _finite_numbers(
                    match.group(1), context="energy", offset=line_start
                )
                if len(energy_values) != 1:
                    raise OutcarFormatError(f"energy line at byte {line_start} is malformed")
                pending["energy"] = energy_values[0]
                pending["block_end"] = offset

        finalize_pending()
    current_stat = path.stat()
    new_checkpoint = ParserCheckpoint(
        path=str(path.resolve()),
        size=offset,
        mtime_ns=current_stat.st_mtime_ns,
        prefix_fingerprint=digest.hexdigest(),
        last_verified_offset=last_verified_offset,
        next_step_id=next_step_id,
        expected_atom_count=expected_atom_count,
        last_lattice=lattice,
    )
    return ScanResult(
        steps=tuple(steps),
        warnings=tuple(warnings),
        checkpoint=new_checkpoint,
        resumed_from=resumed_from,
        normally_finished=normally_finished,
    )


__all__ = ["ScanResult", "StepRecord", "scan_outcar"]
