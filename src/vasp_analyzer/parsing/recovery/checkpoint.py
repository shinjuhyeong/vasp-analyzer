"""Append-only parser checkpoints for large OUTCAR files."""

from __future__ import annotations

import math
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
    replay_provisional: bool = False
    normally_finished: bool = False
    species: tuple[str, ...] = ()


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


def _valid_lattice(lattice: Mat3 | None) -> bool:
    if lattice is None:
        return False
    if not all(math.isfinite(value) for row in lattice for value in row):
        return False
    a, b, c = lattice
    determinant = (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )
    return math.isfinite(determinant) and determinant != 0.0


def _is_line_boundary(path: Path, offset: int) -> bool:
    if offset == 0:
        return True
    with path.open("rb") as stream:
        stream.seek(offset - 1)
        return stream.read(1) == b"\n"


def checkpoint_is_append_only(path: Path, checkpoint: ParserCheckpoint) -> bool:
    """Return whether the checkpoint names an unchanged prefix of ``path``."""

    stat = path.stat()
    return (
        str(path.resolve()) == checkpoint.path
        and 0 <= checkpoint.last_verified_offset <= checkpoint.size <= stat.st_size
        and checkpoint.next_step_id >= 0
        and checkpoint.expected_atom_count > 0
        and (not checkpoint.species or len(checkpoint.species) == checkpoint.expected_atom_count)
        and (
            checkpoint.last_verified_offset == 0
            or _valid_lattice(checkpoint.last_lattice)
        )
        and (
            not checkpoint.replay_provisional
            or 0 < checkpoint.last_verified_offset < checkpoint.size
        )
        and (not checkpoint.normally_finished or not checkpoint.replay_provisional)
        and _is_line_boundary(path, checkpoint.last_verified_offset)
        and fingerprint_prefix(path, checkpoint.size) == checkpoint.prefix_fingerprint
    )


__all__ = ["ParserCheckpoint", "checkpoint_is_append_only", "fingerprint_prefix"]
