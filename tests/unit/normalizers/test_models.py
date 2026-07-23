import json
from copy import deepcopy
from importlib.resources import files

import pytest
from pydantic import ValidationError

from vasp_analyzer.normalizers.models import NormalizerDefinition


HOME_DEFINITION = {
    "schemaVersion": 1,
    "id": "home-barrier",
    "displayName": "Home VASP Barrier",
    "priority": 100,
    "detect": {
        "all": ["vasp.5.4.1-barrier"],
        "any": ["POSITION", "TOTAL-FORCE"],
        "none": [],
    },
    "rules": [
        {
            "id": "named-position-force-row",
            "scope": {
                "start": {"containsAll": ["POSITION", "TOTAL-FORCE"]},
                "after": {"type": "dashedSeparator"},
                "rowCount": {"source": "atomCount"},
            },
            "input": {
                "tokenizer": "whitespace",
                "columns": [
                    {"name": "species", "type": "elementLabel", "allowedSuffixes": ["_"]},
                    {"name": "local_index", "type": "positiveInteger"},
                    {"name": "x", "type": "finiteFloat"},
                    {"name": "y", "type": "finiteFloat"},
                    {"name": "z", "type": "finiteFloat"},
                    {"name": "fx", "type": "finiteFloat"},
                    {"name": "fy", "type": "finiteFloat"},
                    {"name": "fz", "type": "finiteFloat"},
                ],
            },
            "output": {
                "emit": ["x", "y", "z", "fx", "fy", "fz"],
                "separator": "  ",
            },
        }
    ],
}


def test_accepts_exact_schema_one_definition_as_frozen_tuple_models() -> None:
    definition = NormalizerDefinition.model_validate(HOME_DEFINITION)

    assert definition.rules[0].output.emit == ("x", "y", "z", "fx", "fy", "fz")
    assert isinstance(definition.rules, tuple)
    with pytest.raises(ValidationError):
        definition.priority = 1


@pytest.mark.parametrize(
    "change",
    [
        lambda value: value.update(execute="python x.py"),
        lambda value: value["rules"][0]["input"]["columns"][0].update(type="regex"),
        lambda value: value["rules"][0].update(replaceRegex=".*"),
    ],
)
def test_rejects_unknown_keys_field_types_and_regex_operations(change) -> None:
    candidate = deepcopy(HOME_DEFINITION)
    change(candidate)

    with pytest.raises(ValidationError):
        NormalizerDefinition.model_validate(candidate)


def test_rejects_duplicate_column_names() -> None:
    candidate = deepcopy(HOME_DEFINITION)
    candidate["rules"][0]["input"]["columns"][1]["name"] = "species"

    with pytest.raises(ValidationError, match="unique"):
        NormalizerDefinition.model_validate(candidate)


def test_rejects_emit_references_that_are_not_declared_columns() -> None:
    candidate = deepcopy(HOME_DEFINITION)
    candidate["rules"][0]["output"]["emit"][0] = "missing"

    with pytest.raises(ValidationError, match="emit"):
        NormalizerDefinition.model_validate(candidate)


@pytest.mark.parametrize("literal", ["배리어", "POSITION\nTOTAL-FORCE", ""])
def test_rejects_non_ascii_control_or_empty_detection_literals(literal: str) -> None:
    candidate = deepcopy(HOME_DEFINITION)
    candidate["detect"]["all"] = [literal]

    with pytest.raises(ValidationError, match="literal"):
        NormalizerDefinition.model_validate(candidate)


@pytest.mark.parametrize("suffix", [".*", "/", "é", "two words", ""])
def test_rejects_unsafe_element_suffixes(suffix: str) -> None:
    candidate = deepcopy(HOME_DEFINITION)
    candidate["rules"][0]["input"]["columns"][0]["allowedSuffixes"] = [suffix]

    with pytest.raises(ValidationError, match="suffix"):
        NormalizerDefinition.model_validate(candidate)


def test_column_properties_are_specific_to_the_declared_type() -> None:
    candidate = deepcopy(HOME_DEFINITION)
    candidate["rules"][0]["input"]["columns"][1]["allowedSuffixes"] = ["_"]
    with pytest.raises(ValidationError):
        NormalizerDefinition.model_validate(candidate)

    candidate = deepcopy(HOME_DEFINITION)
    candidate["rules"][0]["input"]["columns"][1].update(type="literal")
    with pytest.raises(ValidationError):
        NormalizerDefinition.model_validate(candidate)


def test_checked_in_schema_matches_the_model_schema() -> None:
    resource = files("vasp_analyzer.normalizers.definitions").joinpath("schema.json")
    assert json.loads(resource.read_text(encoding="utf-8")) == (
        NormalizerDefinition.model_json_schema()
    )
