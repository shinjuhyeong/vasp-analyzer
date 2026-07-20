"""Immutable public domain models for analyzed VASP calculations."""

from hashlib import sha256
from typing import Literal

import numpy as np

from pydantic import PositiveInt, computed_field, field_validator, model_validator

from .config import FrozenModel

Vec3 = tuple[float, float, float]
Mat3 = tuple[Vec3, Vec3, Vec3]


class SourceFile(FrozenModel):
    path: str
    size: int
    mtime_ns: int
    fingerprint: str


class SelectiveMask(FrozenModel):
    a: bool | None
    b: bool | None
    c: bool | None

    def as_tuple(self) -> tuple[bool | None, bool | None, bool | None]:
        return self.a, self.b, self.c


class Site(FrozenModel):
    site_index: int
    element: str
    initial_fractional_position: Vec3
    initial_cartesian_position: Vec3
    selective_dynamics: SelectiveMask


class ForceComponent(FrozenModel):
    site_index: int
    axis: Literal["a", "b", "c"]
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


class VolumetricDescriptor(FrozenModel):
    source: str
    lattice: Mat3
    dimensions: tuple[PositiveInt, PositiveInt, PositiveInt]
    kind: str
    units: str
    value_range: tuple[float, float]

    @field_validator("source", "kind", "units")
    @classmethod
    def require_nonempty_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value

    @model_validator(mode="after")
    def validate_value_range(self) -> "VolumetricDescriptor":
        if not all(np.isfinite(self.value_range)) or self.value_range[0] > self.value_range[1]:
            raise ValueError("value_range must be finite and ordered")
        return self

    def require_compatible_structure(self, lattice: Mat3) -> None:
        from .errors import VolumetricAlignmentError

        if not np.allclose(self.lattice, lattice, atol=1e-6, rtol=0.0):
            raise VolumetricAlignmentError(
                f"{self.source} lattice is incompatible with the selected structure"
            )


class VolumetricRequest(FrozenModel):
    fingerprint: str
    isovalue: float
    downsample: PositiveInt
    repeat: tuple[PositiveInt, PositiveInt, PositiveInt]

    @field_validator("fingerprint")
    @classmethod
    def require_fingerprint(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("fingerprint must not be empty")
        return value

    @field_validator("isovalue")
    @classmethod
    def require_finite_isovalue(cls, value: float) -> float:
        if not np.isfinite(value):
            raise ValueError("isovalue must be finite")
        return value

    @computed_field
    @property
    def identity(self) -> str:
        payload = (
            f"{self.fingerprint}\0{self.isovalue!r}\0{self.downsample}\0"
            f"{self.repeat[0]},{self.repeat[1]},{self.repeat[2]}"
        )
        return sha256(payload.encode()).hexdigest()
