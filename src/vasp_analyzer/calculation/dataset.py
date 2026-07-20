"""Reconcile parser outputs into one immutable calculation dataset."""

from __future__ import annotations

from hashlib import sha256
from importlib.metadata import version
from pathlib import Path

from vasp_analyzer.convergence import energy_deltas, force_metrics
from vasp_analyzer.core import (
    CalculationDataset,
    Capability,
    DatasetConsistencyError,
    IonicStep,
    ParserProvenance,
    SelectiveMask,
    Site,
    SourceFile,
)
from vasp_analyzer.parsing.adapters.outcar_ase import ParsedTrajectoryStep, iter_outcar_steps
from vasp_analyzer.parsing.adapters.poscar_pymatgen import ParsedStructure, parse_poscar
from vasp_analyzer.parsing.dialects import Dialect, detect_dialect
from vasp_analyzer.parsing.profiles import CompatibilityProfile
from vasp_analyzer.parsing.recovery import ParserCheckpoint, scan_outcar

from .discovery import DiscoveredCalculation, discover_calculation


def inspect_source(path: Path) -> SourceFile:
    data = path.read_bytes()
    stat = path.stat()
    return SourceFile(
        path=str(path.resolve()),
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        fingerprint=sha256(data).hexdigest(),
    )


def detect_path_dialect(
    discovered: DiscoveredCalculation, profile: CompatibilityProfile | None = None
) -> Dialect:
    head = discovered.outcar.read_bytes()[:65536].decode("utf-8", errors="replace")
    return detect_dialect(head, profile).dialect


def _source_files(discovered: DiscoveredCalculation) -> tuple[SourceFile, ...]:
    paths = [discovered.outcar]
    paths.extend(path for path in (discovered.poscar, discovered.contcar) if path is not None)
    paths.extend(item.path for item in discovered.optional)
    return tuple(inspect_source(path) for path in paths)


def inspect_calculation(discovered: DiscoveredCalculation) -> SourceFile:
    sources = _source_files(discovered)
    payload = "\0".join(
        f"{source.path}\0{source.size}\0{source.mtime_ns}\0{source.fingerprint}"
        for source in sources
    )
    return SourceFile(
        path=str(discovered.root),
        size=sum(source.size for source in sources),
        mtime_ns=max(source.mtime_ns for source in sources),
        fingerprint=sha256(payload.encode()).hexdigest(),
    )


def _validate_species(source: str, species: tuple[str, ...], outcar: tuple[str, ...]) -> None:
    if len(species) != len(outcar):
        raise DatasetConsistencyError(
            f"{source} atom count {len(species)} does not match OUTCAR atom count {len(outcar)}"
        )
    if species != outcar:
        raise DatasetConsistencyError(
            f"{source} species order {species} does not match OUTCAR species order {outcar}"
        )


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


def _derived_sites(step: ParsedTrajectoryStep) -> tuple[Site, ...]:
    unknown = SelectiveMask(x=None, y=None, z=None)
    return tuple(
        Site(
            site_index=index,
            element=element,
            initial_fractional_position=step.fractional_positions[index],
            initial_cartesian_position=step.cartesian_positions[index],
            selective_dynamics=unknown,
        )
        for index, element in enumerate(step.species)
    )


def _capabilities() -> tuple[Capability, ...]:
    return (
        Capability(name="structure", available=True),
        Capability(name="convergence", available=True),
        Capability(name="dos", available=False, reason="Requires DOSCAR or vasprun.xml parser"),
        Capability(name="band", available=False, reason="Requires EIGENVAL, PROCAR, or vasprun.xml parser"),
        Capability(name="charge", available=False, reason="Requires CHGCAR, AECCAR*, ELFCAR, or LOCPOT parser"),
    )


def _assemble(
    path: Path,
    profile: CompatibilityProfile | None = None,
    *,
    checkpoint: ParserCheckpoint | None = None,
    existing: CalculationDataset | None = None,
) -> tuple[CalculationDataset, ParserCheckpoint, Dialect]:
    discovered = discover_calculation(path)
    dialect = detect_path_dialect(discovered, profile)
    poscar, contcar = _parse_structures(discovered, dialect)
    scan = scan_outcar(discovered.outcar, dialect, checkpoint)
    merge_existing = existing if checkpoint is not None and scan.resumed_from > 0 else None
    trajectory = tuple(iter_outcar_steps(discovered.outcar, scan))
    if trajectory:
        outcar_species = trajectory[0].species
    else:
        outcar_species = scan.species
    for source_name, structure in (("POSCAR", poscar), ("CONTCAR", contcar)):
        if structure is not None:
            _validate_species(
                source_name, tuple(site.element for site in structure.sites), outcar_species
            )
    selected = poscar or contcar
    if selected is not None:
        sites = selected.sites
    elif trajectory:
        sites = _derived_sites(trajectory[0])
    elif merge_existing is not None:
        sites = merge_existing.sites
    else:
        raise DatasetConsistencyError("OUTCAR contains no structure records")

    records = {record.step_id: record for record in scan.steps}
    frames = {step.step_id: step for step in trajectory}
    if records.keys() != frames.keys():
        raise DatasetConsistencyError(
            f"scanner step IDs {tuple(records)} do not match trajectory step IDs {tuple(frames)}"
        )
    steps = (
        {step.index: step for step in merge_existing.ionic_steps}
        if merge_existing is not None
        else {}
    )
    masks = tuple(site.selective_dynamics for site in sites)
    for step_id in records:
        record = records[step_id]
        frame = frames[step_id]
        metrics = force_metrics(frame.raw_forces, masks)
        steps[step_id] = IonicStep(
            index=step_id,
            lattice=frame.lattice,
            fractional_positions=frame.fractional_positions,
            cartesian_positions=frame.cartesian_positions,
            raw_forces=frame.raw_forces,
            free_forces=metrics.free_forces,
            free_force_norms=metrics.free_force_norms,
            total_energy=frame.total_energy if frame.total_energy is not None else record.energy,
            delta_energy=None,
            scf_iterations=record.scf_iterations,
            electronic_converged=record.electronic_converged,
            ionic_converged=record.ionic_converged,
            strongest_free_component=metrics.strongest,
            rms_free_force=metrics.rms,
        )
    ordered = tuple(steps[index] for index in sorted(steps))
    ordered = tuple(
        step.model_copy(
            update={
                "free_forces": metrics.free_forces,
                "free_force_norms": metrics.free_force_norms,
                "strongest_free_component": metrics.strongest,
                "rms_free_force": metrics.rms,
            }
        )
        for step in ordered
        for metrics in (force_metrics(step.raw_forces, masks),)
    )
    deltas = energy_deltas(tuple(step.total_energy for step in ordered))
    ordered = tuple(
        step.model_copy(update={"delta_energy": delta})
        for step, delta in zip(ordered, deltas, strict=True)
    )
    warnings = tuple(merge_existing.warnings if merge_existing else ()) + tuple(
        warning
        for warning in scan.warnings
        if merge_existing is None or warning not in merge_existing.warnings
    )
    provenance = selected.provenance if selected is not None else ParserProvenance(
        adapter="ase+scanner",
        adapter_version=version("ase"),
        dialect=dialect.id,
        profile_id=profile.id if profile else None,
    )
    dataset = CalculationDataset(
        root=str(discovered.root),
        source_files=_source_files(discovered),
        sites=sites,
        ionic_steps=ordered,
        capabilities=_capabilities(),
        warnings=warnings,
        provenance=provenance,
    )
    return dataset, scan.checkpoint, dialect


def load_dataset(
    path: Path, profile: CompatibilityProfile | None = None
) -> CalculationDataset:
    return _assemble(path, profile)[0]


__all__ = ["detect_path_dialect", "inspect_calculation", "inspect_source", "load_dataset"]
