"""Incrementally refreshable calculation sessions."""

from pathlib import Path

from vasp_analyzer.core import CalculationDataset, SourceFile
from vasp_analyzer.parsing.profiles import CompatibilityProfile
from vasp_analyzer.parsing.recovery import ParserCheckpoint

from .cache import CacheStore, CachedCalculation, cache_key
from .dataset import _assemble, detect_path_dialect, inspect_calculation
from .discovery import discover_calculation


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

    def load(self) -> CalculationDataset:
        discovered = discover_calculation(self.path)
        source = inspect_calculation(discovered)
        dialect = detect_path_dialect(discovered, self.profile)
        key = cache_key(source, dialect.id, self.profile.id if self.profile else None)
        cached = self.cache.get(key)
        if cached is None:
            dataset, checkpoint, _ = _assemble(self.path, self.profile)
            cached = CachedCalculation(dataset=dataset, checkpoint=checkpoint)
            self.cache.put(key, cached)
        self._dataset = cached.dataset
        self._checkpoint = cached.checkpoint
        self._source = source
        return cached.dataset

    def refresh_if_changed(self) -> CalculationDataset:
        discovered = discover_calculation(self.path)
        source = inspect_calculation(discovered)
        if self._dataset is not None and source == self._source:
            return self._dataset
        if self._dataset is None or self._checkpoint is None:
            return self.load()
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
        return dataset


__all__ = ["CalculationSession"]
