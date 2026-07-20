from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.core import MalformedBlock, SelectiveMask
from vasp_analyzer.parsing.adapters import ParsedStructure, parse_poscar
from vasp_analyzer.parsing.dialects import HOME_BARRIER, STANDARD

FIXTURES = Path(__file__).parents[3] / "fixtures" / "poscar"


def test_direct_positions_and_selective_masks_are_converted_to_owned_contracts() -> None:
    parsed = parse_poscar(FIXTURES / "standard-direct.vasp", STANDARD)

    assert isinstance(parsed, ParsedStructure)
    assert parsed.lattice == ((2.0, 0.0, 0.0), (0.0, 2.0, 0.0), (0.0, 0.0, 2.0))
    assert parsed.fractional_positions == ((0.0, 0.0, 0.0), (0.5, 0.5, 0.5))
    assert parsed.cartesian_positions == ((0.0, 0.0, 0.0), (1.0, 1.0, 1.0))
    assert tuple(site.element for site in parsed.sites) == ("Y", "O")
    assert tuple(site.site_index for site in parsed.sites) == (0, 1)
    assert tuple(site.selective_dynamics.as_tuple() for site in parsed.sites) == (
        (True, False, True),
        (False, False, True),
    )
    assert parsed.provenance.adapter == "pymatgen"
    assert parsed.provenance.adapter_version
    assert parsed.provenance.dialect == "standard"


def test_cartesian_input_has_same_normalized_positions_as_direct_input() -> None:
    direct = parse_poscar(FIXTURES / "standard-direct.vasp", STANDARD)
    cartesian = parse_poscar(FIXTURES / "standard-cartesian.vasp", STANDARD)

    assert cartesian.sites == direct.sites
    assert cartesian.fractional_positions == direct.fractional_positions
    assert cartesian.cartesian_positions == direct.cartesian_positions


def test_absent_selective_dynamics_is_preserved_as_unknown() -> None:
    parsed = parse_poscar(FIXTURES / "no-selective.vasp", STANDARD)

    assert tuple(site.selective_dynamics for site in parsed.sites) == (
        SelectiveMask(x=None, y=None, z=None),
        SelectiveMask(x=None, y=None, z=None),
    )


def test_skewed_lattice_uses_pymatgen_coordinate_conversion() -> None:
    parsed = parse_poscar(FIXTURES / "skewed.vasp", STANDARD)

    assert parsed.lattice == ((2.0, 0.0, 0.0), (1.0, 2.0, 0.0), (0.5, 0.25, 3.0))
    assert parsed.fractional_positions == ((0.25, 0.5, 0.75),)
    assert parsed.cartesian_positions[0] == pytest.approx((1.375, 1.1875, 2.25))


def test_home_metadata_normalizes_to_standard_structure() -> None:
    standard = parse_poscar(FIXTURES / "standard-direct.vasp", STANDARD)
    home = parse_poscar(FIXTURES / "home-zero.vasp", HOME_BARRIER)
    assert home.sites == standard.sites
    assert home.fractional_positions == standard.fractional_positions
    assert home.provenance.compatibility_metadata == ("0",)
    assert home.provenance.normalization_rules == ("poscar.drop_exact_line_after",)


def test_unknown_compatibility_line_reports_line_and_content() -> None:
    with pytest.raises(MalformedBlock, match=r"line 9.*custom"):
        parse_poscar(FIXTURES / "invalid-custom.vasp", HOME_BARRIER)


def test_parsed_structure_is_deeply_immutable() -> None:
    parsed = parse_poscar(FIXTURES / "standard-direct.vasp", STANDARD)

    with pytest.raises(ValidationError):
        parsed.sites[0].element = "Ba"


def test_invalid_utf8_is_rejected_strictly(tmp_path: Path) -> None:
    path = tmp_path / "POSCAR"
    path.write_bytes(b"fixture\n\xff")

    with pytest.raises(UnicodeDecodeError):
        parse_poscar(path, STANDARD)
