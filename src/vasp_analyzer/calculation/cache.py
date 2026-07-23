"""Fingerprint-addressed immutable calculation cache."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path

from vasp_analyzer.core import CalculationDataset, FrozenModel, SourceFile
from vasp_analyzer.parsing.profiles import CompatibilityProfile
_CACHE_SCHEMA_VERSION = 5
_WRITE_LOCK = threading.Lock()


class CachedCalculation(FrozenModel):
    dataset: CalculationDataset


def cache_key(
    source: SourceFile,
    dialect_id: str,
    profile: CompatibilityProfile,
    normalizer_definition_sha256: str = "",
) -> str:
    profile_json = json.dumps(
        profile.model_dump(mode="json", by_alias=False),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    payload = json.dumps(
        {
            "cache_schema": _CACHE_SCHEMA_VERSION,
            "analyzer_version": version("vasp-analyzer"),
            "parser_profile_schema": profile.schema_version,
            "source": source.model_dump(mode="json", by_alias=False),
            "dialect": dialect_id,
            "profile_sha256": sha256(profile_json.encode()).hexdigest(),
            "normalizer_definition_sha256": normalizer_definition_sha256,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(payload.encode()).hexdigest()


class CacheStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    @classmethod
    def default(cls) -> "CacheStore":
        if os.name == "nt":
            base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        else:
            base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
        return cls(base / "vasp-analyzer")

    def ensure_private_root(self) -> None:
        if self.root.is_symlink():
            raise OSError("cache root must not be a symbolic link")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name == "posix":
            stat = self.root.stat()
            if stat.st_uid != os.getuid():
                raise OSError("cache root is not owned by the current user")
            self.root.chmod(0o700)

    def get(self, key: str) -> CachedCalculation | None:
        self.ensure_private_root()
        path = self.root / f"{key}.json"
        try:
            return CachedCalculation.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def put(self, key: str, payload: CachedCalculation) -> None:
        self.put_raw(key, payload.model_dump_json(exclude_computed_fields=True))

    def put_raw(self, key: str, serialized: str) -> None:
        self.ensure_private_root()
        destination = self.root / f"{key}.json"
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{key}.", suffix=".tmp", dir=self.root
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(serialized)
                stream.flush()
                os.fsync(stream.fileno())
            if os.name == "posix":
                temporary.chmod(0o600)
            with _WRITE_LOCK:
                os.replace(temporary, destination)
                if os.name == "posix":
                    destination.chmod(0o600)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


__all__ = ["CacheStore", "CachedCalculation", "cache_key"]
