from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_MAX_EXCERPT = 512


def bounded_excerpt(value: str) -> str:
    return value[:_MAX_EXCERPT]


@dataclass(frozen=True)
class LineChange:
    source_line: int
    rule_id: str
    original_excerpt: str
    emitted_excerpt: str


@dataclass(frozen=True)
class NormalizationManifest:
    normalizer_id: str
    display_name: str
    schema_version: int
    definition_sha256: str
    source_path: Path
    source_sha256: str
    source_size: int
    source_mtime_ns: int
    changes: tuple[LineChange, ...]
    warnings: tuple[str, ...] = ()

    @property
    def changed_line_count(self) -> int:
        return len(self.changes)

    @property
    def first_changed_line(self) -> int | None:
        return self.changes[0].source_line if self.changes else None

    @property
    def last_changed_line(self) -> int | None:
        return self.changes[-1].source_line if self.changes else None

    @property
    def rule_changed_line_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for change in self.changes:
            counts[change.rule_id] = counts.get(change.rule_id, 0) + 1
        return counts

    def transport_summary(self) -> dict[str, int | None]:
        return {
            "changedLineCount": self.changed_line_count,
            "firstChangedLine": self.first_changed_line,
            "lastChangedLine": self.last_changed_line,
        }


__all__ = [
    "LineChange",
    "NormalizationManifest",
    "bounded_excerpt",
]
