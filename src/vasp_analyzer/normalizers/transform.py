from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import BinaryIO

from .fields import FieldValueError, parse_fields
from .manifest import LineChange, NormalizationManifest, bounded_excerpt
from .models import ProjectionRule
from .registry import NormalizerMatch

_NIONS = re.compile(r"(?<![A-Za-z0-9_])NIONS\s*=\s*([0-9]+)(?=\s|$)")
_HASH_CHUNK_SIZE = 64 * 1024
_MIN_DASHES = 10
MAX_LOGICAL_ROW_BYTES = 1024 * 1024
MAX_ATOM_COUNT = 100_000
MAX_STAGED_BLOCK_BYTES = 64 * 1024 * 1024


class OutcarNormalizationError(ValueError):
    """An OUTCAR cannot be safely normalized by the selected definition."""


def _hash_handle(source: BinaryIO) -> str:
    source.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(_HASH_CHUNK_SIZE), b""):
        digest.update(chunk)
    source.seek(0)
    return digest.hexdigest()


def _logical_lines(source: BinaryIO) -> Iterator[bytes]:
    source.seek(0)
    content = bytearray()
    line_number = 1
    pending_cr = False

    def append_bounded(segment: bytes) -> None:
        if len(content) + len(segment) > MAX_LOGICAL_ROW_BYTES:
            raise OutcarNormalizationError(
                f"logical row exceeds {MAX_LOGICAL_ROW_BYTES} bytes at line "
                f"{line_number}"
            )
        content.extend(segment)

    while chunk := source.read(_HASH_CHUNK_SIZE):
        if pending_cr:
            if chunk.startswith(b"\n"):
                yield bytes(content) + b"\r\n"
                chunk = chunk[1:]
            else:
                yield bytes(content) + b"\r"
            content.clear()
            line_number += 1
            pending_cr = False
        while chunk:
            cr_index = chunk.find(b"\r")
            lf_index = chunk.find(b"\n")
            indexes = [index for index in (cr_index, lf_index) if index >= 0]
            if not indexes:
                append_bounded(chunk)
                break
            ending_index = min(indexes)
            append_bounded(chunk[:ending_index])
            ending = chunk[ending_index : ending_index + 1]
            chunk = chunk[ending_index + 1 :]
            if ending == b"\r":
                if not chunk:
                    pending_cr = True
                    break
                if chunk.startswith(b"\n"):
                    ending = b"\r\n"
                    chunk = chunk[1:]
            yield bytes(content) + ending
            content.clear()
            line_number += 1
    if pending_cr:
        yield bytes(content) + b"\r"
        content.clear()
    elif content:
        yield bytes(content)
    source.seek(0)


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
    return len(stripped) >= _MIN_DASHES and set(stripped) == {"-"}


def _identity(file_stat: os.stat_result) -> tuple[int, int]:
    return file_stat.st_dev, file_stat.st_ino


def _open_source(path: Path) -> tuple[BinaryIO, os.stat_result]:
    try:
        path_stat = path.lstat()
    except OSError as error:
        raise OutcarNormalizationError(f"cannot inspect OUTCAR source: {error}") from error
    if stat.S_ISLNK(path_stat.st_mode):
        raise OutcarNormalizationError("OUTCAR source symlink is not allowed")
    if not stat.S_ISREG(path_stat.st_mode):
        raise OutcarNormalizationError("OUTCAR source must be a regular file")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise OutcarNormalizationError(f"cannot open OUTCAR source read-only: {error}") from error
    try:
        descriptor_stat = os.fstat(descriptor)
        if not stat.S_ISREG(descriptor_stat.st_mode):
            raise OutcarNormalizationError("OUTCAR source must be a regular file")
        if _identity(path_stat) != _identity(descriptor_stat):
            raise OutcarNormalizationError("OUTCAR source identity changed while opening")
        return os.fdopen(descriptor, "rb", closefd=True), descriptor_stat
    except Exception:
        os.close(descriptor)
        raise


def _validate_rules(rules: tuple[ProjectionRule, ...]) -> None:
    for rule in rules:
        columns = {column.name: column for column in rule.input.columns}
        if len(rule.output.emit) != 6 or any(
            columns[name].type != "finiteFloat" for name in rule.output.emit
        ):
            raise OutcarNormalizationError(
                f"rule {rule.id!r} must emit exactly six finiteFloat fields"
            )


def _extract_atom_count(text: str, line_number: int) -> int | None:
    if "NIONS" not in text:
        return None
    matches = tuple(_NIONS.finditer(text))
    if len(matches) != 1:
        qualifier = "ambiguous" if len(matches) > 1 else "invalid"
        raise OutcarNormalizationError(
            f"{qualifier} NIONS metadata at line {line_number}"
        )
    atom_count_digits = matches[0].group(1)
    if atom_count_digits.startswith("0"):
        raise OutcarNormalizationError(
            f"invalid NIONS metadata at line {line_number}"
        )
    maximum_digits = str(MAX_ATOM_COUNT)
    if (
        len(atom_count_digits) > len(maximum_digits)
        or (
            len(atom_count_digits) == len(maximum_digits)
            and atom_count_digits > maximum_digits
        )
    ):
        raise OutcarNormalizationError(
            f"atom count exceeds security bound {MAX_ATOM_COUNT} "
            f"at line {line_number}"
        )
    return int(atom_count_digits)


def _audit_source(
    source: BinaryIO,
    source_path: Path,
    initial_sha256: str,
    initial_identity: tuple[int, int],
) -> None:
    try:
        current_sha256 = _hash_handle(source)
    except (OSError, ValueError) as error:
        raise OutcarNormalizationError("source audit hash failed") from error
    if current_sha256 != initial_sha256:
        raise OutcarNormalizationError("source content changed during normalization session")
    try:
        current_path_stat = source_path.lstat()
    except OSError as error:
        raise OutcarNormalizationError(
            "source identity changed during normalization session"
        ) from error
    if (
        stat.S_ISLNK(current_path_stat.st_mode)
        or _identity(current_path_stat) != initial_identity
    ):
        raise OutcarNormalizationError(
            "source identity changed during normalization session"
        )


def _cleanup_temporary(
    temporary_directory: tempfile.TemporaryDirectory[str] | None,
) -> BaseException | None:
    if temporary_directory is None:
        return None
    try:
        temporary_directory.cleanup()
    except BaseException as error:
        return error
    return None


@dataclass
class NormalizedOutcarSession:
    parser_path: Path
    manifest: NormalizationManifest
    _source: BinaryIO
    _source_path: Path
    _source_identity: tuple[int, int]
    _temporary_directory: tempfile.TemporaryDirectory[str] | None = None
    _closed: bool = False

    def source_prefix(self, maximum_bytes: int) -> bytes:
        """Read a bounded prefix from the pinned, audited source descriptor."""

        if self._closed:
            raise OutcarNormalizationError("normalization session is closed")
        if maximum_bytes < 0:
            raise ValueError("maximum_bytes must be nonnegative")
        self._source.seek(0)
        prefix = self._source.read(maximum_bytes)
        self._source.seek(0)
        return prefix

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        audit_error: BaseException | None = None
        try:
            _audit_source(
                self._source,
                self._source_path,
                self.manifest.source_sha256,
                self._source_identity,
            )
        except BaseException as error:
            audit_error = error
        cleanup_error = _cleanup_temporary(self._temporary_directory)
        try:
            self._source.close()
        except BaseException as error:
            if audit_error is None:
                audit_error = error
            else:
                audit_error.add_note(f"source close also failed: {error!r}")
        self._temporary_directory = None
        if audit_error is not None:
            if cleanup_error is not None:
                audit_error.add_note(f"temporary cleanup also failed: {cleanup_error!r}")
            raise audit_error
        if cleanup_error is not None:
            raise OutcarNormalizationError(
                f"temporary cleanup failed: {cleanup_error!r}"
            ) from cleanup_error

    def __enter__(self) -> NormalizedOutcarSession:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            self.close()
        except BaseException as close_error:
            if exc_value is None:
                raise
            exc_value.add_note(
                f"normalization session close failed: {close_error!r}"
            )
            for note in getattr(close_error, "__notes__", ()):
                exc_value.add_note(note)


def _manifest(
    source_path: Path,
    source_stat: os.stat_result,
    match: NormalizerMatch,
    source_sha256: str,
    changes: tuple[LineChange, ...],
) -> NormalizationManifest:
    definition = match.definition
    return NormalizationManifest(
        normalizer_id=definition.id,
        display_name=definition.display_name,
        schema_version=definition.schema_version,
        definition_sha256=match.definition_hash,
        source_path=source_path,
        source_sha256=source_sha256,
        source_size=source_stat.st_size,
        source_mtime_ns=source_stat.st_mtime_ns,
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
    return emitted.encode("utf-8") + newline, LineChange(
        source_line=line_number,
        rule_id=rule.id,
        original_excerpt=bounded_excerpt(text),
        emitted_excerpt=bounded_excerpt(emitted),
    )


def _transform(
    source: BinaryIO,
    destination: Path,
    rules: tuple[ProjectionRule, ...],
) -> tuple[LineChange, ...]:
    changes: list[LineChange] = []
    atom_count: int | None = None
    with destination.open("wb") as output_stream:
        lines = enumerate(_logical_lines(source), start=1)
        for line_number, line in lines:
            content, _ = _split_newline(line)
            text = _decode(content, line_number)
            parsed_atom_count = _extract_atom_count(text, line_number)
            if parsed_atom_count is not None:
                if atom_count is not None:
                    raise OutcarNormalizationError(
                        f"repeated NIONS before block at line {line_number}"
                    )
                atom_count = parsed_atom_count

            rule = next(
                (
                    candidate
                    for candidate in rules
                    if all(
                        literal in text
                        for literal in candidate.scope.start.contains_all
                    )
                ),
                None,
            )
            output_stream.write(line)
            if rule is None:
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
            if not _is_dashed_separator(_decode(separator_content, separator_number)):
                raise OutcarNormalizationError(
                    f"line {separator_number}: expected dashed separator"
                )

            staged_rows: list[bytes] = []
            staged_changes: list[LineChange] = []
            staged_bytes = 0
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
                    row_content, row_newline, rule, row_number
                )
                staged_bytes += len(projected)
                if staged_bytes > MAX_STAGED_BLOCK_BYTES:
                    raise OutcarNormalizationError(
                        f"staged block exceeds {MAX_STAGED_BLOCK_BYTES} bytes "
                        f"at line {row_number}"
                    )
                staged_rows.append(projected)
                staged_changes.append(change)
            output_stream.write(separator_line)
            output_stream.writelines(staged_rows)
            changes.extend(staged_changes)
    return tuple(changes)


def _raise_failed_normalization(
    error: BaseException,
    source: BinaryIO,
    source_path: Path,
    source_sha256: str,
    source_identity: tuple[int, int],
    temporary_directory: tempfile.TemporaryDirectory[str] | None,
) -> None:
    audit_error: BaseException | None = None
    try:
        _audit_source(source, source_path, source_sha256, source_identity)
    except BaseException as caught:
        audit_error = caught
    cleanup_error = _cleanup_temporary(temporary_directory)
    try:
        source.close()
    except BaseException as close_error:
        if audit_error is None:
            audit_error = close_error
        else:
            audit_error.add_note(f"source close also failed: {close_error!r}")
    primary = audit_error or error
    if primary is not error:
        primary.add_note(f"normalization also failed: {error!r}")
    if cleanup_error is not None:
        primary.add_note(f"temporary cleanup also failed: {cleanup_error!r}")
    raise primary


def normalize_outcar(
    source: str | Path,
    match: NormalizerMatch,
) -> NormalizedOutcarSession:
    source_path = Path(source).absolute()
    _validate_rules(match.definition.rules)
    source_handle, source_stat = _open_source(source_path)
    source_identity = _identity(source_stat)
    temporary_directory: tempfile.TemporaryDirectory[str] | None = None
    try:
        source_sha256 = _hash_handle(source_handle)
        if not match.definition.rules:
            _audit_source(
                source_handle, source_path, source_sha256, source_identity
            )
            return NormalizedOutcarSession(
                parser_path=source_path,
                manifest=_manifest(
                    source_path, source_stat, match, source_sha256, ()
                ),
                _source=source_handle,
                _source_path=source_path,
                _source_identity=source_identity,
            )

        temporary_directory = tempfile.TemporaryDirectory(
            prefix="vasp-analyzer-normalized-"
        )
        destination = Path(temporary_directory.name) / "OUTCAR"
        changes = _transform(source_handle, destination, match.definition.rules)
        _audit_source(source_handle, source_path, source_sha256, source_identity)
        return NormalizedOutcarSession(
            parser_path=destination,
            manifest=_manifest(
                source_path, source_stat, match, source_sha256, changes
            ),
            _source=source_handle,
            _source_path=source_path,
            _source_identity=source_identity,
            _temporary_directory=temporary_directory,
        )
    except BaseException as error:
        if "source_sha256" not in locals():
            source_handle.close()
            raise
        _raise_failed_normalization(
            error,
            source_handle,
            source_path,
            source_sha256,
            source_identity,
            temporary_directory,
        )


__all__ = [
    "NormalizedOutcarSession",
    "OutcarNormalizationError",
    "normalize_outcar",
]
