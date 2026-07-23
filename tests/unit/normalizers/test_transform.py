from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from vasp_analyzer.normalizers.fields import FieldValueError, parse_fields
from vasp_analyzer.normalizers.models import NormalizerDefinition
from vasp_analyzer.normalizers.registry import NormalizerMatch
from vasp_analyzer.normalizers import transform
from vasp_analyzer.normalizers.transform import (
    OutcarNormalizationError,
    normalize_outcar,
)


FIXTURES = Path(__file__).parents[2] / "fixtures" / "normalizers"


def _columns(*columns: dict[str, object]):
    emitted = next(
        (str(column["name"]) for column in columns if column["type"] != "text"),
        None,
    )
    if emitted is None:
        raise ValueError("test helper requires one emit-capable column")
    candidate = {
        "schemaVersion": 1,
        "id": "test",
        "displayName": "Test",
        "priority": 1,
        "detect": {"all": [], "any": [], "none": []},
        "rules": [
            {
                "id": "projection",
                "scope": {
                    "start": {"containsAll": ["START"]},
                    "after": {"type": "dashedSeparator"},
                    "rowCount": {"source": "atomCount"},
                },
                "input": {"tokenizer": "whitespace", "columns": list(columns)},
                "output": {"emit": [emitted], "separator": "  "},
            }
        ],
    }
    return NormalizerDefinition.model_validate(candidate).rules[0].input.columns


def _home_match() -> NormalizerMatch:
    definition = json.loads(
        (
            Path(__file__).parents[3]
            / "src"
            / "vasp_analyzer"
            / "normalizers"
            / "definitions"
            / "home_barrier.json"
        ).read_text(encoding="utf-8")
    )
    return NormalizerMatch.from_definition(definition)


def _standard_match() -> NormalizerMatch:
    return NormalizerMatch.from_definition(
        {
            "schemaVersion": 1,
            "id": "standard",
            "displayName": "Standard",
            "priority": 0,
            "detect": {"all": [], "any": [], "none": []},
            "rules": [],
        }
    )


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_typed_field_registry_accepts_all_schema_one_types() -> None:
    columns = _columns(
        {"name": "species", "type": "elementLabel", "allowedSuffixes": ["_"]},
        {"name": "index", "type": "positiveInteger"},
        {"name": "number", "type": "finiteFloat"},
        {"name": "tag", "type": "literal", "value": "fixed"},
        {"name": "ignored", "type": "text"},
    )

    parsed = parse_fields("O_ 12 -1.25D+02 fixed note", columns, line_number=7)

    assert parsed == {
        "species": "O_",
        "index": "12",
        "number": "-1.25D+02",
        "tag": "fixed",
        "ignored": "note",
    }


@pytest.mark.parametrize(
    ("token", "column"),
    [
        ("O-", {"name": "species", "type": "elementLabel", "allowedSuffixes": ["_"]}),
        ("Xx", {"name": "species", "type": "elementLabel"}),
        ("0", {"name": "index", "type": "positiveInteger"}),
        ("+1", {"name": "index", "type": "positiveInteger"}),
        ("nan", {"name": "number", "type": "finiteFloat"}),
        ("inf", {"name": "number", "type": "finiteFloat"}),
        ("1.2.3", {"name": "number", "type": "finiteFloat"}),
        ("wrong", {"name": "tag", "type": "literal", "value": "fixed"}),
    ],
)
def test_typed_field_registry_rejects_invalid_values(
    token: str, column: dict[str, object]
) -> None:
    columns = _columns(column)
    with pytest.raises(FieldValueError, match="line 9"):
        parse_fields(token, columns, line_number=9)


@pytest.mark.parametrize("row", ["1.0 extra", ""])
def test_projection_rejects_extra_or_missing_tokens(row: str) -> None:
    columns = _columns({"name": "number", "type": "finiteFloat"})
    with pytest.raises(FieldValueError, match="token"):
        parse_fields(row, columns, line_number=3)


def test_specialized_projection_is_line_and_newline_preserving(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(
        b"vasp.5.4.1-barrier\r\n"
        b"NIONS = 2 ions\n"
        b"POSITION TOTAL-FORCE\r\n"
        b"---------------------\n"
        b"O_ 1 0 1 2 3 4 5\r\n"
        b"Y 1 6D0 7 8 9 10 11\n"
        b"tail\r\n"
    )
    source_hash = _sha(source)

    with normalize_outcar(source, _home_match()) as session:
        assert session.parser_path != source
        output = session.parser_path.read_bytes()
        assert output == (
            b"vasp.5.4.1-barrier\r\n"
            b"NIONS = 2 ions\n"
            b"POSITION TOTAL-FORCE\r\n"
            b"---------------------\n"
            b"0  1  2  3  4  5\r\n"
            b"6D0  7  8  9  10  11\n"
            b"tail\r\n"
        )
        assert len(output.splitlines()) == len(source.read_bytes().splitlines())
        parser_path = session.parser_path
        assert session.manifest.changed_line_count == 2
        assert session.manifest.first_changed_line == 5
        assert session.manifest.last_changed_line == 6
        assert [change.source_line for change in session.manifest.changes] == [5, 6]
        assert session.manifest.transport_summary() == {
            "changedLineCount": 2,
            "firstChangedLine": 5,
            "lastChangedLine": 6,
        }
        assert _sha(source) == source_hash == session.manifest.source_sha256

    assert not parser_path.exists()
    assert _sha(source) == source_hash


def test_standard_session_returns_source_without_copy(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(b"ordinary\r\nOUTCAR\n")

    with normalize_outcar(source, _standard_match()) as session:
        assert session.parser_path == source
        assert session.manifest.changed_line_count == 0
        assert session.manifest.changes == ()

    assert source.read_bytes() == b"ordinary\r\nOUTCAR\n"
    assert list(tmp_path.iterdir()) == [source]


@pytest.mark.parametrize(
    ("fixture", "message"),
    [
        ("partial-home.OUTCAR", "partial"),
        ("home-small.OUTCAR", "unused"),
    ],
)
def test_invalid_or_partial_block_is_all_or_nothing(
    tmp_path: Path, fixture: str, message: str
) -> None:
    source = tmp_path / "OUTCAR"
    content = (FIXTURES / fixture).read_bytes()
    if message == "unused":
        content = content.replace(b"Y 1 6.0D+00", b"Y 1 nan")
        message = "finiteFloat"
    source.write_bytes(content)
    source_hash = _sha(source)

    with pytest.raises(OutcarNormalizationError, match=message):
        normalize_outcar(source, _home_match())

    assert source.read_bytes() == content
    assert _sha(source) == source_hash
    assert list(tmp_path.iterdir()) == [source]


def test_requires_valid_positive_nions_before_the_block(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    source.write_text(
        "vasp.5.4.1-barrier\n"
        "POSITION TOTAL-FORCE\n"
        "--------------------\n"
        "O_ 1 0 1 2 3 4 5\n",
        encoding="utf-8",
    )
    with pytest.raises(OutcarNormalizationError, match="NIONS"):
        normalize_outcar(source, _home_match())


def test_rejects_non_utf8_with_original_line_number_and_cleans_up(
    tmp_path: Path,
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(
        b"vasp.5.4.1-barrier\nNIONS = 1 ions\nPOSITION TOTAL-FORCE\n"
        b"--------------------\nO_ 1 0 1 \xff 3 4 5\n"
    )
    with pytest.raises(OutcarNormalizationError, match=r"UTF-8.*line 5"):
        normalize_outcar(source, _home_match())
    assert list(tmp_path.iterdir()) == [source]


def test_manifest_excerpts_are_bounded_to_512_characters(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    padding = " " * 700
    source.write_text(
        "vasp.5.4.1-barrier\n"
        "NIONS = 1 ions\n"
        "POSITION TOTAL-FORCE\n"
        "--------------------\n"
        f"{padding}O_ 1 0 1 2 3 4 5\n",
        encoding="utf-8",
    )

    with normalize_outcar(source, _home_match()) as session:
        change = session.manifest.changes[0]
        assert len(change.original_excerpt) == 512
        assert len(change.emitted_excerpt) <= 512


def test_failure_path_checks_source_sha_and_removes_temporary_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes((FIXTURES / "home-small.OUTCAR").read_bytes())
    temporary_roots: list[Path] = []
    real_temporary_directory = transform.tempfile.TemporaryDirectory

    def tracked_temporary_directory(*args: object, **kwargs: object):
        session = real_temporary_directory(*args, **kwargs)
        temporary_roots.append(Path(session.name))
        return session

    def mutate_then_fail(*args: object, **kwargs: object):
        source.write_bytes(source.read_bytes() + b"external mutation\n")
        raise OutcarNormalizationError("injected transform failure")

    monkeypatch.setattr(
        transform.tempfile, "TemporaryDirectory", tracked_temporary_directory
    )
    monkeypatch.setattr(transform, "_transform", mutate_then_fail)

    with pytest.raises(OutcarNormalizationError, match="source content changed"):
        normalize_outcar(source, _home_match())

    assert temporary_roots
    assert all(not path.exists() for path in temporary_roots)


def test_lone_cr_lines_and_no_final_newline_are_preserved(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(
        b"vasp.5.4.1-barrier\rNIONS = 1 ions\rPOSITION TOTAL-FORCE\r"
        b"----------\rO_ 1 0 1 2 3 4 5"
    )
    with normalize_outcar(source, _home_match()) as session:
        assert session.parser_path.read_bytes() == (
            b"vasp.5.4.1-barrier\rNIONS = 1 ions\rPOSITION TOTAL-FORCE\r"
            b"----------\r0  1  2  3  4  5"
        )


@pytest.mark.parametrize(
    "metadata",
    [
        "NIONS = 0 ions",
        "NIONS = -1 ions",
        "NIONS = +1 ions",
        "NIONS = 01 ions",
        "prefix NIONS = 1 ions",
        "NIONS = 1 ions trailing",
        "NIONS = one ions",
    ],
)
def test_rejects_malformed_or_noncanonical_nions(
    tmp_path: Path, metadata: str
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_text(
        f"vasp.5.4.1-barrier\n{metadata}\nPOSITION TOTAL-FORCE\n"
        "----------\nO_ 1 0 1 2 3 4 5\n",
        encoding="utf-8",
    )
    with pytest.raises(OutcarNormalizationError, match="NIONS"):
        normalize_outcar(source, _home_match())


def test_one_validated_nions_applies_to_multiple_ionic_blocks(
    tmp_path: Path,
) -> None:
    source = tmp_path / "OUTCAR"
    block = "POSITION TOTAL-FORCE\n----------\nO_ 1 0 1 2 3 4 5\n"
    source.write_text(
        f"vasp.5.4.1-barrier\nNIONS = 1 ions\n{block}{block}",
        encoding="utf-8",
    )
    with normalize_outcar(source, _home_match()) as session:
        assert session.manifest.changed_line_count == 2


def test_repeated_unconsumed_nions_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    source.write_text(
        "vasp.5.4.1-barrier\nNIONS = 1 ions\nNIONS = 1 ions\n"
        "POSITION TOTAL-FORCE\n----------\nO_ 1 0 1 2 3 4 5\n",
        encoding="utf-8",
    )
    with pytest.raises(OutcarNormalizationError, match="repeated NIONS"):
        normalize_outcar(source, _home_match())


@pytest.mark.parametrize("separator", ["---", "-----x-----"])
def test_rejects_short_or_embedded_dashed_separator(
    tmp_path: Path, separator: str
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_text(
        "vasp.5.4.1-barrier\nNIONS = 1 ions\nPOSITION TOTAL-FORCE\n"
        f"{separator}\nO_ 1 0 1 2 3 4 5\n",
        encoding="utf-8",
    )
    with pytest.raises(OutcarNormalizationError, match="dashed separator"):
        normalize_outcar(source, _home_match())


def test_transform_boundary_requires_exactly_six_finite_float_emits(
    tmp_path: Path,
) -> None:
    definition = {
        "schemaVersion": 1,
        "id": "unsafe",
        "displayName": "Unsafe",
        "priority": 1,
        "detect": {"all": [], "any": [], "none": []},
        "rules": [
            {
                "id": "bad",
                "scope": {
                    "start": {"containsAll": ["POSITION", "TOTAL-FORCE"]},
                    "after": {"type": "dashedSeparator"},
                    "rowCount": {"source": "atomCount"},
                },
                "input": {
                    "tokenizer": "whitespace",
                    "columns": [
                        {"name": "label", "type": "elementLabel"},
                        {"name": "x", "type": "finiteFloat"},
                    ],
                },
                "output": {"emit": ["label", "x"], "separator": "  "},
            }
        ],
    }
    source = tmp_path / "OUTCAR"
    source.write_text("ordinary", encoding="utf-8")
    with pytest.raises(OutcarNormalizationError, match="six finiteFloat"):
        normalize_outcar(source, NormalizerMatch.from_definition(definition))


def test_rejects_symlink_source(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.write_text("ordinary", encoding="utf-8")
    link = tmp_path / "link"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("symlink creation is unavailable on this platform")
    with pytest.raises(OutcarNormalizationError, match="symlink"):
        normalize_outcar(link, _standard_match())


def test_rejects_non_regular_source(tmp_path: Path) -> None:
    with pytest.raises(OutcarNormalizationError, match="regular file"):
        normalize_outcar(tmp_path, _standard_match())


def test_standard_session_detects_source_mutation_on_close(tmp_path: Path) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(b"ordinary\n")
    session = normalize_outcar(source, _standard_match())
    source.write_bytes(b"changed\n")
    with pytest.raises(OutcarNormalizationError, match="source.*changed"):
        session.close()


def test_path_replacement_does_not_change_pinned_source_audit(tmp_path: Path) -> None:
    if os.name == "nt":
        pytest.skip("Windows does not permit replacing an open file")
    source = tmp_path / "OUTCAR"
    source.write_bytes(b"ordinary\n")
    session = normalize_outcar(source, _standard_match())
    replacement = tmp_path / "replacement"
    replacement.write_bytes(b"different\n")
    replacement.replace(source)
    with pytest.raises(OutcarNormalizationError, match="identity"):
        session.close()


def test_audit_runs_and_is_primary_when_temporary_cleanup_also_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes((FIXTURES / "home-small.OUTCAR").read_bytes())
    session = normalize_outcar(source, _home_match())
    source.write_bytes(source.read_bytes() + b"changed\n")

    def cleanup_failure() -> None:
        raise OSError("cleanup injected")

    assert session._temporary_directory is not None
    monkeypatch.setattr(session._temporary_directory, "cleanup", cleanup_failure)
    with pytest.raises(OutcarNormalizationError, match="source content changed") as caught:
        session.close()
    assert any("cleanup injected" in note for note in caught.value.__notes__)


def test_transform_failure_still_audits_when_cleanup_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes((FIXTURES / "home-small.OUTCAR").read_bytes())
    audits: list[Path] = []
    real_audit = transform._audit_source
    real_temporary = transform.tempfile.TemporaryDirectory

    class CleanupFailure:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._real = real_temporary(*args, **kwargs)
            self.name = self._real.name

        def cleanup(self) -> None:
            self._real.cleanup()
            raise OSError("cleanup injected")

    def audited(*args: object, **kwargs: object) -> None:
        audits.append(source)
        real_audit(*args, **kwargs)

    def write_failure(*args: object, **kwargs: object) -> None:
        raise OSError("write injected")

    monkeypatch.setattr(transform.tempfile, "TemporaryDirectory", CleanupFailure)
    monkeypatch.setattr(transform, "_audit_source", audited)
    monkeypatch.setattr(transform, "_transform", write_failure)

    with pytest.raises(OSError, match="write injected") as caught:
        normalize_outcar(source, _home_match())
    assert audits
    assert any("cleanup injected" in note for note in caught.value.__notes__)


def test_standard_hash_audit_failure_is_mapped_and_handle_is_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(b"ordinary\n")
    real_hash = transform._hash_handle
    calls = 0

    def failing_second_hash(handle) -> str:
        nonlocal calls
        calls += 1
        if calls >= 2:
            raise OSError("hash injected")
        return real_hash(handle)

    monkeypatch.setattr(transform, "_hash_handle", failing_second_hash)
    with pytest.raises(OutcarNormalizationError, match="audit.*hash"):
        normalize_outcar(source, _standard_match())
    assert calls >= 3


def test_open_rejects_descriptor_identity_race(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "OUTCAR"
    source.write_bytes(b"ordinary\n")
    real_fstat = transform.os.fstat

    def mismatched_fstat(descriptor: int):
        result = real_fstat(descriptor)
        values = list(result)
        values[1] += 1
        return os.stat_result(values)

    monkeypatch.setattr(transform.os, "fstat", mismatched_fstat)
    with pytest.raises(OutcarNormalizationError, match="identity changed"):
        normalize_outcar(source, _standard_match())
