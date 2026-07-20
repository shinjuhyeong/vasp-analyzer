"""Incrementally refreshable calculation sessions."""

from pathlib import Path

from vasp_analyzer.core import CalculationDataset, FrozenModel, SourceFile
from vasp_analyzer.parsing.profiles import CompatibilityProfile
from vasp_analyzer.parsing.recovery import ParserCheckpoint, checkpoint_is_append_only

from .cache import CacheStore, CachedCalculation, cache_key
from .dataset import _assemble, detect_path_dialect, inspect_calculation
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
        self._checkpoint: ParserCheckpoint | None = None
        self._last_evidence: SessionLoadEvidence | None = None

    @property
    def last_evidence(self) -> SessionLoadEvidence:
        if self._last_evidence is None:
            raise RuntimeError("session has not loaded a calculation")
        return self._last_evidence

    def load(self) -> CalculationDataset:
        discovered = discover_calculation(self.path)
        source = inspect_calculation(discovered)
        dialect = detect_path_dialect(discovered, self.profile)
        key = cache_key(source, dialect.id, self.profile.id if self.profile else None)
        cached = self.cache.get(key)
        cache_reused = cached is not None
        if cached is None:
            dataset, checkpoint, _ = _assemble(self.path, self.profile)
            cached = CachedCalculation(dataset=dataset, checkpoint=checkpoint)
            self.cache.put(key, cached)
        self._dataset = cached.dataset
        self._checkpoint = cached.checkpoint
        self._source = source
        self._last_evidence = SessionLoadEvidence(cache_reused=cache_reused)
        return cached.dataset

    def refresh_if_changed(self) -> CalculationDataset:
        discovered = discover_calculation(self.path)
        source = inspect_calculation(discovered)
        if self._dataset is not None and source == self._source:
            self._last_evidence = SessionLoadEvidence(cache_reused=True)
            return self._dataset
        if self._dataset is None or self._checkpoint is None:
            return self.load()
        previous_verified_offset = self._checkpoint.last_verified_offset
        resumed_from = (
            previous_verified_offset
            if checkpoint_is_append_only(discovered.outcar, self._checkpoint)
            else 0
        )
        dataset, checkpoint, dialect = _assemble(
            self.path,
            self.profile,
            checkpoint=self._checkpoint,
            existing=self._dataset,
        )
        key = cache_key(source, dialect.id, self.profile.id if self.profile else None)
        self.cache.put(key, CachedCalculation(dataset=dataset, checkpoint=checkpoint))
        self._dataset = dataset
        self._checkpoint = checkpoint
        self._source = source
        self._last_evidence = SessionLoadEvidence(
            cache_reused=False,
            resumed_from=resumed_from,
            previous_verified_offset=previous_verified_offset,
        )
        return dataset


__all__ = ["CalculationSession", "SessionLoadEvidence"]
