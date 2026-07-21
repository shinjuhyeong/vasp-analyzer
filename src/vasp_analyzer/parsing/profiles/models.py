"""Immutable schemas for declarative parser compatibility profiles."""

import re
from typing import Literal

from pydantic import StrictBool, StrictInt, field_validator, model_validator

from vasp_analyzer.core import FrozenModel, ParserProvenance

_INTEGER_LINE = re.compile(r"[+-]?\d+")
_MAX_TEXT = 256


def _bounded_text(value: str) -> str:
    if not value.strip() or len(value) > _MAX_TEXT:
        raise ValueError(f"text must contain 1..{_MAX_TEXT} characters")
    return value


def _marker_tuple(value: tuple[str, ...], *, required: bool = False) -> tuple[str, ...]:
    if required and not value:
        raise ValueError("marker group must not be empty")
    for marker in value:
        _bounded_text(marker)
    folded = [marker.casefold() for marker in value]
    if len(folded) != len(set(folded)):
        raise ValueError("marker group contains case-insensitive duplicates")
    return value


class DetectionRule(FrozenModel):
    outcar_contains: tuple[str, ...] = ()
    priority: StrictInt = 0

    @field_validator("outcar_contains")
    @classmethod
    def validate_markers(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _marker_tuple(value)


class PoscarRule(FrozenModel):
    drop_exact_line_after: Literal["Selective dynamics"] | None = None
    drop_exact_line: str | None = None

    @field_validator("drop_exact_line")
    @classmethod
    def require_integer_drop_line(cls, value: str | None) -> str | None:
        """Allow only a standalone signed or unsigned integer metadata line."""
        if value is not None and _INTEGER_LINE.fullmatch(value) is None:
            raise ValueError("drop_exact_line must be a standalone integer")
        return value

    @model_validator(mode="after")
    def require_complete_drop_rule(self) -> "PoscarRule":
        """Reject a partially declared normalization operation."""
        has_anchor = self.drop_exact_line_after is not None
        has_line = self.drop_exact_line is not None
        if has_anchor != has_line:
            raise ValueError(
                "drop_exact_line_after and drop_exact_line must be declared together"
            )
        return self


class ValidationRule(FrozenModel):
    expected_force_columns: Literal[6] = 6
    force_prefix_columns: Literal[0, 2] = 0
    allow_incomplete_tail: StrictBool = True


class MarkerAliases(FrozenModel):
    position_force: tuple[str, ...] = ("POSITION", "TOTAL-FORCE")
    total_energy: tuple[str, ...] = ("free energy", "TOTEN")
    converged: tuple[str, ...] = ("reached required accuracy",)

    @field_validator("position_force", "total_energy", "converged")
    @classmethod
    def validate_required_markers(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _marker_tuple(value, required=True)


class EnergyTermRule(FrozenModel):
    key: str
    labels: tuple[str, ...]
    kind: Literal["contribution", "aggregate"]

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        if re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value) is None:
            raise ValueError("energy key must be a bounded snake-case identifier")
        return value

    @field_validator("labels")
    @classmethod
    def validate_labels(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _marker_tuple(value, required=True)


class DetailMarkers(FrozenModel):
    energy_section: tuple[str, ...] = ("FREE ENERGIE OF THE ION-ELECTRON SYSTEM",)
    stress_section: tuple[str, ...] = ("FORCE on cell =-STRESS",)
    external_pressure: tuple[str, ...] = ("external pressure",)
    cell_volume: tuple[str, ...] = ("volume of cell",)
    parameter_sections: tuple[str, ...] = ("INCAR:",)

    @field_validator(
        "energy_section",
        "stress_section",
        "external_pressure",
        "cell_volume",
        "parameter_sections",
    )
    @classmethod
    def validate_markers(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _marker_tuple(value, required=True)


STANDARD_ENERGY_TERMS: tuple[EnergyTermRule, ...] = (
    EnergyTermRule(
        key="ewald",
        labels=("alpha Z PSCENC", "Ewald energy TEWEN", "Ewald energy"),
        kind="contribution",
    ),
    EnergyTermRule(
        key="hartree",
        labels=("-Hartree energ DENC", "Hartree energy"),
        kind="contribution",
    ),
    EnergyTermRule(
        key="exchange_correlation",
        labels=("-exchange EXHF", "-V(xc)+E(xc) XCENC", "exchange-correlation"),
        kind="contribution",
    ),
    EnergyTermRule(
        key="paw_double_counting",
        labels=("PAW double counting",),
        kind="contribution",
    ),
    EnergyTermRule(
        key="entropy_ts",
        labels=("entropy T*S EENTRO", "entropy T*S"),
        kind="contribution",
    ),
    EnergyTermRule(
        key="eigenvalues",
        labels=("eigenvalues EBANDS", "eigenvalues"),
        kind="contribution",
    ),
    EnergyTermRule(
        key="atomic_energy",
        labels=("atomic energy EATOM", "atomic energy"),
        kind="contribution",
    ),
    EnergyTermRule(
        key="toten",
        labels=("free energy TOTEN",),
        kind="aggregate",
    ),
    EnergyTermRule(
        key="energy_without_entropy",
        labels=("energy without entropy",),
        kind="aggregate",
    ),
    EnergyTermRule(
        key="sigma_to_zero",
        labels=("energy(sigma->0)",),
        kind="aggregate",
    ),
)


class OutcarRule(FrozenModel):
    markers: MarkerAliases = MarkerAliases()
    details: DetailMarkers = DetailMarkers()
    energy_terms: tuple[EnergyTermRule, ...] = STANDARD_ENERGY_TERMS

    @field_validator("energy_terms", mode="before")
    @classmethod
    def extend_standard_energy_terms(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            return value
        declared_keys = {
            item.get("key") if isinstance(item, dict) else getattr(item, "key", None)
            for item in value
        }
        return tuple(value) + tuple(
            item for item in STANDARD_ENERGY_TERMS if item.key not in declared_keys
        )

    @model_validator(mode="after")
    def reject_ambiguous_energy_aliases(self) -> "OutcarRule":
        owners: dict[str, str] = {}
        keys: set[str] = set()
        for rule in self.energy_terms:
            if rule.key in keys:
                raise ValueError(f"duplicate energy key {rule.key!r}")
            keys.add(rule.key)
            for label in rule.labels:
                folded = " ".join(label.split()).casefold()
                owner = owners.setdefault(folded, rule.key)
                if owner != rule.key:
                    raise ValueError(
                        f"energy alias {label!r} is ambiguous between {owner!r} and {rule.key!r}"
                    )
        return self


class CompatibilityProfile(FrozenModel):
    schema_version: Literal[1]
    id: str
    display_name: str
    detection: DetectionRule = DetectionRule()
    poscar: PoscarRule = PoscarRule()
    outcar: OutcarRule = OutcarRule()
    validation: ValidationRule = ValidationRule()

    @field_validator("id", "display_name")
    @classmethod
    def validate_identity_text(cls, value: str) -> str:
        return _bounded_text(value)


class NormalizationResult(FrozenModel):
    text: str
    applied_rules: tuple[str, ...] = ()
    compatibility_metadata: tuple[str, ...] = ()

    def provenance(self, adapter: str, adapter_version: str, dialect: str) -> ParserProvenance:
        return ParserProvenance(
            adapter=adapter,
            adapter_version=adapter_version,
            dialect=dialect,
            normalization_rules=self.applied_rules,
            compatibility_metadata=self.compatibility_metadata,
        )
