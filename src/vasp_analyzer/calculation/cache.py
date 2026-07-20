"""Fingerprint-addressed immutable calculation cache."""

from __future__ import annotations

import tempfile
from hashlib import sha256
from pathlib import Path

from vasp_analyzer.core import CalculationDataset, FrozenModel, SourceFile
from vasp_analyzer.parsing.recovery import ParserCheckpoint


class CachedCalculation(FrozenModel):
    dataset: CalculationDataset
    checkpoint: ParserCheckpoint


def cache_key(source: SourceFile, dialect_id: str, profile_id: str | None) -> str:
    payload = (
        f"{source.path}\0{source.size}\0{source.mtime_ns}\0{source.fingerprint}\0"
        f"{dialect_id}\0{profile_id or ''}"
    )
    return sha256(payload.encode()).hexdigest()


class CacheStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    @classmethod
    def default(cls) -> "CacheStore":
        return cls(Path(tempfile.gettempdir()) / "vasp-analyzer-cache-v1")

    def get(self, key: str) -> CachedCalculation | None:
        path = self.root / f"{key}.json"
        try:
            return CachedCalculation.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def put(self, key: str, payload: CachedCalculation) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        destination = self.root / f"{key}.json"
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(payload.model_dump_json(), encoding="utf-8")
        temporary.replace(destination)


__all__ = ["CacheStore", "CachedCalculation", "cache_key"]
