from pathlib import Path

import pytest

from vasp_analyzer.core import MalformedBlock, ProfileValidationError
from vasp_analyzer.parsing.profiles import (
    CompatibilityProfile,
    load_profile,
    normalize_poscar,
)

FIXTURES = Path(__file__).parents[3] / "fixtures"


def test_profile_loads_only_supported_declarative_rules() -> None:
    profile = load_profile(FIXTURES / "profiles" / "home-example.toml")
    assert profile.schema_version == 1
    assert profile.poscar.drop_exact_line == "0"


@pytest.mark.parametrize(
    "source",
    [
        "schema_version = 2\nid = 'x'\n",
        "schema_version = 1\nid = 'x'\npython = 'payload.py'\n",
        "schema_version = 1\nid = 'x'\n[poscar]\ndrop_regex = '.*'\n",
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
