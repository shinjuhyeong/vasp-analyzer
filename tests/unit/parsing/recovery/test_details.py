import math

import pytest

from vasp_analyzer.core import EnergyTerm, OutcarFormatError, ParameterOccurrence
from vasp_analyzer.parsing.profiles import CompatibilityProfile
from vasp_analyzer.parsing.recovery import (
    parse_energy_line,
    parse_parameter_assignments,
    parse_pressure_line,
    parse_stress_rows,
    parse_volume_line,
)


STANDARD = CompatibilityProfile(
    schema_version=1, id="standard", display_name="Standard"
).outcar


@pytest.mark.parametrize(
    ("line", "key", "raw_label", "value", "kind"),
    [
        (b"  alpha Z        PSCENC = 12.5\n", "ewald", "alpha Z PSCENC", 12.5, "contribution"),
        (b"  Ewald energy   TEWEN  = -1.2D+02 eV\n", "ewald", "Ewald energy TEWEN", -120.0, "contribution"),
        (b"  -Hartree energ DENC   = 4.0\n", "hartree", "-Hartree energ DENC", 4.0, "contribution"),
        (b"  -exchange      EXHF   = -3.0\n", "exchange_correlation", "-exchange EXHF", -3.0, "contribution"),
        (b"  -V(xc)+E(xc)   XCENC  = -2.0\n", "exchange_correlation", "-V(xc)+E(xc) XCENC", -2.0, "contribution"),
        (b"  PAW double counting   = 1.0 -2.0\n", "paw_double_counting", "PAW double counting", -1.0, "contribution"),
        (b"  entropy T*S    EENTRO = -0.25\n", "entropy_ts", "entropy T*S EENTRO", -0.25, "contribution"),
        (b"  eigenvalues    EBANDS = -8.0\n", "eigenvalues", "eigenvalues EBANDS", -8.0, "contribution"),
        (b"  atomic energy  EATOM  = 2.0\n", "atomic_energy", "atomic energy EATOM", 2.0, "contribution"),
        (b" free  energy   TOTEN  = -10.0 eV\n", "toten", "free energy TOTEN", -10.0, "aggregate"),
        (b" energy  without entropy= -9.9 eV\n", "energy_without_entropy", "energy without entropy", -9.9, "aggregate"),
        (b" energy(sigma->0) = -9.8 eV\n", "sigma_to_zero", "energy(sigma->0)", -9.8, "aggregate"),
    ],
)
def test_energy_parser_recognizes_standard_terms(
    line: bytes, key: str, raw_label: str, value: float, kind: str
) -> None:
    parsed = parse_energy_line(line, STANDARD)

    assert parsed == EnergyTerm(
        key=key,
        raw_label=raw_label,
        value=value,
        unit="eV",
        kind=kind,
    )


def test_energy_parser_preserves_unknown_finite_labels() -> None:
    parsed = parse_energy_line(b"  home correction = -1.2500 eV\n", STANDARD)

    assert parsed == EnergyTerm(
        key="home_correction",
        raw_label="home correction",
        value=-1.25,
        unit="eV",
        kind="contribution",
    )


def test_energy_parser_returns_none_for_non_assignment() -> None:
    assert parse_energy_line(b"-----\n", STANDARD) is None


def test_energy_parser_fails_closed_on_a_non_numeric_assignment() -> None:
    with pytest.raises(OutcarFormatError, match="numeric"):
        parse_energy_line(b"home correction = unknown\n", STANDARD)


@pytest.mark.parametrize("token", [b"nan", b"inf", b"-inf", b"1e999"])
def test_energy_parser_rejects_non_finite_values(token: bytes) -> None:
    with pytest.raises(OutcarFormatError, match="non-finite"):
        parse_energy_line(b"home correction = " + token + b" eV\n", STANDARD)


def test_pressure_parser_reads_external_and_pulay_values() -> None:
    assert parse_pressure_line(
        b" external pressure = -12.5 kB  Pullay stress = 3.25D+00 kB\n",
        STANDARD,
    ) == pytest.approx((-12.5, 3.25))


def test_pressure_parser_returns_none_for_unrecognized_line() -> None:
    assert parse_pressure_line(b"random pressure = 1 kB\n", STANDARD) is None


def test_volume_parser_reads_positive_cell_volume() -> None:
    assert parse_volume_line(b" volume of cell : 1.234D+02\n", STANDARD) == pytest.approx(123.4)


@pytest.mark.parametrize("token", [b"0", b"-2", b"nan"])
def test_volume_parser_rejects_non_positive_or_non_finite_values(token: bytes) -> None:
    with pytest.raises(OutcarFormatError):
        parse_volume_line(b" volume of cell : " + token + b"\n", STANDARD)


def test_stress_parser_maps_vasp_six_component_order_to_symmetric_tensor() -> None:
    parsed = parse_stress_rows((b" Total  1 2 3 4 5 6\n",))

    assert parsed == ((1.0, 4.0, 6.0), (4.0, 2.0, 5.0), (6.0, 5.0, 3.0))


def test_stress_parser_accepts_vasp_in_kb_prefix() -> None:
    parsed = parse_stress_rows((b" in kB  1 2 3 4 5 6\n",))

    assert parsed == ((1.0, 4.0, 6.0), (4.0, 2.0, 5.0), (6.0, 5.0, 3.0))


def test_stress_parser_accepts_exact_three_by_three_rows() -> None:
    parsed = parse_stress_rows((b"1 2 3\n", b"4 5 6\n", b"7 8 9\n"))

    assert parsed == ((1.0, 2.0, 3.0), (4.0, 5.0, 6.0), (7.0, 8.0, 9.0))


@pytest.mark.parametrize(
    "rows",
    [
        (b"Total 1 2 3 4 5\n",),
        (b"1 2 3\n", b"4 5 6\n"),
        (b"1 2 3\n", b"4 nope 6\n", b"7 8 9\n"),
        (b"1 2 3\n", b"4 5 6\n", b"7 8 nan\n"),
    ],
)
def test_stress_parser_rejects_malformed_complete_layouts(rows: tuple[bytes, ...]) -> None:
    with pytest.raises(OutcarFormatError):
        parse_stress_rows(rows)


def test_parameter_parser_preserves_order_repeats_and_coerces_safe_types() -> None:
    parsed = parse_parameter_assignments(
        b" ENCUT = 520; LREAL = F; NELM = 120; EDIFF = 1D-06; "
        b"FERWE = 1.0 0.5 -0.5; HOME_TAG = alpha-beta\n",
        start_ordinal=7,
        line_number=42,
    )

    assert parsed == (
        ParameterOccurrence(key="encut", raw_key="ENCUT", raw_value="520", value=520, ordinal=7, line_number=42),
        ParameterOccurrence(key="lreal", raw_key="LREAL", raw_value="F", value=False, ordinal=8, line_number=42),
        ParameterOccurrence(key="nelm", raw_key="NELM", raw_value="120", value=120, ordinal=9, line_number=42),
        ParameterOccurrence(key="ediff", raw_key="EDIFF", raw_value="1D-06", value=1e-6, ordinal=10, line_number=42),
        ParameterOccurrence(key="ferwe", raw_key="FERWE", raw_value="1.0 0.5 -0.5", value=(1.0, 0.5, -0.5), ordinal=11, line_number=42),
        ParameterOccurrence(key="home_tag", raw_key="HOME_TAG", raw_value="alpha-beta", value="alpha-beta", ordinal=12, line_number=42),
    )


def test_parameter_parser_keeps_repeated_assignments() -> None:
    parsed = parse_parameter_assignments(b"ENCUT = 400; ENCUT = 520\n")

    assert [item.value for item in parsed] == [400, 520]


def test_parameter_parser_tokenizes_space_separated_vasp_assignments() -> None:
    parsed = parse_parameter_assignments(b"ENCUT = 400  NELM = 60  LREAL = T\n")

    assert [(item.key, item.value) for item in parsed] == [
        ("encut", 400),
        ("nelm", 60),
        ("lreal", True),
    ]


def test_parameter_parser_extracts_a_numeric_unit_without_losing_raw_value() -> None:
    parsed = parse_parameter_assignments(b"ENCUT = 520.0 eV\n")

    assert parsed[0].value == pytest.approx(520.0)
    assert parsed[0].unit == "eV"
    assert parsed[0].raw_value == "520.0 eV"


def test_parameter_parser_rejects_non_finite_numeric_values() -> None:
    for token in (b"NaN", b"Inf", b"1D999", b"NaN eV"):
        with pytest.raises(OutcarFormatError, match="non-finite"):
            parse_parameter_assignments(b"HOME = " + token + b"\n")


def test_parameter_parser_fails_closed_on_malformed_assignment() -> None:
    with pytest.raises(OutcarFormatError, match="malformed"):
        parse_parameter_assignments(b"HOME == 1\n")


def test_parameter_parser_keeps_ambiguous_mixed_value_as_raw_string() -> None:
    parsed = parse_parameter_assignments(b"HOME = 1.0 alpha\n")

    assert parsed[0].value == "1.0 alpha"
    assert math.isfinite(float(parsed[0].raw_value.split()[0]))
