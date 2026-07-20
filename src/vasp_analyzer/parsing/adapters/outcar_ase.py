"""ASE-backed conversion of scanner-indexed OUTCAR trajectories."""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator
from pathlib import Path

import numpy as np
from ase.io import ParseError, iread

from vasp_analyzer.core import DatasetConsistencyError, FrozenModel, Mat3, Vec3
from vasp_analyzer.parsing.recovery import ScanResult, StepRecord


class ParsedTrajectoryStep(FrozenModel):
    """Immutable trajectory data copied from an ASE frame or validated recovery record."""

    step_id: int
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    total_energy: float | None
    species: tuple[str, ...]


class _NormalizedForceRows:
    """Text stream that removes a declared prefix only inside force blocks."""

    def __init__(self, path: Path, *, atom_count: int, prefix_columns: int) -> None:
        self.name = str(path)
        self._stream = path.open("r", encoding="utf-8", errors="replace")
        self._atom_count = atom_count
        self._prefix_columns = prefix_columns
        self._rows_remaining = 0
        self._after_marker = False

    def __enter__(self) -> "_NormalizedForceRows":
        return self

    def __exit__(self, *args: object) -> None:
        self._stream.close()

    def __iter__(self) -> "_NormalizedForceRows":
        return self

    def __next__(self) -> str:
        line = self.readline()
        if line == "":
            raise StopIteration
        return line

    def readline(self, size: int = -1) -> str:
        line = self._stream.readline(size)
        if line == "":
            return line
        if self._rows_remaining:
            tokens = line.split()
            if len(tokens) == 6 + self._prefix_columns:
                ending = "\n" if line.endswith("\n") else ""
                line = " ".join(tokens[self._prefix_columns :]) + ending
            self._rows_remaining -= 1
        elif self._after_marker:
            self._after_marker = False
            self._rows_remaining = self._atom_count
        elif "POSITION" in line and "TOTAL-FORCE" in line:
            self._after_marker = True
        return line


def _contains_prefixed_force_rows(path: Path, scan: ScanResult) -> bool:
    prefix = scan.force_prefix_columns
    if not prefix or scan.checkpoint.expected_atom_count <= 0:
        return False
    with path.open("rb") as stream:
        for line in stream:
            if b"POSITION" in line and b"TOTAL-FORCE" in line:
                next(stream, b"")
                first_row = next(stream, b"")
                if len(first_row.split()) == 6 + prefix:
                    return True
    return False


def _ase_frames(path: Path, scan: ScanResult) -> Iterator[object]:
    if not _contains_prefixed_force_rows(path, scan):
        yield from iread(path, format="vasp-out", index=":")
        return
    with _NormalizedForceRows(
        path,
        atom_count=scan.checkpoint.expected_atom_count,
        prefix_columns=scan.force_prefix_columns,
    ) as stream:
        yield from iread(stream, format="vasp-out", index=":")  # type: ignore[arg-type]


def _vec3(values: Iterable[float]) -> Vec3:
    x, y, z = values
    return float(x), float(y), float(z)


def _mat3(rows: Iterable[Iterable[float]]) -> Mat3:
    first, second, third = rows
    return _vec3(first), _vec3(second), _vec3(third)


def _validate_step(
    *,
    step_id: int,
    atom_count: int,
    lattice: Mat3,
    fractional_positions: tuple[Vec3, ...],
    cartesian_positions: tuple[Vec3, ...],
    raw_forces: tuple[Vec3, ...],
    total_energy: float | None,
    species: tuple[str, ...],
) -> ParsedTrajectoryStep:
    _validate_cell(step_id, lattice)
    fractional_count = len(fractional_positions)
    cartesian_count = len(cartesian_positions)
    force_count = len(raw_forces)
    species_count = len(species)
    actual_counts = {fractional_count, cartesian_count, force_count, species_count}
    if actual_counts != {atom_count}:
        raise DatasetConsistencyError(
            f"step {step_id}: expected {atom_count} atoms; got "
            f"fractional={fractional_count}, Cartesian={cartesian_count}, forces={force_count}"
        )

    values = (
        value
        for rows in (lattice, fractional_positions, cartesian_positions, raw_forces)
        for row in rows
        for value in row
    )
    if not all(math.isfinite(value) for value in values) or (
        total_energy is not None and not math.isfinite(total_energy)
    ):
        raise DatasetConsistencyError(f"step {step_id}: trajectory contains non-finite values")

    return ParsedTrajectoryStep(
        step_id=step_id,
        lattice=lattice,
        fractional_positions=fractional_positions,
        cartesian_positions=cartesian_positions,
        raw_forces=raw_forces,
        total_energy=total_energy,
        species=species,
    )


def _validate_cell(step_id: int, lattice: Mat3) -> None:
    if not all(math.isfinite(value) for row in lattice for value in row):
        raise DatasetConsistencyError(f"step {step_id}: trajectory contains non-finite values")
    try:
        rank = np.linalg.matrix_rank(np.asarray(lattice, dtype=float))
    except np.linalg.LinAlgError as error:
        raise DatasetConsistencyError(
            f"step {step_id}: lattice rank could not be determined"
        ) from error
    if rank < 3:
        raise DatasetConsistencyError(f"step {step_id}: trajectory contains a singular lattice")


def _recovered_step(record: StepRecord, species: tuple[str, ...]) -> ParsedTrajectoryStep:
    cell = np.asarray(record.lattice, dtype=float)
    positions = np.asarray(record.cartesian_positions, dtype=float)
    try:
        scaled = np.linalg.solve(cell.T, positions.T).T
    except np.linalg.LinAlgError as error:
        raise DatasetConsistencyError(
            f"step {record.step_id}: recovery lattice is singular"
        ) from error

    return _validate_step(
        step_id=record.step_id,
        atom_count=record.atom_count,
        lattice=record.lattice,
        fractional_positions=tuple(_vec3(row) for row in scaled),
        cartesian_positions=record.cartesian_positions,
        raw_forces=record.raw_forces,
        total_energy=record.energy,
        species=species,
    )


def _count_error(converted: int, expected: int) -> DatasetConsistencyError:
    return DatasetConsistencyError(
        f"ASE returned {converted} frames for {expected} indexed steps"
    )


def _validate_step_ids(records: tuple[StepRecord, ...]) -> None:
    step_ids = tuple(record.step_id for record in records)
    if step_ids[0] < 0 or any(
        current != previous + 1
        for previous, current in zip(step_ids, step_ids[1:], strict=False)
    ):
        raise DatasetConsistencyError(
            f"scanner step IDs must be non-negative, ordered and contiguous; got {step_ids}"
        )


def _is_recoverable_tail(*, index: int, expected: int, record: StepRecord, scan: ScanResult) -> bool:
    return (
        index == expected - 1
        and scan.checkpoint.replay_provisional
        and (record.energy is None or scan.resumed_from == record.block_start)
    )


def iter_outcar_steps(path: Path, scan: ScanResult) -> Iterator[ParsedTrajectoryStep]:
    """Yield ASE-authoritative frames reconciled to scanner records by ``step_id``."""

    records = scan.steps
    if not records:
        return
    _validate_step_ids(records)

    frames = iter(_ase_frames(path, scan))
    expected = len(records)
    expected_physical_frames = records[-1].step_id + 1
    physical_frames = 0
    converted = 0

    for skipped_step_id in range(records[0].step_id):
        try:
            skipped = next(frames)
        except StopIteration:
            raise _count_error(physical_frames, expected_physical_frames) from None
        except ParseError as error:
            raise DatasetConsistencyError(
                f"ASE failed while seeking indexed step {records[0].step_id} "
                f"after frame {skipped_step_id}: {error}"
            ) from error
        del skipped
        physical_frames += 1

    for index, record in enumerate(records):
        try:
            atoms = next(frames)
        except StopIteration:
            if _is_recoverable_tail(
                index=index, expected=expected, record=record, scan=scan
            ):
                yield _recovered_step(record, scan.species)
                return
            raise _count_error(physical_frames, expected_physical_frames) from None
        except ParseError as error:
            if str(error) == "Incomplete OUTCAR" and _is_recoverable_tail(
                index=index, expected=expected, record=record, scan=scan
            ):
                yield _recovered_step(record, scan.species)
                return
            raise DatasetConsistencyError(
                f"ASE failed while reading indexed step {record.step_id}: {error}"
            ) from error

        try:
            lattice = _mat3(atoms.cell.array)
            _validate_cell(record.step_id, lattice)
            ase_species = tuple(str(symbol) for symbol in atoms.get_chemical_symbols())
            if scan.species and ase_species != scan.species:
                raise DatasetConsistencyError(
                    f"step {record.step_id}: scanner species {scan.species} do not match "
                    f"ASE species {ase_species}"
                )
            step = _validate_step(
                step_id=record.step_id,
                atom_count=record.atom_count,
                lattice=lattice,
                fractional_positions=tuple(
                    _vec3(row) for row in atoms.get_scaled_positions(wrap=False)
                ),
                cartesian_positions=tuple(_vec3(row) for row in atoms.positions),
                raw_forces=tuple(
                    _vec3(row) for row in atoms.get_forces(apply_constraint=False)
                ),
                total_energy=float(
                    atoms.get_potential_energy(
                        force_consistent=True, apply_constraint=False
                    )
                ),
                species=ase_species or scan.species,
            )
        except (TypeError, ValueError) as error:
            raise DatasetConsistencyError(
                f"step {record.step_id}: ASE returned malformed trajectory data"
            ) from error
        finally:
            del atoms

        yield step
        physical_frames += 1
        converted += 1

    try:
        extra = next(frames)
    except StopIteration:
        return
    except ParseError as error:
        raise DatasetConsistencyError(
            f"ASE failed after {converted} indexed steps: {error}"
        ) from error
    del extra
    raise _count_error(physical_frames + 1, expected_physical_frames)


__all__ = ["ParsedTrajectoryStep", "iter_outcar_steps"]
