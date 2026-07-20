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
    strict_profile = HOME_BARRIER.profile.model_copy(
        update={"validation": strict_validation}
    )
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
def test_nonfinite_or_inconsistent_atom_rows_are_rejected(
    tmp_path: Path, atom_row: str
) -> None:
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
