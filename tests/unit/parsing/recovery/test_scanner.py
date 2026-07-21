from dataclasses import replace
from pathlib import Path

import pytest

from vasp_analyzer.core import OutcarFormatError
from vasp_analyzer.parsing.dialects import HOME_BARRIER
from vasp_analyzer.parsing.recovery import scan_outcar


FIXTURES = Path(__file__).parents[3] / "fixtures" / "outcar"
PREFIX = (FIXTURES / "appended-prefix.OUTCAR").read_bytes()
SUFFIX = b""" direct lattice vectors                 reciprocal lattice vectors
   3.010000 0.000000 0.000000  0.332226 0.000000 0.000000
   0.000000 3.010000 0.000000  0.000000 0.332226 0.000000
   0.000000 0.000000 3.010000  0.000000 0.000000 0.332226
 POSITION                                       TOTAL-FORCE (eV/Angst)
 -----------------------------------------------------------------------------------
   0.010000 0.000000 0.000000  0.050000 0.000000 0.000000
   1.490000 1.500000 1.500000 -0.050000 0.000000 0.000000
 free energy    TOTEN  =       -10.100000 eV
"""


def strict_tail_dialect():  # type: ignore[no-untyped-def]
    strict_validation = HOME_BARRIER.profile.validation.model_copy(
        update={"allow_incomplete_tail": False}
    )
    strict_profile = HOME_BARRIER.profile.model_copy(update={"validation": strict_validation})
    return replace(HOME_BARRIER, profile=strict_profile)


def test_complete_records_capture_offsets_lattice_forces_and_energy() -> None:
    result = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)

    assert [step.step_id for step in result.steps] == [0, 1]
    assert result.steps[0].atom_count == 2
    assert result.steps[0].lattice[0] == (3.0, 0.0, 0.0)
    assert result.steps[1].cartesian_positions[0] == (0.01, 0.0, 0.0)
    assert result.steps[1].raw_forces[1] == (-0.05, 0.0, 0.0)
    assert result.steps[1].energy == -10.1
    assert result.steps[0].block_start < result.steps[0].block_end
    assert result.steps[0].block_end <= result.steps[1].block_start
    assert result.normally_finished is True


def test_details_attach_to_the_force_record_that_precedes_them() -> None:
    scan = scan_outcar(FIXTURES / "detail-complete-two-step.OUTCAR", HOME_BARRIER)

    assert [step.energy for step in scan.steps] == [-10.0, -11.0]
    assert [step.energy_terms[0].key for step in scan.steps] == ["ewald", "ewald"]
    assert [term.key for term in scan.steps[0].energy_terms[-2:]] == [
        "energy_without_entropy",
        "sigma_to_zero",
    ]
    assert [term.value for term in scan.steps[0].energy_terms[-2:]] == pytest.approx([-9.9, -9.8])
    assert scan.steps[0].external_pressure_kb == pytest.approx(5.0)
    assert scan.steps[0].pulay_stress_kb == pytest.approx(0.5)
    assert scan.steps[0].stress_tensor_kb == (
        (1.0, 0.1, 0.3),
        (0.1, 2.0, 0.2),
        (0.3, 0.2, 3.0),
    )
    assert scan.steps[1].cell_volume == pytest.approx(180.0)
    assert [item.raw_key for item in scan.parameters].count("ENCUT") == 2


def test_pre_force_details_attach_to_the_next_force_record() -> None:
    scan = scan_outcar(FIXTURES / "detail-pre-force-two-step.OUTCAR", HOME_BARRIER)

    assert [step.energy for step in scan.steps] == [-20.0, -21.0]
    assert [step.cell_volume for step in scan.steps] == pytest.approx([125.0, 216.0])
    assert [step.external_pressure_kb for step in scan.steps] == pytest.approx([8.0, -3.0])
    assert [step.stress_tensor_kb for step in scan.steps] == [
        ((1.0, 0.1, 0.3), (0.1, 2.0, 0.2), (0.3, 0.2, 3.0)),
        ((4.0, 0.4, 0.6), (0.4, 5.0, 0.5), (0.6, 0.5, 6.0)),
    ]


def test_append_resume_replays_pre_force_details_once(tmp_path: Path) -> None:
    truncated = (FIXTURES / "detail-pre-force-truncated.OUTCAR").read_bytes()
    complete = (FIXTURES / "detail-pre-force-two-step.OUTCAR").read_bytes()
    assert complete.startswith(truncated)
    path = tmp_path / "OUTCAR"
    path.write_bytes(truncated)

    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(complete)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [step.step_id for step in first.steps] == [0]
    assert [warning.category for warning in first.warnings] == ["IncompleteTail"]
    assert first.checkpoint.replay_provisional is True
    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [1]
    assert second.steps[0].cell_volume == pytest.approx(216.0)
    assert second.steps[0].external_pressure_kb == pytest.approx(-3.0)
    assert second.steps[0].stress_tensor_kb == (
        (4.0, 0.4, 0.6),
        (0.4, 5.0, 0.5),
        (0.6, 0.5, 6.0),
    )
    assert second.parameters == ()


def test_pre_lattice_volumes_attach_to_the_matching_force_records() -> None:
    scan = scan_outcar(FIXTURES / "detail-pre-lattice-two-step.OUTCAR", HOME_BARRIER)

    assert [step.energy for step in scan.steps] == [-30.0, -31.0]
    assert [step.cell_volume for step in scan.steps] == pytest.approx([125.0, 216.0])
    assert [step.external_pressure_kb for step in scan.steps] == pytest.approx([7.0, -4.0])
    assert scan.steps[0].lattice[0] == (5.0, 0.0, 0.0)
    assert scan.steps[1].lattice[0] == (6.0, 0.0, 0.0)
    assert [step.raw_forces[0][0] for step in scan.steps] == pytest.approx([0.1, 0.05])
    assert scan.steps[0].stress_tensor_kb == (
        (1.0, 0.1, 0.3),
        (0.1, 2.0, 0.2),
        (0.3, 0.2, 3.0),
    )
    assert scan.steps[1].stress_tensor_kb == (
        (4.0, 0.4, 0.6),
        (0.4, 5.0, 0.5),
        (0.6, 0.5, 6.0),
    )


def test_lattice_before_volume_does_not_consume_volume_crossing(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b"NIONS = 1 ions\n"
        b"direct lattice vectors reciprocal lattice vectors\n"
        b"4 0 0 0.25 0 0\n0 4 0 0 0.25 0\n0 0 4 0 0 0.25\n"
        b"header diagnostics\n"
        b"volume of cell : 125.0\n"
        b"direct lattice vectors reciprocal lattice vectors\n"
        b"5 0 0 0.2 0 0\n0 5 0 0 0.2 0\n0 0 5 0 0 0.2\n"
        b"FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        b"in kB 1 2 3 0.1 0.2 0.3\n"
        b"external pressure = 6.0 kB\n"
        b"POSITION TOTAL-FORCE\n--------------------\n"
        b"0 0 0 0.1 0 0\n"
        b"free energy TOTEN = -40.0 eV\n"
        b"General timing and accounting informations for this job:\n"
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert scan.steps[0].lattice[0] == (5.0, 0.0, 0.0)
    assert scan.steps[0].cell_volume == pytest.approx(125.0)
    assert scan.steps[0].external_pressure_kb == pytest.approx(6.0)


def test_append_resume_replays_lattice_before_volume_order_once(tmp_path: Path) -> None:
    truncated = (FIXTURES / "detail-initial-lattice-truncated.OUTCAR").read_bytes()
    complete = (FIXTURES / "detail-initial-lattice-two-step.OUTCAR").read_bytes()
    assert complete.startswith(truncated)
    path = tmp_path / "OUTCAR"
    path.write_bytes(truncated)

    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(complete)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [step.step_id for step in first.steps] == [0]
    assert [warning.category for warning in first.warnings] == ["IncompleteTail"]
    assert first.checkpoint.replay_provisional is True
    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [1]
    assert second.steps[0].lattice[0] == (6.0, 0.0, 0.0)
    assert second.steps[0].cell_volume == pytest.approx(216.0)
    assert second.steps[0].external_pressure_kb == pytest.approx(-5.0)
    assert second.parameters == ()


def test_append_resume_replays_pre_lattice_volume_once(tmp_path: Path) -> None:
    truncated = (FIXTURES / "detail-pre-lattice-truncated.OUTCAR").read_bytes()
    complete = (FIXTURES / "detail-pre-lattice-two-step.OUTCAR").read_bytes()
    assert complete.startswith(truncated)
    path = tmp_path / "OUTCAR"
    path.write_bytes(truncated)

    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(complete)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [step.step_id for step in first.steps] == [0]
    assert first.steps[0].cell_volume == pytest.approx(125.0)
    assert [warning.category for warning in first.warnings] == ["IncompleteTail"]
    assert first.checkpoint.replay_provisional is True
    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [1]
    assert second.steps[0].cell_volume == pytest.approx(216.0)
    assert second.steps[0].external_pressure_kb == pytest.approx(-4.0)
    assert second.steps[0].raw_forces[0][0] == pytest.approx(0.05)
    assert second.parameters == ()


def test_pre_lattice_volume_cannot_cross_a_second_lattice(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b"NIONS = 1 ions\n"
        b"volume of cell : 125.0\n"
        b"direct lattice vectors reciprocal lattice vectors\n"
        b"5 0 0 0.2 0 0\n0 5 0 0 0.2 0\n0 0 5 0 0 0.2\n"
        b"direct lattice vectors reciprocal lattice vectors\n"
    )

    with pytest.raises(OutcarFormatError, match="lattice boundary"):
        scan_outcar(path, HOME_BARRIER)


def test_pre_lattice_volume_rejects_ambiguous_pressure_before_lattice(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b"NIONS = 1 ions\n"
        b"volume of cell : 125.0\n"
        b"external pressure = 2.0 kB\n"
        b"direct lattice vectors reciprocal lattice vectors\n"
    )

    with pytest.raises(OutcarFormatError, match="lattice boundary"):
        scan_outcar(path, HOME_BARRIER)


def test_pre_lattice_volume_without_force_is_orphaned_at_normal_finish(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b"NIONS = 1 ions\n"
        b"volume of cell : 125.0\n"
        b"General timing and accounting informations for this job:\n"
    )

    with pytest.raises(OutcarFormatError, match="not followed by a force record"):
        scan_outcar(path, HOME_BARRIER)


def test_duplicate_post_force_volume_is_ambiguous(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b"external pressure = 2.0 kB\n"
        + b"volume of cell : 100.0\n"
        + b"volume of cell : 101.0\n"
    )

    with pytest.raises(OutcarFormatError, match="ambiguous"):
        scan_outcar(path, HOME_BARRIER)


def test_unsectioned_volume_after_force_is_ambiguous(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes() + b"volume of cell : 100.0\n"
    )

    with pytest.raises(OutcarFormatError, match="ambiguous"):
        scan_outcar(path, HOME_BARRIER)


def test_vasp_blank_before_combined_aggregates_does_not_end_energy_section() -> None:
    scan = scan_outcar(FIXTURES / "ase-complete-one-step.OUTCAR", HOME_BARRIER)

    assert [term.key for term in scan.steps[0].energy_terms] == [
        "toten",
        "energy_without_entropy",
        "sigma_to_zero",
    ]


def test_parameter_section_spans_header_separators_without_hiding_nions(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    content = (FIXTURES / "detail-complete-two-step.OUTCAR").read_bytes()
    path.write_bytes(
        content.replace(
            b" INCAR:\n ENCUT = 400\n ENCUT = 520\n\n",
            b" INCAR:\n ENCUT = 400\n header prose\n\n NELM = 60\n ENCUT = 520\n",
        )
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert scan.steps[0].atom_count == 1
    selected = [
        (item.raw_key, item.value) for item in scan.parameters if item.raw_key in {"ENCUT", "NELM"}
    ]
    assert selected == [
        ("ENCUT", 400),
        ("NELM", 60),
        ("ENCUT", 520),
    ]


def test_append_resume_replays_only_the_unverified_detailed_tail(tmp_path: Path) -> None:
    truncated = (FIXTURES / "detail-truncated-tail.OUTCAR").read_bytes()
    complete = (FIXTURES / "detail-complete-two-step.OUTCAR").read_bytes()
    assert complete.startswith(truncated)
    path = tmp_path / "OUTCAR"
    path.write_bytes(truncated)

    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(complete)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert first.warnings[-1].category == "IncompleteTail"
    assert first.steps[-1].stress_tensor_kb is None
    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [1]
    assert second.steps[0].stress_tensor_kb is not None
    assert second.parameters == ()


def test_complete_malformed_detailed_tensor_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    content = (FIXTURES / "detail-complete-two-step.OUTCAR").read_bytes()
    path.write_bytes(
        content.replace(
            b" in kB  2 3 4 0.2 0.3 0.4\n",
            b" in kB  2 nope 4 0.2 0.3 0.4\n",
        )
    )

    with pytest.raises(OutcarFormatError, match="stress"):
        scan_outcar(path, HOME_BARRIER)


def test_complete_wrong_stress_unit_at_eof_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        + b" in GPa 1 2 3 0.1 0.2 0.3\n"
    )

    with pytest.raises(OutcarFormatError, match="stress|in kB"):
        scan_outcar(path, HOME_BARRIER)


def test_parameter_marker_ends_an_active_energy_section(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FREE ENERGIE OF THE ION-ELECTRON SYSTEM (eV)\n"
        + b" home correction = 1.0 eV\n"
        + b" INCAR:\n"
        + b" HOME_TAG = alpha\n"
        + b" General timing and accounting informations for this job:\n"
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert [term.key for term in scan.steps[-1].energy_terms] == ["home_correction"]
    assert scan.parameters[-1].raw_key == "HOME_TAG"


@pytest.mark.parametrize(
    ("partial_line", "field"),
    [
        (b" external pressure = 1.0 k", "external_pressure_kb"),
        (b" volume of cell : 18", "cell_volume"),
    ],
)
def test_physically_truncated_detail_line_warns_without_fabricating_a_value(
    tmp_path: Path, partial_line: bytes, field: str
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes((FIXTURES / "trailing-no-energy.OUTCAR").read_bytes() + partial_line)

    scan = scan_outcar(path, HOME_BARRIER)

    assert scan.warnings[-1].category == "IncompleteTail"
    assert getattr(scan.steps[-1], field) is None


def test_physically_truncated_stress_row_emits_one_warning(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        + b" in kB 1 2"
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert [warning.category for warning in scan.warnings] == ["IncompleteTail"]
    assert scan.steps[-1].stress_tensor_kb is None


@pytest.mark.parametrize("assignment", [b" home correction =\n", b" free energy TOTEN =\n"])
def test_complete_empty_energy_assignment_fails_closed(tmp_path: Path, assignment: bytes) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FREE ENERGIE OF THE ION-ELECTRON SYSTEM (eV)\n"
        + b" harmless diagnostic prose\n"
        + assignment
        + b" General timing and accounting informations for this job:\n"
    )

    with pytest.raises(OutcarFormatError, match="energy"):
        scan_outcar(path, HOME_BARRIER)


def test_non_assignment_equals_separator_is_ignored_in_energy_section(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FREE ENERGIE OF THE ION-ELECTRON SYSTEM (eV)\n"
        + b" ================================================\n"
        + b" General timing and accounting informations for this job:\n"
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert scan.steps[0].energy_terms == ()


def test_unknown_punctuated_energy_label_is_preserved(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FREE ENERGIE OF THE ION-ELECTRON SYSTEM (eV)\n"
        + b" home correction* = 2.5 eV\n"
        + b" General timing and accounting informations for this job:\n"
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert [(term.key, term.value) for term in scan.steps[0].energy_terms] == [
        ("home_correction", 2.5)
    ]


def test_truncated_energy_assignment_warns_then_replays(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    prefix = (
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FREE ENERGIE OF THE ION-ELECTRON SYSTEM (eV)\n"
        + b" home correction ="
    )
    path.write_bytes(prefix)

    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(
        prefix + b" 1.5 eV\n General timing and accounting informations for this job:\n"
    )
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [warning.category for warning in first.warnings] == ["IncompleteTail"]
    assert first.steps[0].energy_terms == ()
    assert [term.key for term in second.steps[0].energy_terms] == ["home_correction"]
    assert second.steps[0].energy_terms[0].value == pytest.approx(1.5)


def test_exact_three_by_three_kb_stress_attaches_to_step(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        + b" in kB\n1 2 3\n4 5 6\n7 8 9\n"
        + b" General timing and accounting informations for this job:\n"
    )

    scan = scan_outcar(path, HOME_BARRIER)

    assert scan.steps[0].stress_tensor_kb == (
        (1.0, 2.0, 3.0),
        (4.0, 5.0, 6.0),
        (7.0, 8.0, 9.0),
    )


def test_complete_malformed_three_by_three_stress_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        + b" in kB\n1 2 3\n4 nope 6\n7 8 9\n"
    )

    with pytest.raises(OutcarFormatError, match="stress"):
        scan_outcar(path, HOME_BARRIER)


def test_fourth_three_by_three_stress_row_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        + b" in kB\n1 2 3\n4 5 6\n7 8 9\n10 11 12\n"
    )

    with pytest.raises(OutcarFormatError, match="stress"):
        scan_outcar(path, HOME_BARRIER)


def test_truncated_three_by_three_stress_warns_then_replays(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    prefix = (
        (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
        + b" FORCE on cell =-STRESS in cart. coord. units (eV):\n"
        + b" in kB\n1 2 3\n4 5 6\n"
    )
    path.write_bytes(prefix)

    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(prefix + b"7 8 9\n General timing and accounting informations for this job:\n")
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [warning.category for warning in first.warnings] == ["IncompleteTail"]
    assert first.steps[0].stress_tensor_kb is None
    assert second.steps[0].stress_tensor_kb == (
        (1.0, 2.0, 3.0),
        (4.0, 5.0, 6.0),
        (7.0, 8.0, 9.0),
    )


def test_home_dialect_accepts_element_and_index_prefixed_force_rows(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_text(
        "vasp.5.4.1-barrier\n"
        "VRHFIN =Y: s2p6d1\nions per type = 1\nNIONS = 1 ions\n"
        "direct lattice vectors reciprocal lattice vectors\n"
        "1 0 0 1 0 0\n0 1 0 0 1 0\n0 0 1 0 0 1\n"
        "POSITION TOTAL-FORCE\n--------------------\n"
        "Y_ 1 0.25 0.50 0.75 -0.10 0.20 -0.30\n",
        encoding="ascii",
    )

    result = scan_outcar(path, HOME_BARRIER)

    assert result.steps[0].cartesian_positions == ((0.25, 0.5, 0.75),)
    assert result.steps[0].raw_forces == ((-0.1, 0.2, -0.3),)


def test_standard_vrhfin_species_expand_by_ions_per_type(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    fixture = (FIXTURES / "complete-two-step.OUTCAR").read_bytes()
    body = b" NIONS" + fixture.split(b" NIONS", maxsplit=1)[1]
    path.write_bytes(b" VRHFIN =H: s1\n VRHFIN =O: s2p4\n ions per type = 1 1\n" + body)

    result = scan_outcar(path, HOME_BARRIER)

    assert result.species == ("H", "O")
    assert result.checkpoint.species == ("H", "O")


def test_repeated_outcar_headers_do_not_duplicate_species(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    fixture = (FIXTURES / "complete-two-step.OUTCAR").read_bytes()
    body = b" NIONS" + fixture.split(b" NIONS", maxsplit=1)[1]
    header = b" VRHFIN =H: s1\n VRHFIN =O: s2p4\n ions per type = 1 1\n"
    path.write_bytes(header + body + header)

    result = scan_outcar(path, HOME_BARRIER)

    assert result.species == ("H", "O")


def test_repeated_vrhfin_cycles_before_counts_are_collapsed(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    fixture = (FIXTURES / "complete-two-step.OUTCAR").read_bytes()
    body = b" NIONS" + fixture.split(b" NIONS", maxsplit=1)[1]
    names = b" VRHFIN =H: s1\n VRHFIN =O: s2p4\n"
    path.write_bytes(names + names + b" ions per type = 1 1\n" + body)

    result = scan_outcar(path, HOME_BARRIER)

    assert result.species == ("H", "O")


def test_species_survive_positive_offset_resume(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    initial = PREFIX + b" General timing and accounting informations for this job:\n"
    path.write_bytes(initial)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(initial + SUFFIX)

    resumed = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert resumed.resumed_from > 0
    assert resumed.species == resumed.checkpoint.species == ("H", "H")


def test_ions_per_type_must_match_nions(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    fixture = (FIXTURES / "complete-two-step.OUTCAR").read_bytes()
    body = b" NIONS" + fixture.split(b" NIONS", maxsplit=1)[1]
    path.write_bytes(b" VRHFIN =H: s1\n ions per type = 1\n" + body)

    with pytest.raises(OutcarFormatError, match="ions per type.*NIONS"):
        scan_outcar(path, HOME_BARRIER)


def test_partial_force_block_is_discarded_without_losing_earlier_steps() -> None:
    result = scan_outcar(FIXTURES / "truncated-force.OUTCAR", HOME_BARRIER)

    assert len(result.steps) == 1
    assert result.warnings[0].category == "IncompleteTail"
    assert result.checkpoint.next_step_id == 1
    assert result.checkpoint.last_verified_offset == result.steps[0].block_end


def test_profile_can_reject_an_incomplete_force_tail() -> None:
    with pytest.raises(OutcarFormatError):
        scan_outcar(FIXTURES / "truncated-force.OUTCAR", strict_tail_dialect())


def test_completed_structure_without_energy_is_retained() -> None:
    result = scan_outcar(FIXTURES / "trailing-no-energy.OUTCAR", HOME_BARRIER)

    assert len(result.steps) == 1
    assert result.steps[-1].energy is None
    assert result.warnings == ()


def test_provisional_step_replays_same_id_when_energy_and_convergence_arrive(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    initial = (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
    path.write_bytes(initial)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(
        initial
        + b" free energy    TOTEN  =       -10.250000 eV\n"
        + b" reached required accuracy - stopping structural energy minimisation\n"
    )

    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert first.steps[0].step_id == second.steps[0].step_id == 0
    assert first.steps[0].energy is None
    assert second.steps[0].energy == -10.25
    assert second.steps[0].ionic_converged is True
    assert second.resumed_from == first.steps[0].block_start


@pytest.mark.parametrize(
    ("partial_energy", "completion", "expected_energy"),
    [
        (b" free energy    TOTEN  =", b"       -10.500000 eV\n", -10.5),
        (b" free energy    TOTEN  =       -10.2E", b"+00 eV\n", -10.2),
    ],
)
def test_truncated_energy_tail_replays_after_completion(
    tmp_path: Path,
    partial_energy: bytes,
    completion: bytes,
    expected_energy: float,
) -> None:
    path = tmp_path / "OUTCAR"
    structure = (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
    path.write_bytes(structure + partial_energy)

    first = scan_outcar(path, HOME_BARRIER)

    assert first.steps[0].energy is None
    assert first.warnings[-1].category == "IncompleteTail"
    assert first.checkpoint.replay_provisional is True

    path.write_bytes(structure + partial_energy + completion)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert second.steps[0].step_id == first.steps[0].step_id == 0
    assert second.steps[0].energy == expected_energy


@pytest.mark.parametrize(
    "partial_energy",
    [
        b" free energy    TOTEN  =",
        b" free energy    TOTEN  =       -10.2E",
    ],
)
def test_strict_profile_rejects_truncated_energy_tail(
    tmp_path: Path, partial_energy: bytes
) -> None:
    path = tmp_path / "OUTCAR"
    structure = (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
    path.write_bytes(structure + partial_energy)

    with pytest.raises(OutcarFormatError):
        scan_outcar(path, strict_tail_dialect())


def test_newline_terminated_malformed_energy_is_fatal(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    structure = (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
    path.write_bytes(structure + b" free energy    TOTEN  = nonsense\n")

    with pytest.raises(OutcarFormatError):
        scan_outcar(path, HOME_BARRIER)


def test_appended_file_resumes_without_repeated_nions(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(PREFIX + SUFFIX)

    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [0, 1]
    assert second.steps[1].atom_count == first.checkpoint.expected_atom_count == 2
    assert second.steps[1].energy == -10.1


def test_mid_atom_line_is_an_incomplete_tail_preserving_prior_step(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    complete_then_partial = (FIXTURES / "truncated-force.OUTCAR").read_bytes()
    path.write_bytes(complete_then_partial[:-18])

    result = scan_outcar(path, HOME_BARRIER)

    assert [step.step_id for step in result.steps] == [0]
    assert result.warnings[-1].category == "IncompleteTail"


def test_incomplete_lattice_tail_preserves_prior_step(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    incomplete_lattice = PREFIX + (
        b" direct lattice vectors reciprocal lattice vectors\n"
        b"3.01 0 0 0.332 0 0\n"
        b"0 3.01 0 0 0.332 0\n"
        b"0 0."
    )
    path.write_bytes(incomplete_lattice)

    result = scan_outcar(path, HOME_BARRIER)

    assert [step.step_id for step in result.steps] == [0]
    assert result.warnings[-1].category == "IncompleteTail"

    with pytest.raises(OutcarFormatError):
        scan_outcar(path, strict_tail_dialect())


def test_inconsistent_checkpoint_state_forces_clean_reparse(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    checkpoint = scan_outcar(path, HOME_BARRIER).checkpoint.model_copy(
        update={"last_lattice": None}
    )
    path.write_bytes(PREFIX + SUFFIX)

    result = scan_outcar(path, HOME_BARRIER, checkpoint)

    assert result.resumed_from == 0
    assert [step.step_id for step in result.steps] == [0, 1]


@pytest.mark.parametrize(
    "update",
    [
        {"next_step_id": -1},
        {"last_lattice": ((float("nan"), 0.0, 0.0), (0.0, 3.0, 0.0), (0.0, 0.0, 3.0))},
        {"last_lattice": ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))},
        {"last_verified_offset": 302},
        {"last_verified_offset": len(PREFIX), "replay_provisional": True},
    ],
)
def test_invalid_checkpoint_values_force_clean_reparse(
    tmp_path: Path, update: dict[str, object]
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    checkpoint = scan_outcar(path, HOME_BARRIER).checkpoint.model_copy(update=update)
    path.write_bytes(PREFIX + SUFFIX)

    result = scan_outcar(path, HOME_BARRIER, checkpoint)

    assert result.resumed_from == 0
    assert [step.step_id for step in result.steps] == [0, 1]


def test_zero_offset_checkpoint_never_restores_cached_parser_state(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    corrupt = scan_outcar(path, HOME_BARRIER).checkpoint.model_copy(
        update={
            "last_verified_offset": 0,
            "next_step_id": 99,
            "expected_atom_count": 999,
            "last_lattice": ((9.0, 0.0, 0.0), (0.0, 9.0, 0.0), (0.0, 0.0, 9.0)),
            "replay_provisional": False,
            "normally_finished": True,
        }
    )

    result = scan_outcar(path, HOME_BARRIER, corrupt)

    assert result.resumed_from == 0
    assert [step.step_id for step in result.steps] == [0]
    assert result.steps[0].atom_count == 2
    assert result.steps[0].lattice[0] == (3.0, 0.0, 0.0)
    assert result.normally_finished is False


def test_replacement_restarts_from_zero(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    checkpoint = scan_outcar(path, HOME_BARRIER).checkpoint
    path.write_bytes((FIXTURES / "trailing-no-energy.OUTCAR").read_bytes())

    result = scan_outcar(path, HOME_BARRIER, checkpoint)

    assert result.resumed_from == 0
    assert [step.step_id for step in result.steps] == [0]
    assert result.steps[0].energy is None


def test_truncation_restarts_from_zero(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    checkpoint = scan_outcar(path, HOME_BARRIER).checkpoint
    path.write_bytes(PREFIX[:59])

    result = scan_outcar(path, HOME_BARRIER, checkpoint)

    assert result.resumed_from == 0
    assert result.steps == ()


def test_normally_finished_survives_unchanged_resume() -> None:
    path = FIXTURES / "complete-two-step.OUTCAR"
    first = scan_outcar(path, HOME_BARRIER)

    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert first.normally_finished is True
    assert first.checkpoint.normally_finished is True
    assert second.resumed_from == path.stat().st_size
    assert second.steps == ()
    assert second.normally_finished is True


@pytest.mark.parametrize(
    "atom_row",
    [
        "0.0 0.0 0.0 NaN 0.0 0.0",
        "0.0 0.0 0.0 0.1 0.0",
        "0.0 0.0 0.0 0.1 0.0 0.0 7.0",
    ],
)
def test_nonfinite_or_inconsistent_atom_rows_are_rejected(tmp_path: Path, atom_row: str) -> None:
    path = tmp_path / "OUTCAR"
    path.write_text(
        "NIONS = 1 ions\n"
        "direct lattice vectors reciprocal lattice vectors\n"
        "1 0 0 1 0 0\n0 1 0 0 1 0\n0 0 1 0 0 1\n"
        "POSITION TOTAL-FORCE\n"
        "--------------------\n"
        f"{atom_row}\n",
        encoding="ascii",
    )

    with pytest.raises(OutcarFormatError):
        scan_outcar(path, HOME_BARRIER)


def test_nonfinite_lattice_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_text(
        "NIONS = 1 ions\n"
        "direct lattice vectors reciprocal lattice vectors\n"
        "NaN 0 0 1 0 0\n0 1 0 0 1 0\n0 0 1 0 0 1\n"
        "POSITION TOTAL-FORCE\n--------------------\n"
        "0 0 0 0 0 0\n",
        encoding="ascii",
    )

    with pytest.raises(OutcarFormatError):
        scan_outcar(path, HOME_BARRIER)


def test_more_atom_rows_than_nions_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_text(
        "NIONS = 1 ions\n"
        "direct lattice vectors reciprocal lattice vectors\n"
        "1 0 0 1 0 0\n0 1 0 0 1 0\n0 0 1 0 0 1\n"
        "POSITION TOTAL-FORCE\n--------------------\n"
        "0 0 0 0 0 0\n"
        "1 1 1 0 0 0\n",
        encoding="ascii",
    )

    with pytest.raises(OutcarFormatError):
        scan_outcar(path, HOME_BARRIER)
