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
) -> ParsedTrajectoryStep:
    fractional_count = len(fractional_positions)
    cartesian_count = len(cartesian_positions)
    force_count = len(raw_forces)
    actual_counts = {fractional_count, cartesian_count, force_count}
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
    )


def _recovered_step(record: StepRecord) -> ParsedTrajectoryStep:
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
        total_energy=None,
    )


def _count_error(converted: int, expected: int) -> DatasetConsistencyError:
    return DatasetConsistencyError(
        f"ASE returned {converted} frames for {expected} indexed steps"
    )


def _is_recoverable_tail(*, index: int, expected: int, record: StepRecord, scan: ScanResult) -> bool:
    return (
        index == expected - 1
        and record.energy is None
        and scan.checkpoint.replay_provisional
    )


def iter_outcar_steps(path: Path, scan: ScanResult) -> Iterator[ParsedTrajectoryStep]:
    """Yield ASE-authoritative frames reconciled to scanner records by ``step_id``."""

    frames = iter(iread(path, format="vasp-out", index=":"))
    expected = len(scan.steps)
    converted = 0

    for index, record in enumerate(scan.steps):
        try:
            atoms = next(frames)
        except StopIteration:
            if _is_recoverable_tail(
                index=index, expected=expected, record=record, scan=scan
            ):
                yield _recovered_step(record)
                converted += 1
                break
            raise _count_error(converted, expected) from None
        except ParseError as error:
            if str(error) == "Incomplete OUTCAR" and _is_recoverable_tail(
                index=index, expected=expected, record=record, scan=scan
            ):
                yield _recovered_step(record)
                converted += 1
                break
            raise DatasetConsistencyError(
                f"ASE failed while reading indexed step {record.step_id}: {error}"
            ) from error

        try:
            step = _validate_step(
                step_id=record.step_id,
                atom_count=record.atom_count,
                lattice=_mat3(atoms.cell.array),
                fractional_positions=tuple(
                    _vec3(row) for row in atoms.get_scaled_positions(wrap=False)
                ),
                cartesian_positions=tuple(_vec3(row) for row in atoms.positions),
                raw_forces=tuple(
                    _vec3(row) for row in atoms.get_forces(apply_constraint=False)
                ),
                total_energy=float(atoms.get_potential_energy(apply_constraint=False)),
            )
        except (TypeError, ValueError) as error:
            raise DatasetConsistencyError(
                f"step {record.step_id}: ASE returned malformed trajectory data"
            ) from error
        finally:
            del atoms

        yield step
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
    raise _count_error(converted + 1, expected)


__all__ = ["ParsedTrajectoryStep", "iter_outcar_steps"]
