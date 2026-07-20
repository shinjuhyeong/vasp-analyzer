"""Immutable schemas for declarative parser compatibility profiles."""

import re
from typing import Literal

from pydantic import StrictBool, StrictInt, field_validator, model_validator

from vasp_analyzer.core import FrozenModel, ParserProvenance

_INTEGER_LINE = re.compile(r"[+-]?\d+")


class DetectionRule(FrozenModel):
    outcar_contains: tuple[str, ...] = ()
    priority: StrictInt = 0


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


class OutcarRule(FrozenModel):
    markers: MarkerAliases = MarkerAliases()


class CompatibilityProfile(FrozenModel):
    schema_version: Literal[1]
    id: str
    display_name: str
    detection: DetectionRule = DetectionRule()
    poscar: PoscarRule = PoscarRule()
    outcar: OutcarRule = OutcarRule()
    validation: ValidationRule = ValidationRule()


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
