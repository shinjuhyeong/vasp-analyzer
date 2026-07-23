from __future__ import annotations

import hashlib
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

from .fields import FieldValueError, parse_fields
from .manifest import LineChange, NormalizationManifest, bounded_excerpt
from .models import ProjectionRule
from .registry import NormalizerMatch

_NIONS = re.compile(r"\bNIONS\s*=\s*([0-9]+)\b")
_HASH_CHUNK_SIZE = 64 * 1024


class OutcarNormalizationError(ValueError):
    """An OUTCAR cannot be safely normalized by the selected definition."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(_HASH_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _split_newline(line: bytes) -> tuple[bytes, bytes]:
    if line.endswith(b"\r\n"):
        return line[:-2], b"\r\n"
    if line.endswith(b"\n") or line.endswith(b"\r"):
        return line[:-1], line[-1:]
    return line, b""


def _decode(content: bytes, line_number: int) -> str:
    try:
        return content.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise OutcarNormalizationError(
            f"invalid UTF-8 source row at original line {line_number}"
        ) from error


def _is_dashed_separator(text: str) -> bool:
    stripped = text.strip()
    return len(stripped) >= 3 and set(stripped) == {"-"}


@dataclass
class NormalizedOutcarSession:
    parser_path: Path
    manifest: NormalizationManifest
    _temporary_directory: tempfile.TemporaryDirectory[str] | None = None

    def close(self) -> None:
        if self._temporary_directory is not None:
            self._temporary_directory.cleanup()
            self._temporary_directory = None

    def __enter__(self) -> NormalizedOutcarSession:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


def _manifest(
    source: Path,
    match: NormalizerMatch,
    source_sha256: str,
    changes: tuple[LineChange, ...],
) -> NormalizationManifest:
    stat = source.stat()
    definition = match.definition
    return NormalizationManifest(
        normalizer_id=definition.id,
        display_name=definition.display_name,
        schema_version=definition.schema_version,
        definition_sha256=match.definition_hash,
        source_path=source,
        source_sha256=source_sha256,
        source_size=stat.st_size,
        source_mtime_ns=stat.st_mtime_ns,
        changes=changes,
    )


def _project_row(
    content: bytes,
    newline: bytes,
    rule: ProjectionRule,
    line_number: int,
) -> tuple[bytes, LineChange]:
    text = _decode(content, line_number)
    try:
        parsed = parse_fields(text, rule.input.columns, line_number=line_number)
    except FieldValueError as error:
        raise OutcarNormalizationError(str(error)) from error
    emitted = rule.output.separator.join(parsed[name] for name in rule.output.emit)
    emitted_bytes = emitted.encode("utf-8") + newline
    return emitted_bytes, LineChange(
        source_line=line_number,
        rule_id=rule.id,
        original_excerpt=bounded_excerpt(text),
        emitted_excerpt=bounded_excerpt(emitted),
    )


def _transform(
    source: Path,
    destination: Path,
    rules: tuple[ProjectionRule, ...],
) -> tuple[LineChange, ...]:
    changes: list[LineChange] = []
    atom_count: int | None = None
    waiting_rule: ProjectionRule | None = None

    with source.open("rb") as input_stream, destination.open("wb") as output_stream:
        lines = enumerate(input_stream, start=1)
        for line_number, line in lines:
            content, newline = _split_newline(line)
            text = _decode(content, line_number)
            nions = _NIONS.search(text)
            if nions is not None:
                candidate = int(nions.group(1))
                if candidate <= 0:
                    raise OutcarNormalizationError(
                        f"invalid NIONS positive integer at line {line_number}"
                    )
                atom_count = candidate

            waiting_rule = next(
                (
                    rule
                    for rule in rules
                    if all(literal in text for literal in rule.scope.start.contains_all)
                ),
                None,
            )
            output_stream.write(line)
            if waiting_rule is None:
                continue
            if atom_count is None:
                raise OutcarNormalizationError(
                    f"NIONS must be established before block at line {line_number}"
                )

            try:
                separator_number, separator_line = next(lines)
            except StopIteration as error:
                raise OutcarNormalizationError(
                    f"partial block after line {line_number}: missing dashed separator"
                ) from error
            separator_content, _ = _split_newline(separator_line)
            separator_text = _decode(separator_content, separator_number)
            if not _is_dashed_separator(separator_text):
                raise OutcarNormalizationError(
                    f"line {separator_number}: expected dashed separator"
                )

            staged_rows: list[bytes] = []
            staged_changes: list[LineChange] = []
            for _ in range(atom_count):
                try:
                    row_number, row = next(lines)
                except StopIteration as error:
                    raise OutcarNormalizationError(
                        f"partial block after line {line_number}: "
                        f"expected {atom_count} atom rows"
                    ) from error
                row_content, row_newline = _split_newline(row)
                projected, change = _project_row(
                    row_content, row_newline, waiting_rule, row_number
                )
                staged_rows.append(projected)
                staged_changes.append(change)

            output_stream.write(separator_line)
            for projected in staged_rows:
                output_stream.write(projected)
            changes.extend(staged_changes)
            waiting_rule = None

    return tuple(changes)


def normalize_outcar(
    source: str | Path,
    match: NormalizerMatch,
) -> NormalizedOutcarSession:
    source_path = Path(source).resolve(strict=True)
    source_sha256 = _sha256(source_path)
    if not match.definition.rules:
        after_sha256 = _sha256(source_path)
        if source_sha256 != after_sha256:
            raise OutcarNormalizationError("source SHA-256 changed during normalization")
        return NormalizedOutcarSession(
            parser_path=source_path,
            manifest=_manifest(source_path, match, source_sha256, ()),
        )

    temporary_directory: tempfile.TemporaryDirectory[str] | None = None
    try:
        temporary_directory = tempfile.TemporaryDirectory(
            prefix="vasp-analyzer-normalized-"
        )
        destination = Path(temporary_directory.name) / "OUTCAR"
        changes = _transform(source_path, destination, match.definition.rules)
        after_sha256 = _sha256(source_path)
        if source_sha256 != after_sha256:
            raise OutcarNormalizationError("source SHA-256 changed during normalization")
        return NormalizedOutcarSession(
            parser_path=destination,
            manifest=_manifest(source_path, match, source_sha256, changes),
            _temporary_directory=temporary_directory,
        )
    except Exception as error:
        if temporary_directory is not None:
            temporary_directory.cleanup()
        try:
            failure_sha256 = _sha256(source_path)
        except OSError as hash_error:
            raise OutcarNormalizationError(
                "source SHA-256 could not be verified after normalization failure"
            ) from hash_error
        if source_sha256 != failure_sha256:
            raise OutcarNormalizationError(
                "source SHA-256 changed during failed normalization"
            ) from error
        raise


__all__ = [
    "NormalizedOutcarSession",
    "OutcarNormalizationError",
    "normalize_outcar",
]
