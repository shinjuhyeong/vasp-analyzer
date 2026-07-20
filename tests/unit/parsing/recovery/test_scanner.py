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
    strict_validation = HOME_BARRIER.profile.validation.model_copy(
        update={"allow_incomplete_tail": False}
    )
    strict_profile = HOME_BARRIER.profile.model_copy(
        update={"validation": strict_validation}
    )
    strict_dialect = replace(HOME_BARRIER, profile=strict_profile)

    with pytest.raises(OutcarFormatError):
        scan_outcar(FIXTURES / "truncated-force.OUTCAR", strict_dialect)


def test_completed_structure_without_energy_is_retained() -> None:
    result = scan_outcar(FIXTURES / "trailing-no-energy.OUTCAR", HOME_BARRIER)

    assert len(result.steps) == 1
    assert result.steps[-1].energy is None
    assert result.warnings == ()


def test_appended_file_resumes_without_repeated_nions(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(PREFIX + SUFFIX)

    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [1]
    assert second.steps[0].atom_count == first.checkpoint.expected_atom_count == 2
    assert second.steps[0].energy == -10.1


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
