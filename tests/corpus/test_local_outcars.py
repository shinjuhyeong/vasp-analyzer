import os
from pathlib import Path

import pytest

from vasp_analyzer.cli.corpus import validate_corpus


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
