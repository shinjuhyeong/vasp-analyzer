import os
import shutil
from pathlib import Path

import pytest

from vasp_analyzer.cli.corpus import validate_corpus
from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.session import CalculationSession


FIXTURES = Path(__file__).parents[1] / "fixtures" / "outcar"


def corpus_root_or_skip() -> Path:
    configured = os.environ.get("VASP_ANALYZER_CORPUS_DIR")
    if configured is None:
        pytest.skip("VASP_ANALYZER_CORPUS_DIR is not set")
    return Path(configured)


@pytest.mark.corpus
def test_actual_home_barrier_corpus() -> None:
    report = validate_corpus(corpus_root_or_skip())

    assert report.files == 52
    assert report.bytes_total == 2_288_020_784
    assert report.bytes_total / (1024**3) == pytest.approx(2.131, rel=0.01)
    assert report.home_barrier == 52
    assert report.with_force_blocks == 50
    assert report.force_blocks == 12_909
    assert report.complete == 38
    assert report.incomplete == 14
    assert report.max_steps == 3_000
    assert report.peak_rss_bytes < report.bytes_total


@pytest.mark.corpus
def test_largest_file_cache_reuse_and_bounded_append_resume(tmp_path: Path) -> None:
    outcars = tuple(corpus_root_or_skip().rglob("OUTCAR"))
    largest = max(outcars, key=lambda path: path.stat().st_size)
    cache = CacheStore(tmp_path / "largest-cache")

    first_session = CalculationSession(largest, cache=cache)
    first_dataset = first_session.load()
    assert first_session.last_evidence.cache_reused is False

    cached_session = CalculationSession(largest, cache=cache)
    cached_dataset = cached_session.load()
    assert cached_session.last_evidence.cache_reused is True
    assert cached_dataset.source_files == first_dataset.source_files
    assert len(cached_dataset.ionic_steps) == len(first_dataset.ionic_steps)

    append_root = tmp_path / "bounded-append"
    append_root.mkdir()
    append_outcar = append_root / "OUTCAR"
    shutil.copyfile(FIXTURES / "trailing-no-energy.OUTCAR", append_outcar)
    append_session = CalculationSession(
        append_root, cache=CacheStore(tmp_path / "append-cache")
    )
    append_session.load()
    with append_outcar.open("ab") as stream:
        stream.write(b" free energy    TOTEN  =       -10.250000 eV\n")

    refreshed = append_session.refresh_if_changed()

    evidence = append_session.last_evidence
    assert evidence.resumed_from == evidence.previous_verified_offset
    assert evidence.resumed_from is not None
    assert evidence.resumed_from > 0
    assert refreshed.ionic_steps[-1].total_energy == -10.25
