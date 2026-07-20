"""Apply selective-dynamics masks without inventing unknown constraints."""

from vasp_analyzer.core import SelectiveMask, Vec3


def apply_constraints(
    forces: tuple[Vec3, ...], masks: tuple[SelectiveMask, ...] | None
) -> tuple[Vec3, ...] | None:
    if masks is None or any(None in mask.as_tuple() for mask in masks):
        return None
    return tuple(
        tuple(value if allowed else 0.0 for value, allowed in zip(force, mask.as_tuple(), strict=True))  # type: ignore[misc]
        for force, mask in zip(forces, masks, strict=True)
    )


__all__ = ["apply_constraints"]
