from pathlib import Path

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
