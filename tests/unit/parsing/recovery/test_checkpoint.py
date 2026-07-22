from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.parsing.dialects import HOME_BARRIER
from vasp_analyzer.parsing.recovery import checkpoint_is_append_only, scan_outcar


FIXTURES = Path(__file__).parents[3] / "fixtures" / "outcar"


def test_truncated_detail_checkpoint_replays_from_pending_record(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    truncated = (FIXTURES / "detail-truncated-tail.OUTCAR").read_bytes()
    complete = (FIXTURES / "detail-complete-two-step.OUTCAR").read_bytes()
    path.write_bytes(truncated)

    scan = scan_outcar(path, HOME_BARRIER)

    assert scan.checkpoint.replay_provisional is True
    assert scan.checkpoint.last_verified_offset == scan.steps[-1].block_start
    path.write_bytes(complete)
    assert checkpoint_is_append_only(path, scan.checkpoint) is True


def test_append_resume_restores_active_iteration_state(tmp_path: Path) -> None:
    complete = (FIXTURES / "iteration-volume-basis-two-step.OUTCAR").read_bytes()
    cut = complete.index(b"VOLUME and BASIS-vectors are now") + len(
        b"VOLUME and BASIS-vectors are now\n"
    )
    path = tmp_path / "OUTCAR"
    path.write_bytes(complete[:cut])
    first = scan_outcar(path, HOME_BARRIER)
    assert first.checkpoint.current_ionic_iteration == 1
    assert first.checkpoint.max_electronic_iteration == 17
    assert first.checkpoint.geometry_section_open is True

    path.write_bytes(complete)
    resumed = scan_outcar(path, HOME_BARRIER, first.checkpoint)
    assert [(step.index, step.scf_iterations) for step in resumed.steps] == [(0, 17), (1, 9)]


def test_checkpoint_payload_without_iteration_ownership_state_is_rejected() -> None:
    from vasp_analyzer.parsing.recovery import ParserCheckpoint

    checkpoint = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER).checkpoint
    old_payload = checkpoint.model_dump()
    for field in (
        "currentIonicIteration",
        "maxElectronicIteration",
        "geometrySectionOpen",
        "headerVolume",
        "geometryVolumeConsumed",
        "geometryLatticeConsumed",
    ):
        old_payload.pop(field, None)

    with pytest.raises(ValidationError):
        ParserCheckpoint.model_validate(old_payload)


@pytest.mark.parametrize("needle", [b"in kB", b"volume of cell : 351.73", b"7.1 0 0"])
def test_resume_replays_partial_first_iteration_from_matching_state(
    tmp_path: Path, needle: bytes
) -> None:
    complete = (FIXTURES / "iteration-volume-basis-two-step.OUTCAR").read_bytes()
    cut = complete.index(b"\n", complete.index(needle)) + 1
    path = tmp_path / "OUTCAR"
    path.write_bytes(complete[:cut])
    first = scan_outcar(path, HOME_BARRIER)

    path.write_bytes(complete)
    resumed = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [(step.index, step.scf_iterations, step.cell_volume) for step in resumed.steps] == [
        (0, 17, 351.73),
        (1, 9, 352.11),
    ]


@pytest.mark.parametrize("needle", [b"in kB 4", b"volume of cell : 352.11", b"7.2 0 0"])
def test_resume_replays_partial_iteration_after_completed_step(
    tmp_path: Path, needle: bytes
) -> None:
    complete = (FIXTURES / "iteration-volume-basis-two-step.OUTCAR").read_bytes()
    cut = complete.index(b"\n", complete.index(needle)) + 1
    path = tmp_path / "OUTCAR"
    path.write_bytes(complete[:cut])
    first = scan_outcar(path, HOME_BARRIER)
    assert [(step.index, step.scf_iterations) for step in first.steps] == [(0, 17)]

    path.write_bytes(complete)
    resumed = scan_outcar(path, HOME_BARRIER, first.checkpoint)

    assert [(step.index, step.scf_iterations, step.cell_volume) for step in resumed.steps] == [
        (1, 9, 352.11)
    ]
