"""Assemble immutable datasets through the authoritative VaspParser pipeline."""

from __future__ import annotations

import os
import re
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path

from vasp_analyzer.convergence import energy_deltas, force_metrics
from vasp_analyzer.core import (
    CalculationDataset,
    Capability,
    DatasetConsistencyError,
    EnergyTerm,
    InitialStructure,
    IonicStep,
    ParserProvenance,
    SelectiveMask,
    Site,
    SourceFile,
)
from vasp_analyzer.normalizers import (
    NormalizerMatch,
    load_registry,
    normalize_outcar,
    select_normalizer,
)
from vasp_analyzer.parsing.adapters.poscar_pymatgen import ParsedStructure, parse_poscar
from vasp_analyzer.parsing.adapters.vaspparser_outcar import parse_vaspparser_outcar
from vasp_analyzer.parsing.dialects import Dialect, detect_dialect
from vasp_analyzer.parsing.profiles import CompatibilityProfile

from .discovery import DiscoveredCalculation, discover_calculation

_NORMALIZER_PREFIX_BYTES = 1024 * 1024
_VRHFIN = re.compile(rb"VRHFIN\s*=\s*([A-Z][a-z]?)\s*:")
_IONS_PER_TYPE = re.compile(rb"ions per type\s*=\s*((?:[1-9][0-9]*\s*)+)")
_ENERGY_COMPONENTS = (
    ("alpha_z", "alpha Z PSCENC"),
    ("ewald", "Ewald energy TEWEN"),
    ("hartree", "-Hartree energy DENC"),
    ("exchange", "-exchange EXHF"),
    ("xc", "-V(xc)+E(xc) XCENC"),
    ("paw_double_counting_1", "PAW double counting (first)"),
    ("paw_double_counting_2", "PAW double counting (second)"),
    ("entropy", "entropy T*S EENTRO"),
    ("eigenvalues", "eigenvalues EBANDS"),
    ("atomic", "atomic energy EATOM"),
    ("solvation", "Solvation Ediel_sol"),
)


def inspect_source(path: Path) -> SourceFile:
    digest = sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    stat = path.stat()
    return SourceFile(
        path=str(path.resolve()),
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        fingerprint=digest.hexdigest(),
    )


def _source_files(discovered: DiscoveredCalculation) -> tuple[SourceFile, ...]:
    paths = [discovered.outcar]
    paths.extend(path for path in (discovered.poscar, discovered.contcar) if path is not None)
    return tuple(inspect_source(path) for path in paths)


def inspect_calculation(discovered: DiscoveredCalculation) -> SourceFile:
    sources = _source_files(discovered)
    payload = "\0".join(
        f"{item.path}\0{item.size}\0{item.mtime_ns}\0{item.fingerprint}" for item in sources
    )
    return SourceFile(
        path=str(discovered.root),
        size=sum(item.size for item in sources),
        mtime_ns=max(item.mtime_ns for item in sources),
        fingerprint=sha256(payload.encode()).hexdigest(),
    )


def _read_normalizer_prefix(path: Path) -> bytes:
    with path.open("rb") as stream:
        return stream.read(_NORMALIZER_PREFIX_BYTES)


def _select_outcar_normalizer(path: Path) -> NormalizerMatch:
    registry = load_registry(os.environ, Path.home())
    return select_normalizer(_read_normalizer_prefix(path), registry)


def detect_path_dialect(
    discovered: DiscoveredCalculation, profile: CompatibilityProfile | None = None
) -> Dialect:
    prefix = _read_normalizer_prefix(discovered.outcar)
    return detect_dialect(prefix.decode("utf-8", errors="replace"), profile).dialect


def _parse_structures(
    discovered: DiscoveredCalculation, dialect: Dialect
) -> tuple[ParsedStructure | None, ParsedStructure | None]:
    poscar = parse_poscar(discovered.poscar, dialect) if discovered.poscar else None
    contcar = parse_poscar(discovered.contcar, dialect) if discovered.contcar else None
    if poscar and contcar:
        left = tuple(site.element for site in poscar.sites)
        right = tuple(site.element for site in contcar.sites)
        if left != right:
            raise DatasetConsistencyError(
                f"POSCAR species order {left} does not match CONTCAR species order {right}"
            )
    return poscar, contcar


def _header_sites(prefix: bytes) -> tuple[Site, ...]:
    elements = tuple(item.decode("ascii") for item in _VRHFIN.findall(prefix))
    counts_match = _IONS_PER_TYPE.search(prefix)
    if not elements or counts_match is None:
        raise DatasetConsistencyError(
            "OUTCAR-only analysis requires recognizable VRHFIN and ions per type metadata"
        )
    counts = tuple(int(item) for item in counts_match.group(1).split())
    if len(elements) < len(counts):
        raise DatasetConsistencyError("OUTCAR species metadata is incomplete")
    unknown = SelectiveMask(a=None, b=None, c=None)
    species = tuple(
        element for element, count in zip(elements[-len(counts) :], counts, strict=True)
        for _ in range(count)
    )
    return tuple(
        Site(
            site_index=index,
            element=element,
            initial_fractional_position=(0.0, 0.0, 0.0),
            initial_cartesian_position=(0.0, 0.0, 0.0),
            selective_dynamics=unknown,
        )
        for index, element in enumerate(species)
    )


def _validate_structure_order(
    poscar: ParsedStructure | None,
    contcar: ParsedStructure | None,
    outcar_sites: tuple[Site, ...],
) -> None:
    expected = tuple(site.element for site in outcar_sites)
    for name, parsed in (("POSCAR", poscar), ("CONTCAR", contcar)):
        if parsed is None:
            continue
        actual = tuple(site.element for site in parsed.sites)
        if len(actual) != len(expected):
            raise DatasetConsistencyError(
                f"{name} atom count {len(actual)} does not match OUTCAR "
                f"atom count {len(expected)}"
            )
        if actual != expected:
            raise DatasetConsistencyError(
                f"{name} species order {actual} does not match OUTCAR species order {expected}"
            )


def _capabilities() -> tuple[Capability, ...]:
    return (
        Capability(name="structure", available=True),
        Capability(name="convergence", available=True),
        Capability(name="dos", available=False, reason="Requires DOSCAR or vasprun.xml parser"),
        Capability(name="band", available=False, reason="Requires EIGENVAL, PROCAR, or vasprun.xml parser"),
        Capability(name="charge", available=False, reason="Requires CHGCAR, AECCAR*, ELFCAR, or LOCPOT parser"),
    )


def _energy_terms(
    components: tuple[tuple[float, ...], ...] | None,
    step_index: int,
) -> tuple[EnergyTerm, ...]:
    if components is None:
        return ()
    if len(components) != len(_ENERGY_COMPONENTS):
        raise DatasetConsistencyError(
            f"vaspparser energy_components[{step_index}] has {len(components)} "
            f"components; expected {len(_ENERGY_COMPONENTS)}"
        )
    if any(not electronic_values for electronic_values in components):
        raise DatasetConsistencyError(
            f"vaspparser energy_components[{step_index}] contains an empty component"
        )
    return tuple(
        EnergyTerm(
            key=key,
            raw_label=label,
            value=electronic_values[-1],
            kind="contribution",
        )
        for (key, label), electronic_values in zip(
            _ENERGY_COMPONENTS, components, strict=True
        )
    )


def _assemble(
    path: Path,
    profile: CompatibilityProfile | None = None,
) -> tuple[CalculationDataset, Dialect, NormalizerMatch]:
    discovered = discover_calculation(path)
    dialect = detect_path_dialect(discovered, profile)
    poscar, contcar = _parse_structures(discovered, dialect)
    prefix = _read_normalizer_prefix(discovered.outcar)
    outcar_sites = _header_sites(prefix)
    _validate_structure_order(poscar, contcar, outcar_sites)
    selected = poscar or contcar
    sites = selected.sites if selected else outcar_sites
    match = _select_outcar_normalizer(discovered.outcar)

    provenance = ParserProvenance(
        adapter="vaspparser",
        adapter_version=version("vaspparser"),
        dialect=dialect.id,
        profile_id=profile.id if profile else None,
        normalizer_id=match.definition.id,
        normalizer_display_name=match.definition.display_name,
        normalizer_schema_version=match.definition.schema_version,
        normalizer_definition_sha256=match.definition_hash,
    )
    with normalize_outcar(discovered.outcar, match) as normalized:
        manifest = normalized.manifest
        provenance = provenance.model_copy(
            update={
                "normalization_changed_line_count": manifest.changed_line_count,
                "normalization_manifest_reference": sha256(
                    (
                        f"{manifest.source_sha256}\0"
                        f"{manifest.definition_sha256}\0{manifest.changed_line_count}"
                    ).encode("ascii")
                ).hexdigest(),
                "normalization_warnings": manifest.warnings,
            }
        )
        trajectory = parse_vaspparser_outcar(normalized.parser_path, sites, provenance)

    if not trajectory.step_indices:
        raise DatasetConsistencyError("vaspparser OUTCAR contains no ionic steps")
    if selected is None:
        sites = tuple(
            site.model_copy(
                update={
                    "initial_fractional_position": trajectory.fractional_positions[0][index],
                    "initial_cartesian_position": trajectory.positions[0][index],
                }
            )
            for index, site in enumerate(sites)
        )
    masks = tuple(site.selective_dynamics for site in sites)
    steps: list[IonicStep] = []
    for index in trajectory.step_indices:
        metrics = force_metrics(trajectory.forces[index], masks, trajectory.cells[index])
        stress = trajectory.stresses[index] if trajectory.stresses is not None else None
        steps.append(
            IonicStep(
                index=index,
                lattice=trajectory.cells[index],
                fractional_positions=trajectory.fractional_positions[index],
                cartesian_positions=trajectory.positions[index],
                raw_forces=trajectory.forces[index],
                free_forces=metrics.free_forces,
                free_force_norms=metrics.free_force_norms,
                total_energy=trajectory.energies[index],
                energy_terms=_energy_terms(
                    (
                        trajectory.energy_components[index]
                        if trajectory.energy_components is not None
                        else None
                    ),
                    index,
                ),
                stress_tensor_kb=stress,
                delta_energy=None,
                scf_iterations=(
                    len(trajectory.scf_energies[index])
                    if trajectory.scf_energies is not None
                    else None
                ),
                electronic_converged=None,
                ionic_converged=None,
                strongest_free_component=metrics.strongest,
                rms_free_force=metrics.rms,
            )
        )
    deltas = energy_deltas(tuple(step.total_energy for step in steps))
    ionic_steps = tuple(
        step.model_copy(update={"delta_energy": delta})
        for step, delta in zip(steps, deltas, strict=True)
    )
    initial_structure = (
        InitialStructure(
            lattice=poscar.lattice,
            fractional_positions=poscar.fractional_positions,
            cartesian_positions=poscar.cartesian_positions,
        )
        if poscar is not None
        else None
    )
    dataset = CalculationDataset(
        root=str(discovered.root),
        source_files=_source_files(discovered),
        sites=sites,
        initial_structure=initial_structure,
        ionic_steps=ionic_steps,
        capabilities=_capabilities(),
        provenance=provenance,
    )
    return dataset, dialect, match


def load_dataset(
    path: Path, profile: CompatibilityProfile | None = None
) -> CalculationDataset:
    return _assemble(path, profile)[0]


__all__ = [
    "detect_path_dialect",
    "inspect_calculation",
    "inspect_source",
    "load_dataset",
]
