import json
from importlib.resources import files
from pathlib import Path

import pytest

from vasp_analyzer.normalizers.errors import NormalizerDefinitionError
from vasp_analyzer.normalizers.registry import (
    NormalizerMatch,
    load_registry,
    select_normalizer,
)


def _definition(identifier: str, priority: int, detect: dict | None = None) -> dict:
    return {
        "schemaVersion": 1,
        "id": identifier,
        "displayName": identifier,
        "priority": priority,
        "detect": detect or {"all": [], "any": [], "none": []},
        "rules": [],
    }


def _write(directory: Path, name: str, definition: dict) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(definition), encoding="utf-8")
    return path


def test_loads_packaged_built_ins_and_exact_home_definition(tmp_path: Path) -> None:
    registry = load_registry({}, tmp_path)

    assert [entry.definition.id for entry in registry] == ["home-barrier", "standard"]
    assert all(entry.source.built_in for entry in registry)
    resource = files("vasp_analyzer.normalizers.definitions").joinpath("home_barrier.json")
    home = next(entry for entry in registry if entry.definition.id == "home-barrier")
    assert json.loads(resource.read_text(encoding="utf-8")) == json.loads(
        home.definition.model_dump_json(by_alias=True)
    )
    assert home.definition.rules[0].input.columns[0].allowed_suffixes == ("_",)


def test_uses_xdg_config_home_instead_of_home_fallback(tmp_path: Path) -> None:
    xdg = tmp_path / "xdg"
    home = tmp_path / "home"
    _write(xdg / "vasp-analyzer" / "normalizers", "z.json", _definition("xdg", 2))
    _write(home / ".config" / "vasp-analyzer" / "normalizers", "a.json", _definition("home", 1))

    registry = load_registry({"XDG_CONFIG_HOME": str(xdg)}, home)

    assert "xdg" in [entry.definition.id for entry in registry]
    assert "home" not in [entry.definition.id for entry in registry]


def test_uses_home_config_fallback_and_sorts_user_paths(tmp_path: Path) -> None:
    directory = tmp_path / ".config" / "vasp-analyzer" / "normalizers"
    _write(directory, "z.json", _definition("zeta", 2))
    _write(directory, "a.json", _definition("alpha", 1))

    users = [entry for entry in load_registry({}, tmp_path) if not entry.source.built_in]

    assert [Path(entry.source.path).name for entry in users] == ["a.json", "z.json"]


def test_duplicate_ids_fail_closed_with_both_paths(tmp_path: Path) -> None:
    path = _write(
        tmp_path / ".config" / "vasp-analyzer" / "normalizers",
        "duplicate.json",
        _definition("standard", 1),
    )

    with pytest.raises(NormalizerDefinitionError, match="duplicate.*standard") as error:
        load_registry({}, tmp_path)
    assert str(path) in str(error.value)
    assert "standard.json" in str(error.value)


@pytest.mark.parametrize("content", ["{", '{"schemaVersion": 1}', b"\xff"])
def test_invalid_user_definition_fails_closed(
    tmp_path: Path, content: str | bytes
) -> None:
    directory = tmp_path / ".config" / "vasp-analyzer" / "normalizers"
    directory.mkdir(parents=True)
    path = directory / "bad.json"
    path.write_bytes(content if isinstance(content, bytes) else content.encode())

    with pytest.raises(NormalizerDefinitionError) as error:
        load_registry({}, tmp_path)
    assert str(path) in str(error.value)


def test_selects_highest_priority_deterministically_for_all_any_none() -> None:
    registry = (
        NormalizerMatch.from_definition(
            _definition("lower", 10, {"all": ["A"], "any": ["B", "C"], "none": ["NO"]})
        ),
        NormalizerMatch.from_definition(
            _definition("higher", 20, {"all": ["A"], "any": ["C"], "none": []})
        ),
        NormalizerMatch.from_definition(_definition("standard", 0)),
    )

    assert select_normalizer(b"A C", registry).definition.id == "higher"
    assert select_normalizer(b"A B NO", registry).definition.id == "standard"


def test_equal_highest_priority_is_ambiguous() -> None:
    registry = (
        NormalizerMatch.from_definition(_definition("one", 10, {"all": ["A"]})),
        NormalizerMatch.from_definition(_definition("two", 10, {"all": ["A"]})),
        NormalizerMatch.from_definition(_definition("standard", 0)),
    )

    with pytest.raises(NormalizerDefinitionError, match="ambiguous.*one.*two"):
        select_normalizer(b"A", registry)


def test_detection_is_byte_oriented_and_bounded_to_one_mib() -> None:
    registry = (
        NormalizerMatch.from_definition(
            _definition("late", 10, {"all": ["MAGIC"], "any": [], "none": []})
        ),
        NormalizerMatch.from_definition(_definition("standard", 0)),
    )

    assert select_normalizer(b"x" * (1024 * 1024) + b"MAGIC", registry).definition.id == "standard"


def test_standard_is_fallback_even_though_empty_detection_matches() -> None:
    registry = load_registry({}, Path.home())

    assert select_normalizer(b"ordinary VASP output", registry).definition.id == "standard"
