"""Whole-fingerprint refresh sessions for immutable calculation snapshots."""

from pathlib import Path

from vasp_analyzer.core import (
    AnalyzerError,
    CalculationDataset,
    DatasetConsistencyError,
    FrozenModel,
    ParserWarning,
    SourceFile,
)
from vasp_analyzer.normalizers import OutcarNormalizationError
from vasp_analyzer.parsing.profiles import CompatibilityProfile

from .cache import CacheStore, CachedCalculation, cache_key
from .dataset import (
    _assemble,
    _select_outcar_normalizer,
    detect_path_dialect,
    inspect_calculation,
)
from .discovery import discover_calculation


class SessionLoadEvidence(FrozenModel):
    cache_reused: bool
    resumed_from: int | None = None
    previous_verified_offset: int | None = None


class CalculationSession:
    def __init__(
        self,
        path: Path,
        profile: CompatibilityProfile | None = None,
        cache: CacheStore | None = None,
    ) -> None:
        self.path = Path(path)
        self.profile = profile
        self.cache = cache or CacheStore.default()
        self._source: SourceFile | None = None
        self._dataset: CalculationDataset | None = None
        self._failed_source: SourceFile | None = None
        self._retained_after_failure: CalculationDataset | None = None
        self._last_evidence: SessionLoadEvidence | None = None

    @property
    def last_evidence(self) -> SessionLoadEvidence:
        if self._last_evidence is None:
            raise RuntimeError("session has not loaded a calculation")
        return self._last_evidence

    def _identity(self):
        discovered = discover_calculation(self.path)
        source = inspect_calculation(discovered)
        dialect = detect_path_dialect(discovered, self.profile)
        match = _select_outcar_normalizer(discovered.outcar)
        key = cache_key(source, dialect.id, dialect.profile, match.definition_hash)
        return source, key

    def _stable_snapshot(self) -> tuple[CalculationDataset, SourceFile, bool]:
        for _attempt in range(2):
            source, key = self._identity()
            cached = self.cache.get(key)
            if cached is not None:
                verified_source, verified_key = self._identity()
                if (verified_source, verified_key) == (source, key):
                    return cached.dataset, source, True
                continue
            try:
                dataset, dialect, match, assembled_source = _assemble(
                    self.path, self.profile
                )
            except DatasetConsistencyError as error:
                if str(error) == "calculation changed during parsing":
                    continue
                raise
            assembled_key = cache_key(
                assembled_source,
                dialect.id,
                dialect.profile,
                match.definition_hash,
            )
            verified_source, verified_key = self._identity()
            if (verified_source, verified_key) != (assembled_source, assembled_key):
                continue
            self.cache.put(assembled_key, CachedCalculation(dataset=dataset))
            return dataset, assembled_source, False
        raise DatasetConsistencyError("calculation changed repeatedly during parsing")

    def load(self) -> CalculationDataset:
        dataset, source, cache_reused = self._stable_snapshot()
        self._dataset = dataset
        self._source = source
        self._failed_source = None
        self._retained_after_failure = None
        self._last_evidence = SessionLoadEvidence(cache_reused=cache_reused)
        return dataset

    def refresh_if_changed(self) -> CalculationDataset:
        source, _key = self._identity()
        if self._dataset is not None and source == self._source:
            self._last_evidence = SessionLoadEvidence(cache_reused=True)
            return self._dataset
        if self._failed_source == source and self._retained_after_failure is not None:
            self._last_evidence = SessionLoadEvidence(cache_reused=True)
            return self._retained_after_failure
        if self._dataset is None:
            return self.load()
        try:
            dataset, source, cache_reused = self._stable_snapshot()
        except (AnalyzerError, OutcarNormalizationError) as error:
            warning = ParserWarning(
                category="GrowingFileParseFailure",
                message=f"OUTCAR update is incomplete; showing last successful data: {error}",
            )
            retained = self._dataset.model_copy(
                update={"warnings": self._dataset.warnings + (warning,)}
            )
            self._failed_source = source
            self._retained_after_failure = retained
            self._last_evidence = SessionLoadEvidence(cache_reused=True)
            return retained
        self._dataset = dataset
        self._source = source
        self._failed_source = None
        self._retained_after_failure = None
        self._last_evidence = SessionLoadEvidence(cache_reused=cache_reused)
        return dataset


__all__ = ["CalculationSession", "SessionLoadEvidence"]
