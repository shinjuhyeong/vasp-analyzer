"""Immutable public domain models for analyzed VASP calculations."""

from typing import Literal

from pydantic import computed_field

from .config import FrozenModel

Vec3 = tuple[float, float, float]
Mat3 = tuple[Vec3, Vec3, Vec3]


class SourceFile(FrozenModel):
    path: str
    size: int
    mtime_ns: int
    fingerprint: str


class SelectiveMask(FrozenModel):
    x: bool | None
    y: bool | None
    z: bool | None

    def as_tuple(self) -> tuple[bool | None, bool | None, bool | None]:
        return self.x, self.y, self.z


class Site(FrozenModel):
    site_index: int
    element: str
    initial_fractional_position: Vec3
    initial_cartesian_position: Vec3
    selective_dynamics: SelectiveMask


class ForceComponent(FrozenModel):
    site_index: int
    axis: Literal["x", "y", "z"]
    value: float

    @computed_field
    @property
    def magnitude(self) -> float:
        return abs(self.value)


class ParserWarning(FrozenModel):
    category: Literal["IncompleteTail", "IgnoredCompatibilityMetadata"]
    message: str
    byte_offset: int | None = None
    line_number: int | None = None


class ParserProvenance(FrozenModel):
    adapter: str
    adapter_version: str
    dialect: str
    profile_id: str | None = None
    normalization_rules: tuple[str, ...] = ()
    compatibility_metadata: tuple[str, ...] = ()


class EnergyTerm(FrozenModel):
    name: str
    value: float
    unit: Literal["eV"] = "eV"


class IonicStep(FrozenModel):
    index: int
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    free_forces: tuple[Vec3, ...] | None
    free_force_norms: tuple[float, ...] | None
    total_energy: float | None
    energy_terms: tuple[EnergyTerm, ...] = ()
    delta_energy: float | None
    scf_iterations: int | None
    electronic_converged: bool | None
    ionic_converged: bool | None
    strongest_free_component: ForceComponent | None
    rms_free_force: float | None


class Capability(FrozenModel):
    name: Literal["structure", "convergence", "dos", "band", "charge"]
    available: bool
    reason: str | None = None


class CalculationDataset(FrozenModel):
    schema_version: Literal[1] = 1
    root: str
    source_files: tuple[SourceFile, ...]
    sites: tuple[Site, ...]
    ionic_steps: tuple[IonicStep, ...]
    capabilities: tuple[Capability, ...]
    warnings: tuple[ParserWarning, ...] = ()
    provenance: ParserProvenance | None = None
