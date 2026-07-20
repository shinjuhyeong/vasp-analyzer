from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.cli.corpus import CorpusReport, validate_corpus
from vasp_analyzer.core import AnalyzerError


def test_corpus_report_is_immutable_and_json_safe() -> None:
    report = CorpusReport(
        files=1,
        bytes_total=100,
        home_barrier=1,
        with_force_blocks=1,
        force_blocks=2,
        complete=1,
        incomplete=0,
        max_steps=2,
        elapsed_seconds=0.25,
        peak_rss_bytes=4096,
        warnings=("one warning",),
        fingerprints=("abc123",),
    )

    assert CorpusReport.model_validate_json(report.model_dump_json()) == report
    with pytest.raises(ValidationError):
        report.files = 2


def test_validate_corpus_rejects_wrong_outcar_count(tmp_path: Path) -> None:
    with pytest.raises(AnalyzerError, match=r"expected \d+ OUTCAR files.*found 0"):
        validate_corpus(tmp_path)
