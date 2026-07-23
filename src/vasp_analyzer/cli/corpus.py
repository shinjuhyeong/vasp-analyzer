"""Opt-in validation of a local OUTCAR compatibility corpus."""

from __future__ import annotations

import math
import os
import sys
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from time import perf_counter

import numpy as np
from pydantic import Field

from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import (
    AnalyzerError,
    CalculationDataset,
    DatasetConsistencyError,
    FrozenModel,
)
from vasp_analyzer.parsing.adapters.outcar_ase import iter_outcar_steps
from vasp_analyzer.parsing.dialects import detect_dialect
from vasp_analyzer.parsing.recovery import ScanResult, scan_outcar

_HEAD_BYTES = 65_536
_EXPECTED_FILES = 52


class CorpusReport(FrozenModel):
    """Path-free aggregate results from a configured local corpus."""

    files: int = Field(ge=0)
    bytes_total: int = Field(ge=0)
    home_barrier: int = Field(ge=0)
    with_force_blocks: int = Field(ge=0)
    force_blocks: int = Field(ge=0)
    complete: int = Field(ge=0)
    incomplete: int = Field(ge=0)
    max_steps: int = Field(ge=0)
    elapsed_seconds: float = Field(ge=0.0)
    peak_rss_bytes: int = Field(ge=0)
    warnings: tuple[str, ...]
    fingerprints: tuple[str, ...]


class CorpusDetailReport(FrozenModel):
    """Path-free detailed-metadata counters from analyzed datasets."""

    files_seen: int = Field(ge=0)
    files_with_energy_terms: int = Field(ge=0)
    files_with_stress: int = Field(ge=0)
    files_with_parameters: int = Field(ge=0)
    energy_terms: int = Field(ge=0)
    parameter_occurrences: int = Field(ge=0)
    non_finite_energy_terms: int = Field(ge=0)
    invalid_stress_shapes: int = Field(ge=0)


class CorpusDetailMinimums(FrozenModel):
    """Privacy-safe lower bounds stored separately from private calculations."""

    files_with_energy_terms: int = Field(gt=0)
    files_with_stress: int = Field(gt=0)
    files_with_parameters: int = Field(gt=0)
    energy_terms: int = Field(gt=0)
    parameter_occurrences: int = Field(gt=0)


def require_detail_minimums(
    report: CorpusDetailReport, minimums: CorpusDetailMinimums
) -> None:
    """Fail when any detailed-metadata aggregate drops below its declared floor."""

    regressions = [
        f"{field}={getattr(report, field)} < {minimum}"
        for field, minimum in minimums.model_dump(by_alias=False).items()
        if getattr(report, field) < minimum
    ]
    if regressions:
        raise AnalyzerError("detailed corpus baseline regression: " + ", ".join(regressions))


def summarize_detail_datasets(
    datasets: Iterable[CalculationDataset],
) -> CorpusDetailReport:
    """Consume datasets once while retaining only bounded integer counters."""

    files_seen = files_with_energy_terms = files_with_stress = 0
    files_with_parameters = energy_terms = parameter_occurrences = 0
    non_finite_energy_terms = invalid_stress_shapes = 0
    for dataset in datasets:
        files_seen += 1
        has_energy_terms = False
        has_stress = False
        for step in dataset.ionic_steps:
            for term in step.energy_terms:
                has_energy_terms = True
                energy_terms += 1
                non_finite_energy_terms += not math.isfinite(term.value)
            tensor = step.stress_tensor_kb
            if tensor is not None:
                has_stress = True
                invalid_stress_shapes += len(tensor) != 3 or any(
                    len(row) != 3 for row in tensor
                )
        files_with_energy_terms += has_energy_terms
        files_with_stress += has_stress
        files_with_parameters += bool(dataset.parameters)
        parameter_occurrences += len(dataset.parameters)
    return CorpusDetailReport(
        files_seen=files_seen,
        files_with_energy_terms=files_with_energy_terms,
        files_with_stress=files_with_stress,
        files_with_parameters=files_with_parameters,
        energy_terms=energy_terms,
        parameter_occurrences=parameter_occurrences,
        non_finite_energy_terms=non_finite_energy_terms,
        invalid_stress_shapes=invalid_stress_shapes,
    )


def validate_corpus_details(root: Path) -> CorpusDetailReport:
    """Analyze case-insensitive OUTCAR names and return path-free detail counts."""

    outcars = sorted(
        path
        for path in Path(root).rglob("*")
        if path.is_file() and path.name.casefold() == "outcar"
    )
    datasets = (CalculationSession(path).load() for path in outcars)
    return summarize_detail_datasets(datasets)


def _peak_rss_bytes() -> int:
    """Return process peak resident memory using only platform APIs."""

    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        process = ctypes.windll.kernel32.GetCurrentProcess()
        if ctypes.windll.psapi.GetProcessMemoryInfo(
            process, ctypes.byref(counters), counters.cb
        ):
            return int(counters.PeakWorkingSetSize)
        return 0

    import resource

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak if sys.platform == "darwin" else peak * 1024)


def _read_head(path: Path) -> str:
    with path.open("rb") as stream:
        return stream.read(_HEAD_BYTES).decode("utf-8", errors="replace")


def _validate_scan(scan: ScanResult) -> None:
    for record in scan.steps:
        counts = {len(record.cartesian_positions), len(record.raw_forces)}
        if counts != {record.atom_count}:
            raise DatasetConsistencyError(
                f"step {record.step_id}: scanner dimensions do not match NIONS"
            )
        values = (
            value
            for rows in (record.lattice, record.cartesian_positions, record.raw_forces)
            for row in rows
            for value in row
        )
        if not all(math.isfinite(value) for value in values):
            raise DatasetConsistencyError(
                f"step {record.step_id}: scanner emitted non-finite values"
            )


def _validate_selected_ase_frame(path: Path, scan: ScanResult) -> None:
    if not scan.steps:
        return
    frames = iter_outcar_steps(path, scan)
    try:
        frame = next(frames)
    finally:
        frames.close()
    record = scan.steps[0]
    comparisons = (
        ("lattice", frame.lattice, record.lattice),
        ("positions", frame.cartesian_positions, record.cartesian_positions),
        ("forces", frame.raw_forces, record.raw_forces),
    )
    for label, ase_values, scanner_values in comparisons:
        if not np.allclose(ase_values, scanner_values, rtol=1e-7, atol=1e-7):
            raise DatasetConsistencyError(
                f"step {record.step_id}: ASE/scanner {label} values disagree"
            )
    if (
        frame.total_energy is not None
        and record.energy is not None
        and not math.isclose(frame.total_energy, record.energy, rel_tol=1e-7, abs_tol=1e-7)
    ):
        raise DatasetConsistencyError(
            f"step {record.step_id}: ASE/scanner total energy values disagree"
        )


def validate_corpus(root: Path) -> CorpusReport:
    """Stream and aggregate the configured corpus without retaining source content."""

    started = perf_counter()
    root = Path(root)
    outcars = tuple(sorted(root.rglob("OUTCAR")))
    if len(outcars) != _EXPECTED_FILES:
        raise AnalyzerError(
            f"expected {_EXPECTED_FILES} OUTCAR files under corpus root, found {len(outcars)}"
        )

    bytes_total = 0
    home_barrier = 0
    with_force_blocks = 0
    force_blocks = 0
    complete = 0
    max_steps = 0
    warning_counts: Counter[str] = Counter()
    fingerprints: list[str] = []
    ase_candidate: tuple[Path, ScanResult] | None = None

    for path in outcars:
        bytes_total += path.stat().st_size
        dialect = detect_dialect(_read_head(path)).dialect
        home_barrier += dialect.id == "home_barrier"
        scan = scan_outcar(path, dialect)
        _validate_scan(scan)
        step_count = len(scan.steps)
        if step_count and (
            ase_candidate is None or path.stat().st_size < ase_candidate[0].stat().st_size
        ):
            ase_candidate = path, scan
        with_force_blocks += step_count > 0
        force_blocks += step_count
        complete += scan.normally_finished
        max_steps = max(max_steps, step_count)
        warning_counts.update(warning.category for warning in scan.warnings)
        fingerprints.append(scan.checkpoint.prefix_fingerprint)

    if ase_candidate is not None:
        _validate_selected_ase_frame(*ase_candidate)

    warnings = tuple(
        f"{category}: {count}" for category, count in sorted(warning_counts.items())
    )
    return CorpusReport(
        files=len(outcars),
        bytes_total=bytes_total,
        home_barrier=home_barrier,
        with_force_blocks=with_force_blocks,
        force_blocks=force_blocks,
        complete=complete,
        incomplete=len(outcars) - complete,
        max_steps=max_steps,
        elapsed_seconds=perf_counter() - started,
        peak_rss_bytes=_peak_rss_bytes(),
        warnings=warnings,
        fingerprints=tuple(fingerprints),
    )


__all__ = [
    "CorpusDetailMinimums",
    "CorpusDetailReport",
    "CorpusReport",
    "require_detail_minimums",
    "summarize_detail_datasets",
    "validate_corpus",
    "validate_corpus_details",
]
