"""Periodic minimum-image bond generation."""

from itertools import combinations, product
from math import ceil, sqrt

import numpy as np

from vasp_analyzer.core import FrozenModel, Mat3, Site


class PeriodicBond(FrozenModel):
    site_index: int
    neighbor_site_index: int
    neighbor_image: tuple[int, int, int]
    distance: float


def periodic_bonds(
    sites: tuple[Site, ...], lattice: Mat3, cutoff: float
) -> tuple[PeriodicBond, ...]:
    if cutoff <= 0:
        raise ValueError("cutoff must be positive")
    bonds: list[PeriodicBond] = []
    cell = np.asarray(lattice, dtype=float)
    smallest_scale = float(np.linalg.svd(cell, compute_uv=False)[-1])
    if not np.isfinite(smallest_scale) or smallest_scale <= 0.0:
        raise ValueError("lattice must be finite and non-singular")
    for first, second in combinations(sites, 2):
        raw_delta = np.asarray(second.initial_fractional_position, dtype=float) - np.asarray(
            first.initial_fractional_position, dtype=float
        )
        base_image = -np.floor(raw_delta + 0.5).astype(int)
        wrapped = raw_delta + base_image
        initial_distance = float(np.linalg.norm(wrapped @ cell))
        bounds = tuple(
            ceil(initial_distance / smallest_scale + abs(float(value)))
            for value in wrapped
        )
        best: tuple[float, tuple[int, int, int]] | None = None
        for offset in product(*(range(-bound, bound + 1) for bound in bounds)):
            image = tuple(
                int(base + local)
                for base, local in zip(base_image, offset, strict=True)
            )
            delta = raw_delta + np.asarray(image)
            distance = sqrt(sum(float(value) ** 2 for value in delta @ cell))
            if best is None or distance < best[0]:
                best = distance, image
        if best is not None and best[0] <= cutoff:
            bonds.append(
                PeriodicBond(
                    site_index=first.site_index,
                    neighbor_site_index=second.site_index,
                    neighbor_image=best[1],
                    distance=best[0],
                )
            )
    return tuple(bonds)


__all__ = ["PeriodicBond", "periodic_bonds"]
