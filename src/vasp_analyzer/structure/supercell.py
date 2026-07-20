"""Supercell images that preserve original site identity."""

from itertools import product

from vasp_analyzer.core import FrozenModel, Site, Vec3


class SupercellSite(FrozenModel):
    site_index: int
    image: tuple[int, int, int]
    fractional_position: Vec3


def replicate_sites(
    sites: tuple[Site, ...], repeat: tuple[int, int, int]
) -> tuple[SupercellSite, ...]:
    if any(value <= 0 for value in repeat):
        raise ValueError("repeat values must be positive")
    return tuple(
        SupercellSite(
            site_index=site.site_index,
            image=image,
            fractional_position=tuple(
                (coordinate + offset) / count
                for coordinate, offset, count in zip(
                    site.initial_fractional_position, image, repeat, strict=True
                )
            ),  # type: ignore[arg-type]
        )
        for image in product(*(range(value) for value in repeat))
        for site in sites
    )


__all__ = ["SupercellSite", "replicate_sites"]
