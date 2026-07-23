"""Whole-fingerprint refresh sessions for immutable calculation snapshots."""

from pathlib import Path

from vasp_analyzer.core import (
    AnalyzerError,
    CalculationDataset,
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

    def load(self) -> CalculationDataset:
        source, key = self._identity()
        cached = self.cache.get(key)
        cache_reused = cached is not None
        if cached is None:
            dataset, _dialect, _match = _assemble(self.path, self.profile)
            cached = CachedCalculation(dataset=dataset)
            self.cache.put(key, cached)
        self._dataset = cached.dataset
        self._source = source
        self._failed_source = None
        self._retained_after_failure = None
        self._last_evidence = SessionLoadEvidence(cache_reused=cache_reused)
        return cached.dataset

    def refresh_if_changed(self) -> CalculationDataset:
        source, key = self._identity()
        if self._dataset is not None and source == self._source:
            self._last_evidence = SessionLoadEvidence(cache_reused=True)
            return self._dataset
        if self._failed_source == source and self._retained_after_failure is not None:
            self._last_evidence = SessionLoadEvidence(cache_reused=True)
            return self._retained_after_failure
        if self._dataset is None:
            return self.load()
        cached = self.cache.get(key)
        try:
            if cached is not None:
                dataset = cached.dataset
                cache_reused = True
            else:
                dataset, _dialect, _match = _assemble(self.path, self.profile)
                self.cache.put(key, CachedCalculation(dataset=dataset))
                cache_reused = False
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
