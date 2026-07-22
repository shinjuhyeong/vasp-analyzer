from pathlib import Path

import pytest

from vasp_analyzer.core import MalformedBlock, ProfileValidationError
from vasp_analyzer.parsing.profiles import (
    CompatibilityProfile,
    DetailMarkers,
    EnergyTermRule,
    load_profile,
    normalize_poscar,
)

FIXTURES = Path(__file__).parents[3] / "fixtures"


def test_profile_loads_only_supported_declarative_rules() -> None:
    profile = load_profile(FIXTURES / "profiles" / "home-example.toml")
    assert profile.schema_version == 1
    assert profile.poscar.drop_exact_line == "0"
    assert profile.validation.force_prefix_columns == 2
    assert profile.outcar.details.energy_section == (
        "FREE ENERGIE OF THE ION-ELECTRON SYSTEM",
        "HOME FREE ENERGY SUMMARY",
    )
    assert profile.outcar.details.parameter_sections == (
        "INCAR:",
        "Startparameter for this Run",
        "HOME PARAMETERS:",
    )
    assert profile.outcar.details.parameter_section_end == (
        "VRHFIN",
        "------------------------------",
        "HOME HEADER END",
    )
    assert profile.outcar.energy_terms[1] == EnergyTermRule(
        key="home_correction",
        labels=("home correction",),
        kind="contribution",
    )


def test_profile_accepts_bounded_declarative_energy_aliases(tmp_path: Path) -> None:
    path = tmp_path / "profile.toml"
    path.write_text(
        """
schema_version = 1
id = "home"
display_name = "Home"
[[outcar.energy_terms]]
key = "ewald"
labels = ["Ewald energy", "EWALD contribution"]
kind = "contribution"
""",
        encoding="utf-8",
    )

    profile = load_profile(path)

    assert profile.outcar.energy_terms[0].key == "ewald"
    assert next(item for item in profile.outcar.energy_terms if item.key == "toten").kind == "aggregate"


def test_profile_accepts_declarative_parameter_section_boundaries(tmp_path: Path) -> None:
    path = tmp_path / "parameter-boundary.toml"
    path.write_text(
        "schema_version = 1\nid = 'home'\ndisplay_name = 'Home'\n"
        "[outcar.details]\n"
        "parameter_sections = ['HOME PARAMS:']\n"
        "parameter_section_end = ['HOME HEADER END']\n",
        encoding="utf-8",
    )

    profile = load_profile(path)

    assert profile.outcar.details.parameter_section_end == ("HOME HEADER END",)


def test_default_detail_markers_are_stable() -> None:
    profile = CompatibilityProfile(schema_version=1, id="standard", display_name="Standard")

    assert profile.outcar.details == DetailMarkers()
    assert "Startparameter for this Run" in profile.outcar.details.parameter_sections
    assert "------------------------------" in profile.outcar.details.parameter_section_end


@pytest.mark.parametrize("field", ["python", "command", "regex", "expression"])
def test_profile_rejects_executable_detail_rules(tmp_path: Path, field: str) -> None:
    path = tmp_path / f"bad-{field}.toml"
    path.write_text(
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n"
        f"[outcar.details]\n{field} = 'x'\n",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError):
        load_profile(path)


@pytest.mark.parametrize(
    "rule",
    [
        "key = 'UpperCase'\nlabels = ['x']\nkind = 'contribution'",
        "key = 'x'\nlabels = []\nkind = 'contribution'",
        "key = 'x'\nlabels = ['']\nkind = 'contribution'",
        "key = 'x'\nlabels = ['x']\nkind = 'other'",
    ],
)
def test_profile_rejects_invalid_energy_rules(tmp_path: Path, rule: str) -> None:
    path = tmp_path / "invalid-energy.toml"
    path.write_text(
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n"
        f"[[outcar.energy_terms]]\n{rule}\n",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError):
        load_profile(path)


def test_profile_rejects_case_insensitive_alias_ambiguity(tmp_path: Path) -> None:
    path = tmp_path / "ambiguous-energy.toml"
    path.write_text(
        """
schema_version = 1
id = "x"
display_name = "X"
[[outcar.energy_terms]]
key = "first"
labels = ["Home term"]
kind = "contribution"
[[outcar.energy_terms]]
key = "second"
labels = ["HOME TERM"]
kind = "aggregate"
""",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError, match="ambiguous"):
        load_profile(path)


def test_profile_rejects_duplicate_energy_keys(tmp_path: Path) -> None:
    path = tmp_path / "duplicate-energy-key.toml"
    path.write_text(
        """
schema_version = 1
id = "x"
display_name = "X"
[[outcar.energy_terms]]
key = "home"
labels = ["first"]
kind = "contribution"
[[outcar.energy_terms]]
key = "home"
labels = ["second"]
kind = "aggregate"
""",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError, match="duplicate"):
        load_profile(path)


@pytest.mark.parametrize(
    "source",
    [
        "schema_version = 2\nid = 'x'\ndisplay_name = 'X'\n",
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\npython = 'payload.py'\n",
        (
            "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n"
            "[poscar]\ndrop_regex = '.*'\n"
        ),
    ],
)
def test_profile_rejects_unknown_versions_and_executable_rules(
    tmp_path: Path, source: str
) -> None:
    path = tmp_path / "bad.toml"
    path.write_text(source, encoding="utf-8")
    with pytest.raises(ProfileValidationError):
        load_profile(path)


@pytest.mark.parametrize(
    "poscar_rule",
    [
        'drop_exact_line_after = "Selective dynamics"',
        'drop_exact_line = "0"',
    ],
)
def test_profile_rejects_incomplete_poscar_rules(tmp_path: Path, poscar_rule: str) -> None:
    path = tmp_path / "ambiguous.toml"
    path.write_text(
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n[poscar]\n"
        f"{poscar_rule}\n",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError):
        load_profile(path)


def test_profile_rejects_non_integer_drop_line(tmp_path: Path) -> None:
    path = tmp_path / "non-integer-drop.toml"
    path.write_text(
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n"
        "[poscar]\ndrop_exact_line_after = 'Selective dynamics'\n"
        "drop_exact_line = 'custom'\n",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError):
        load_profile(path)


@pytest.mark.parametrize(
    "source",
    [
        "schemaVersion = 1\nid = 'x'\ndisplay_name = 'X'\n",
        "schema_version = 1\nid = 'x'\ndisplayName = 'X'\n",
        (
            "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n"
            "[poscar]\ndrop_exact_line_after = 'Selective dynamics'\n"
            "dropExactLine = '0'\n"
        ),
    ],
)
def test_profile_rejects_camel_case_toml_aliases(tmp_path: Path, source: str) -> None:
    path = tmp_path / "camel-case.toml"
    path.write_text(source, encoding="utf-8")

    with pytest.raises(ProfileValidationError):
        load_profile(path)


@pytest.mark.parametrize(
    "invalid_field",
    [
        '[detection]\npriority = "100"',
        '[validation]\nallow_incomplete_tail = "false"',
    ],
)
def test_profile_rejects_invalid_scalar_types(tmp_path: Path, invalid_field: str) -> None:
    path = tmp_path / "invalid-type.toml"
    path.write_text(
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n" f"{invalid_field}\n",
        encoding="utf-8",
    )

    with pytest.raises(ProfileValidationError):
        load_profile(path)


def test_profile_wraps_invalid_utf8(tmp_path: Path) -> None:
    path = tmp_path / "invalid-utf8.toml"
    path.write_bytes(b"\xff")

    with pytest.raises(ProfileValidationError, match="invalid-utf8.toml"):
        load_profile(path)


@pytest.mark.parametrize(
    "source",
    [
        "schema_version = 1\nid = '   '\ndisplay_name = 'X'\n",
        "schema_version = 1\nid = 'x'\ndisplay_name = ''\n",
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n[detection]\noutcar_contains = ['']\n",
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n[outcar.markers]\nposition_force = []\n",
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n[outcar.markers]\nposition_force = ['POSITION', 'position']\n",
        "schema_version = 1\nid = '" + ("x" * 257) + "'\ndisplay_name = 'X'\n",
    ],
)
def test_profile_rejects_empty_or_duplicate_bounded_markers(tmp_path: Path, source: str) -> None:
    path = tmp_path / "unsafe.toml"
    path.write_text(source, encoding="utf-8")
    with pytest.raises(ProfileValidationError):
        load_profile(path)


def test_normalizer_drops_only_declared_metadata_and_records_provenance() -> None:
    profile = load_profile(FIXTURES / "profiles" / "home-example.toml")
    source = "Header\nSelective dynamics\n0\nDirect\n0 0 0 T T T\n"

    result = normalize_poscar(source, profile)

    assert result.text == "Header\nSelective dynamics\nDirect\n0 0 0 T T T\n"
    assert result.applied_rules == ("poscar.drop_exact_line_after",)
    assert result.compatibility_metadata == ("0",)
    provenance = result.provenance("pymatgen", "1", "home")
    assert provenance.normalization_rules == result.applied_rules
    assert provenance.compatibility_metadata == ("0",)


def test_normalizer_accepts_whitespace_padded_declared_integer_metadata() -> None:
    profile = load_profile(FIXTURES / "profiles" / "home-example.toml")
    source = "Header\nSelective dynamics\n   0   \nDirect\n0 0 0 T T T\n"

    result = normalize_poscar(source, profile)

    assert result.text == "Header\nSelective dynamics\nDirect\n0 0 0 T T T\n"
    assert result.compatibility_metadata == ("0",)


def test_normalizer_returns_standard_poscar_unchanged() -> None:
    profile = CompatibilityProfile(schema_version=1, id="standard", display_name="Standard")
    source = "Header\nDirect\n0 0 0\n"

    result = normalize_poscar(source, profile)

    assert result.text == source
    assert result.applied_rules == ()
    assert result.compatibility_metadata == ()


def test_normalizer_rejects_unknown_line_with_location_and_content() -> None:
    profile = load_profile(FIXTURES / "profiles" / "home-example.toml")
    source = "Header\nSelective dynamics\ncustom\nDirect\n"

    with pytest.raises(MalformedBlock, match=r"line 3.*custom"):
        normalize_poscar(source, profile)
