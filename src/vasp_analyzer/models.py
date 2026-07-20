from typing import Literal

from pydantic import BaseModel, ConfigDict, computed_field

Vec3 = tuple[float, float, float]
Mat3 = tuple[Vec3, Vec3, Vec3]


def to_camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


class FrozenModel(BaseModel):
    model_config = ConfigDict(
        frozen=True,
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class SelectiveMask(FrozenModel):
    x: bool | None
    y: bool | None
    z: bool | None

    def as_tuple(self) -> tuple[bool | None, bool | None, bool | None]:
        return self.x, self.y, self.z


class Site(FrozenModel):
    site_index: int
    element: str
    selective_dynamics: SelectiveMask


class ForceComponent(FrozenModel):
    site_index: int
    axis: Literal["x", "y", "z"]
    value: float

    @computed_field
    @property
    def magnitude(self) -> float:
        return abs(self.value)


class IonicStep(FrozenModel):
    index: int
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    free_forces: tuple[Vec3, ...] | None
    total_energy: float
    delta_energy: float | None
    scf_iterations: int
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
    source_files: dict[str, str]
    sites: tuple[Site, ...]
    ionic_steps: tuple[IonicStep, ...]
    capabilities: tuple[Capability, ...]
    warnings: tuple[str, ...] = ()
