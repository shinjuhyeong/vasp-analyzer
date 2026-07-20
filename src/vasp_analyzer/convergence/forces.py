"""Constraint-aware force convergence metrics."""

from math import sqrt

import numpy as np

from vasp_analyzer.core import ForceComponent, FrozenModel, Mat3, SelectiveMask, Vec3
from vasp_analyzer.structure.constraints import apply_constraints


class ForceMetrics(FrozenModel):
    free_forces: tuple[Vec3, ...] | None
    free_force_norms: tuple[float, ...] | None
    strongest: ForceComponent | None
    rms: float | None


def force_metrics(
    forces: tuple[Vec3, ...], masks: tuple[SelectiveMask, ...] | None, lattice: Mat3
) -> ForceMetrics:
    free = apply_constraints(forces, masks, lattice)
    if free is None or masks is None:
        return ForceMetrics(free_forces=None, free_force_norms=None, strongest=None, rms=None)
    eligible = [
        (abs(value), ForceComponent(site_index=index, axis=axis, value=value))
        for index, (force, mask) in enumerate(zip(forces, masks, strict=True))
        for axis, value, allowed in zip(
            ("a", "b", "c"),
            (float(np.dot(force, vector) / np.linalg.norm(vector)) for vector in lattice),
            mask.as_tuple(),
            strict=True,
        )
        if allowed
    ]
    strongest = max(eligible, default=(0.0, None), key=lambda item: item[0])[1]
    norms = tuple(sqrt(sum(value * value for value in vector)) for vector in free)
    values = [component.value for _, component in eligible]
    rms = sqrt(sum(value * value for value in values) / len(values)) if values else None
    return ForceMetrics(
        free_forces=free, free_force_norms=norms, strongest=strongest, rms=rms
    )


__all__ = ["ForceMetrics", "force_metrics"]
