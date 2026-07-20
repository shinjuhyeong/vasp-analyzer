"""pymatgen adapter for dialect-normalized POSCAR and CONTCAR structures."""

from collections.abc import Iterable
from importlib.metadata import version
from pathlib import Path

from pymatgen.io.vasp import Poscar

from vasp_analyzer.core import (
    FrozenModel,
    MalformedBlock,
    Mat3,
    ParserProvenance,
    SelectiveMask,
    Site,
    Vec3,
)
from vasp_analyzer.parsing.dialects import Dialect
from vasp_analyzer.parsing.profiles import normalize_poscar


class ParsedStructure(FrozenModel):
    """Immutable structure data copied out of a third-party parser."""

    lattice: Mat3
    sites: tuple[Site, ...]
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    provenance: ParserProvenance


def _vec3(values: Iterable[float]) -> Vec3:
    x, y, z = values
    return float(x), float(y), float(z)


def _mat3(rows: Iterable[Iterable[float]]) -> Mat3:
    first, second, third = rows
    return _vec3(first), _vec3(second), _vec3(third)


def parse_poscar(path: Path, dialect: Dialect) -> ParsedStructure:
    """Normalize and parse a POSCAR-like file into analyzer-owned contracts."""
    result = normalize_poscar(
        path.read_text(encoding="utf-8", errors="strict"),
        dialect.profile,
    )
    try:
        structure = Poscar.from_str(result.text).structure
    except ValueError as exc:
        raise MalformedBlock(f"{path.name}: invalid POSCAR: {exc}") from exc

    raw_masks = structure.site_properties.get("selective_dynamics")
    masks = raw_masks if raw_masks is not None else [[True, True, True] for _ in structure]
    sites = tuple(
        Site(
            site_index=index,
            element=site.specie.symbol,
            initial_fractional_position=_vec3(site.frac_coords),
            initial_cartesian_position=_vec3(site.coords),
            selective_dynamics=SelectiveMask(a=mask[0], b=mask[1], c=mask[2]),
        )
        for index, (site, mask) in enumerate(zip(structure, masks, strict=True))
    )

    return ParsedStructure(
        lattice=_mat3(structure.lattice.matrix),
        sites=sites,
        fractional_positions=tuple(_vec3(site.frac_coords) for site in structure),
        cartesian_positions=tuple(_vec3(site.coords) for site in structure),
        provenance=result.provenance(
            adapter="pymatgen",
            adapter_version=version("pymatgen"),
            dialect=dialect.id,
        ),
    )
