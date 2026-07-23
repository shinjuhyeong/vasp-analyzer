"""Narrow conversion boundary from VaspParser OUTCAR data to analyzer contracts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
from vaspparser.vasp.parser.outcar import Outcar

from vasp_analyzer.core import (
    DatasetConsistencyError,
    FrozenModel,
    Mat3,
    ParserProvenance,
    Site,
    Vec3,
)


class ParsedTrajectory(FrozenModel):
    """Validated, immutable copy of the useful VaspParser OUTCAR quantities."""

    step_indices: tuple[int, ...]
    sites: tuple[Site, ...]
    provenance: ParserProvenance
    energies: tuple[float, ...]
    energy_components: tuple[tuple[tuple[float, ...], ...], ...] | None
    positions: tuple[tuple[Vec3, ...], ...]
    fractional_positions: tuple[tuple[Vec3, ...], ...]
    forces: tuple[tuple[Vec3, ...], ...]
    cells: tuple[Mat3, ...]
    stresses: tuple[Mat3, ...] | None
    pressures: tuple[Vec3, ...] | None
    scf_energies: tuple[tuple[float, ...], ...] | None
    fermi_level: float | None
    fermi_levels: tuple[float, ...] | None
    vbm: tuple[tuple[float, ...], ...] | None
    cbm: tuple[tuple[float, ...], ...] | None


def _array(
    values: object,
    *,
    key: str,
    shape: tuple[int, ...],
) -> np.ndarray:
    try:
        array = np.asarray(values, dtype=float)
    except (TypeError, ValueError, OverflowError) as error:
        raise DatasetConsistencyError(f"vaspparser {key} is not a numeric array") from error
    if array.shape != shape:
        raise DatasetConsistencyError(
            f"vaspparser {key} has shape {array.shape}; expected {shape}"
        )
    if not np.isfinite(array).all():
        raise DatasetConsistencyError(f"vaspparser {key} must contain only finite values")
    return array


def _numeric_array(values: object, *, key: str) -> np.ndarray:
    try:
        array = np.asarray(values, dtype=float)
    except (TypeError, ValueError, OverflowError) as error:
        raise DatasetConsistencyError(f"vaspparser {key} is not a numeric array") from error
    if not np.isfinite(array).all():
        raise DatasetConsistencyError(f"vaspparser {key} must contain only finite values")
    return array


def _optional_array(
    parsed: Mapping[str, Any],
    key: str,
    shape: tuple[int, ...],
) -> np.ndarray | None:
    values = parsed.get(key)
    if values is None:
        return None
    return _array(values, key=key, shape=shape)


def _vec3(values: np.ndarray) -> Vec3:
    return float(values[0]), float(values[1]), float(values[2])


def _mat3(values: np.ndarray) -> Mat3:
    return _vec3(values[0]), _vec3(values[1]), _vec3(values[2])


def _step_vectors(values: np.ndarray) -> tuple[tuple[Vec3, ...], ...]:
    return tuple(tuple(_vec3(row) for row in step) for step in values)


def _step_matrices(values: np.ndarray) -> tuple[Mat3, ...]:
    return tuple(_mat3(step) for step in values)


def _ragged_groups(
    parsed: Mapping[str, Any],
    key: str,
    step_count: int,
    *,
    dimensions: int,
) -> tuple[Any, ...] | None:
    values = parsed.get(key)
    if values is None:
        return None
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
        raise DatasetConsistencyError(f"vaspparser {key} must contain {step_count} groups")
    if len(values) != step_count:
        raise DatasetConsistencyError(
            f"vaspparser {key} has {len(values)} steps; expected {step_count}"
        )

    copied: list[Any] = []
    for index, group in enumerate(values):
        try:
            array = np.asarray(group, dtype=float)
        except (TypeError, ValueError, OverflowError) as error:
            raise DatasetConsistencyError(
                f"vaspparser {key}[{index}] is not numeric"
            ) from error
        if array.ndim != dimensions:
            raise DatasetConsistencyError(
                f"vaspparser {key}[{index}] has {array.ndim} dimensions; "
                f"expected {dimensions}"
            )
        if not np.isfinite(array).all():
            raise DatasetConsistencyError(
                f"vaspparser {key} must contain only finite values"
            )
        if dimensions == 1:
            copied.append(tuple(float(value) for value in array))
        else:
            copied.append(
                tuple(tuple(float(value) for value in row) for row in array)
            )
    return tuple(copied)


def _optional_scalar(parsed: Mapping[str, Any], key: str) -> float | None:
    value = parsed.get(key)
    if value is None:
        return None
    try:
        copied = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise DatasetConsistencyError(f"vaspparser {key} is not numeric") from error
    if not np.isfinite(copied):
        raise DatasetConsistencyError(f"vaspparser {key} must be finite")
    return copied


def _fractional_positions(
    cells: np.ndarray, positions: np.ndarray
) -> tuple[tuple[Vec3, ...], ...]:
    converted: list[tuple[Vec3, ...]] = []
    for index, (cell, cartesian) in enumerate(zip(cells, positions, strict=True)):
        try:
            fractional = np.linalg.solve(cell.T, cartesian.T).T
        except np.linalg.LinAlgError as error:
            raise DatasetConsistencyError(
                f"vaspparser cells[{index}] is singular"
            ) from error
        if not np.isfinite(fractional).all():
            raise DatasetConsistencyError(
                f"vaspparser fractional positions at step {index} are not finite"
            )
        converted.append(tuple(_vec3(row) for row in fractional))
    return tuple(converted)


def _require_mapping(value: object) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise DatasetConsistencyError("vaspparser parse_dict is not a mapping")
    return value


def parse_vaspparser_outcar(
    path: Path,
    sites: tuple[Site, ...],
    provenance: ParserProvenance,
) -> ParsedTrajectory:
    """Parse an OUTCAR and immediately copy VaspParser values into frozen models."""

    parser = Outcar()
    parser.from_file(str(path))
    parsed = _require_mapping(parser.parse_dict)

    try:
        energies_raw = _numeric_array(parsed["energies"], key="energies")
    except KeyError as error:
        raise DatasetConsistencyError("vaspparser energies is missing") from error
    if energies_raw.ndim != 1:
        raise DatasetConsistencyError(
            f"vaspparser energies has shape {energies_raw.shape}; expected one dimension"
        )
    positions_raw = _numeric_array(parsed.get("positions"), key="positions")
    if positions_raw.ndim != 3 or positions_raw.shape[2] != 3:
        raise DatasetConsistencyError(
            f"vaspparser positions has shape {positions_raw.shape}; expected (steps, atoms, 3)"
        )
    step_count, parsed_atom_count, _ = positions_raw.shape
    atom_count = len(sites)
    if parsed_atom_count != atom_count:
        raise DatasetConsistencyError(
            f"sites has {atom_count} atoms but vaspparser positions has "
            f"{parsed_atom_count} atoms"
        )
    energies = _array(energies_raw, key="energies", shape=(step_count,))
    positions = _array(
        positions_raw,
        key="positions",
        shape=(step_count, atom_count, 3),
    )
    forces = _array(
        parsed.get("forces"),
        key="forces",
        shape=(step_count, atom_count, 3),
    )
    cells = _array(parsed.get("cells"), key="cells", shape=(step_count, 3, 3))

    raw_steps = parsed.get("steps")
    if raw_steps is not None:
        _array(raw_steps, key="steps", shape=(step_count,))

    stresses = _optional_array(parsed, "stresses", (step_count, 3, 3))
    pressures = _optional_array(parsed, "pressures", (step_count, 3))
    fermi_levels = _optional_array(parsed, "e_fermi_list", (step_count,))

    vbm = parsed.get("vbm_list")
    if vbm is not None:
        try:
            vbm_array = np.asarray(vbm, dtype=float)
        except (TypeError, ValueError, OverflowError) as error:
            raise DatasetConsistencyError("vaspparser vbm_list is not numeric") from error
        if vbm_array.ndim != 2 or vbm_array.shape[1] != step_count:
            raise DatasetConsistencyError(
                f"vaspparser vbm_list has shape {vbm_array.shape}; "
                f"expected (spin, {step_count})"
            )
        if not np.isfinite(vbm_array).all():
            raise DatasetConsistencyError("vaspparser vbm_list must contain only finite values")
    else:
        vbm_array = None

    cbm = parsed.get("cbm_list")
    if cbm is not None:
        try:
            cbm_array = np.asarray(cbm, dtype=float)
        except (TypeError, ValueError, OverflowError) as error:
            raise DatasetConsistencyError("vaspparser cbm_list is not numeric") from error
        if cbm_array.ndim != 2 or cbm_array.shape[1] != step_count:
            raise DatasetConsistencyError(
                f"vaspparser cbm_list has shape {cbm_array.shape}; "
                f"expected (spin, {step_count})"
            )
        if not np.isfinite(cbm_array).all():
            raise DatasetConsistencyError("vaspparser cbm_list must contain only finite values")
    else:
        cbm_array = None

    return ParsedTrajectory(
        step_indices=tuple(range(step_count)),
        sites=tuple(sites),
        provenance=provenance,
        energies=tuple(float(value) for value in energies),
        energy_components=_ragged_groups(
            parsed, "energy_components", step_count, dimensions=2
        ),
        positions=_step_vectors(positions),
        fractional_positions=_fractional_positions(cells, positions),
        forces=_step_vectors(forces),
        cells=_step_matrices(cells),
        stresses=None if stresses is None else _step_matrices(stresses),
        pressures=None
        if pressures is None
        else tuple(_vec3(row) for row in pressures),
        scf_energies=_ragged_groups(parsed, "scf_energies", step_count, dimensions=1),
        fermi_level=_optional_scalar(parsed, "fermi_level"),
        fermi_levels=None
        if fermi_levels is None
        else tuple(float(value) for value in fermi_levels),
        vbm=None
        if vbm_array is None
        else tuple(tuple(float(value) for value in row) for row in vbm_array),
        cbm=None
        if cbm_array is None
        else tuple(tuple(float(value) for value in row) for row in cbm_array),
    )


__all__ = ["ParsedTrajectory", "parse_vaspparser_outcar"]
