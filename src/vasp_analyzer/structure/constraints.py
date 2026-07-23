"""Project Cartesian forces onto Selective Dynamics direct-vector subspaces."""

import numpy as np

from vasp_analyzer.core import Mat3, SelectiveMask, Vec3


def apply_constraints(
    forces: tuple[Vec3, ...], masks: tuple[SelectiveMask, ...] | None, lattice: Mat3
) -> tuple[Vec3, ...] | None:
    direct = np.asarray(lattice, dtype=float)
    raw_forces = np.asarray(forces, dtype=float)
    if not np.isfinite(direct).all() or not np.isfinite(raw_forces).all():
        raise ValueError("forces and lattice must contain only finite values")
    if np.linalg.matrix_rank(direct) != 3:
        raise ValueError("lattice must be nonsingular")
    if masks is None or any(None in mask.as_tuple() for mask in masks):
        return None
    projected: list[Vec3] = []
    for force, mask in zip(forces, masks, strict=True):
        allowed = np.asarray(mask.as_tuple(), dtype=bool)
        if allowed.all():
            vector = np.asarray(force, dtype=float).copy()
        elif not allowed.any():
            vector = np.zeros(3)
        else:
            basis, _ = np.linalg.qr(direct[allowed].T, mode="reduced")
            raw = np.asarray(force, dtype=float)
            vector = basis @ (basis.T @ raw)
        projected.append(tuple(float(value) for value in vector))  # type: ignore[arg-type]
    return tuple(projected)


__all__ = ["apply_constraints"]
