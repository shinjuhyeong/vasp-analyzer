from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Identifier = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$",
    ),
]
ColumnName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$"),
]
DisplayName = Annotated[str, StringConstraints(min_length=1, max_length=128)]
_SAFE_SUFFIX = re.compile(r"^[A-Za-z0-9_+-]+$")


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda name: {
            "schema_version": "schemaVersion",
            "display_name": "displayName",
            "allowed_suffixes": "allowedSuffixes",
            "contains_all": "containsAll",
            "row_count": "rowCount",
        }.get(name, name),
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )


class DetectionSpec(_StrictModel):
    all: tuple[str, ...] = ()
    any: tuple[str, ...] = ()
    none: tuple[str, ...] = ()

    @field_validator("all", "any", "none")
    @classmethod
    def validate_literals(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        for literal in values:
            if (
                not literal
                or not literal.isascii()
                or any(character in "\r\n\0" for character in literal)
            ):
                raise ValueError("detection literal must be nonempty printable ASCII")
        if len(values) != len(set(values)):
            raise ValueError("detection literals must be unique")
        return values


class ElementLabelColumn(_StrictModel):
    name: ColumnName
    type: Literal["elementLabel"]
    allowed_suffixes: tuple[str, ...] = ()

    @field_validator("allowed_suffixes")
    @classmethod
    def validate_suffixes(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("element suffixes must be unique")
        if any(not _SAFE_SUFFIX.fullmatch(value) for value in values):
            raise ValueError("element suffix must use only ASCII letters, digits, _, +, or -")
        return values


class PositiveIntegerColumn(_StrictModel):
    name: ColumnName
    type: Literal["positiveInteger"]


class FiniteFloatColumn(_StrictModel):
    name: ColumnName
    type: Literal["finiteFloat"]


class LiteralColumn(_StrictModel):
    name: ColumnName
    type: Literal["literal"]
    value: Annotated[str, StringConstraints(min_length=1, max_length=128)]

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: str) -> str:
        if any(character.isspace() for character in value):
            raise ValueError("literal column value must be one token")
        return value


class TextColumn(_StrictModel):
    name: ColumnName
    type: Literal["text"]


ColumnSpec = Annotated[
    ElementLabelColumn
    | PositiveIntegerColumn
    | FiniteFloatColumn
    | LiteralColumn
    | TextColumn,
    Field(discriminator="type"),
]


class BlockStart(_StrictModel):
    contains_all: tuple[Annotated[str, StringConstraints(min_length=1)], ...]

    @field_validator("contains_all")
    @classmethod
    def validate_contains_all(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if not values or len(values) != len(set(values)):
            raise ValueError("containsAll literals must be nonempty and unique")
        if any(not value.isascii() or "\n" in value or "\r" in value for value in values):
            raise ValueError("containsAll literal must be printable ASCII")
        return values


class BlockAfter(_StrictModel):
    type: Literal["dashedSeparator"]


class RowCount(_StrictModel):
    source: Literal["atomCount"]


class ProjectionScope(_StrictModel):
    start: BlockStart
    after: BlockAfter
    row_count: RowCount


class ProjectionInput(_StrictModel):
    tokenizer: Literal["whitespace"]
    columns: tuple[ColumnSpec, ...]

    @field_validator("columns")
    @classmethod
    def validate_columns(cls, columns: tuple[ColumnSpec, ...]) -> tuple[ColumnSpec, ...]:
        if not columns:
            raise ValueError("columns must not be empty")
        names = [column.name for column in columns]
        if len(names) != len(set(names)):
            raise ValueError("column names must be unique")
        return columns


class ProjectionOutput(_StrictModel):
    emit: tuple[ColumnName, ...]
    separator: Literal["  "] = "  "

    @field_validator("emit")
    @classmethod
    def validate_emit(cls, emit: tuple[str, ...]) -> tuple[str, ...]:
        if not emit or len(emit) != len(set(emit)):
            raise ValueError("emit references must be nonempty and unique")
        return emit


class ProjectionRule(_StrictModel):
    id: Identifier
    scope: ProjectionScope
    input: ProjectionInput
    output: ProjectionOutput

    @model_validator(mode="after")
    def validate_emit_references(self) -> ProjectionRule:
        columns = {column.name: column for column in self.input.columns}
        missing = set(self.output.emit).difference(columns)
        if missing:
            raise ValueError(f"emit references undeclared columns: {sorted(missing)!r}")
        text_columns = {
            column.name for column in self.input.columns if column.type == "text"
        }
        if text_columns.intersection(self.output.emit):
            raise ValueError("text columns cannot be emitted")
        return self


class NormalizerDefinition(_StrictModel):
    schema_version: Literal[1]
    id: Identifier
    display_name: DisplayName
    priority: Annotated[int, Field(ge=-10000, le=10000)]
    detect: DetectionSpec
    rules: tuple[ProjectionRule, ...]

    @field_validator("priority")
    @classmethod
    def reject_boolean_priority(cls, value: int) -> int:
        if isinstance(value, bool):
            raise ValueError("priority must be an integer")
        return value

    @field_validator("rules")
    @classmethod
    def validate_rule_ids(cls, rules: tuple[ProjectionRule, ...]) -> tuple[ProjectionRule, ...]:
        ids = [rule.id for rule in rules]
        if len(ids) != len(set(ids)):
            raise ValueError("rule IDs must be unique")
        return rules
