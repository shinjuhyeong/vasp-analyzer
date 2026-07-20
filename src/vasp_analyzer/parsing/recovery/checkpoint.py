"""Append-only parser checkpoints for large OUTCAR files."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from typing import BinaryIO

from vasp_analyzer.core import FrozenModel, Mat3

_HASH_CHUNK_SIZE = 1024 * 1024


class ParserCheckpoint(FrozenModel):
    """Immutable state required to resume at a verified record boundary."""

    path: str
    size: int
    mtime_ns: int
    prefix_fingerprint: str
    last_verified_offset: int
    next_step_id: int
    expected_atom_count: int
    last_lattice: Mat3 | None


def _hash_prefix(stream: BinaryIO, size: int):  # type: ignore[no-untyped-def]
    digest = sha256()
    remaining = size
    while remaining:
        chunk = stream.read(min(remaining, _HASH_CHUNK_SIZE))
        if not chunk:
            break
        digest.update(chunk)
        remaining -= len(chunk)
    if remaining:
        raise OSError(f"file ended {remaining} bytes before the requested fingerprint boundary")
    return digest


def fingerprint_prefix(path: Path, size: int) -> str:
    """Return a SHA-256 fingerprint of exactly the first ``size`` bytes."""

    with path.open("rb") as stream:
        return _hash_prefix(stream, size).hexdigest()


def checkpoint_is_append_only(path: Path, checkpoint: ParserCheckpoint) -> bool:
    """Return whether the checkpoint names an unchanged prefix of ``path``."""

    stat = path.stat()
    return (
        str(path.resolve()) == checkpoint.path
        and 0 <= checkpoint.last_verified_offset <= checkpoint.size <= stat.st_size
        and checkpoint.expected_atom_count > 0
        and (checkpoint.last_verified_offset == 0 or checkpoint.last_lattice is not None)
        and fingerprint_prefix(path, checkpoint.size) == checkpoint.prefix_fingerprint
    )


__all__ = ["ParserCheckpoint", "checkpoint_is_append_only", "fingerprint_prefix"]
