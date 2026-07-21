import os
import shutil
from pathlib import Path

import pytest

from vasp_analyzer.cli.corpus import (
    summarize_detail_datasets,
    validate_corpus,
    validate_corpus_details,
)
from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import CalculationDataset, EnergyTerm, IonicStep, ParameterOccurrence


FIXTURES = Path(__file__).parents[1] / "fixtures" / "outcar"
IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _step(
    *,
    energy_terms: tuple[EnergyTerm, ...] = (),
    stress_tensor_kb=None,
) -> IonicStep:
    return IonicStep(
        index=0,
        lattice=IDENTITY,
        fractional_positions=(),
        cartesian_positions=(),
        raw_forces=(),
        free_forces=(),
        free_force_norms=(),
        total_energy=None,
        energy_terms=energy_terms,
        stress_tensor_kb=stress_tensor_kb,
        delta_energy=None,
        scf_iterations=None,
        electronic_converged=None,
        ionic_converged=None,
        strongest_free_component=None,
        rms_free_force=None,
    )


def test_detail_summary_accumulates_exact_path_free_counters_once() -> None:
    datasets = (
        CalculationDataset(
            root="/calculation/first",
            source_files=(),
            sites=(),
            ionic_steps=(
                _step(
                    energy_terms=(
                        EnergyTerm(
                            key="ewald",
                            raw_label="Ewald energy",
                            value=-12.5,
                            kind="contribution",
                        ),
                        EnergyTerm(
                            key="toten",
                            raw_label="free energy TOTEN",
                            value=-10.0,
                            kind="aggregate",
                        ),
                    ),
                    stress_tensor_kb=IDENTITY,
                ),
            ),
            parameters=(
                ParameterOccurrence(
                    key="encut",
                    raw_key="ENCUT",
                    raw_value="520",
                    value=520,
                    ordinal=0,
                ),
                ParameterOccurrence(
                    key="home_tag",
                    raw_key="HOME_TAG",
                    raw_value="alpha",
                    value="alpha",
                    ordinal=1,
                ),
            ),
            capabilities=(),
        ),
        CalculationDataset(
            root="/calculation/second",
            source_files=(),
            sites=(),
            ionic_steps=(_step(),),
            capabilities=(),
        ),
    )

    report = summarize_detail_datasets(iter(datasets))

    assert report.model_dump(by_alias=False) == {
        "files_seen": 2,
        "files_with_energy_terms": 1,
        "files_with_stress": 1,
        "files_with_parameters": 1,
        "energy_terms": 2,
        "parameter_occurrences": 2,
        "non_finite_energy_terms": 0,
        "invalid_stress_shapes": 0,
    }


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
def test_configured_corpus_detailed_metadata_is_finite_and_bounded() -> None:
    report = validate_corpus_details(corpus_root_or_skip())

    assert report.files_seen > 0
    assert report.non_finite_energy_terms == 0
    assert report.invalid_stress_shapes == 0
    assert report.parameter_occurrences >= report.files_with_parameters


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
