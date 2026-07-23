from __future__ import annotations

from pathlib import Path

import pytest

from vasp_analyzer.parsing import outcar_metadata as metadata_module
from vasp_analyzer.parsing.outcar_metadata import read_outcar_metadata
from vasp_analyzer.parsing.profiles.models import OutcarRule


STANDARD_RULE = OutcarRule()


def test_malformed_assignment_warns_and_later_parameter_survives(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b" Startparameter for this run:\n"
        b" BROKEN =\n"
        b" ENCUT = 520 eV plane-wave cutoff\n"
        b" Dimension of arrays:\n"
    )

    result = read_outcar_metadata(path, STANDARD_RULE)

    assert [item.raw_key for item in result.parameters] == ["ENCUT"]
    assert result.parameters[0].value == 520
    assert any(w.category == "MetadataParseFailure" for w in result.warnings)


def test_undecodable_assignment_warns_and_later_parameter_survives(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b" Startparameter for this run:\n"
        b" BROKEN = \xff\n"
        b" NSW = 8 ionic steps\n"
        b" Dimension of arrays:\n"
    )

    result = read_outcar_metadata(path, STANDARD_RULE)

    assert [item.raw_key for item in result.parameters] == ["NSW"]
    assert any(w.category == "MetadataParseFailure" for w in result.warnings)


def test_oversized_logical_line_warns_and_scanning_continues(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b" Startparameter for this run:\n"
        + b" X = "
        + b"1" * (1024 * 1024)
        + b"\n"
        + b" Startparameter for this run:\n"
        + b" NSW = 4 ionic steps\n"
        + b" Dimension of arrays:\n"
    )

    result = read_outcar_metadata(path, STANDARD_RULE)

    assert [item.raw_key for item in result.parameters] == ["NSW"]
    assert any("exceeds" in warning.message for warning in result.warnings)


def test_malformed_pressure_warns_and_later_metadata_survives(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b"external pressure = nope kB Pullay stress = 1.0 kB\n"
        b" Startparameter for this run:\n"
        b" ENCUT = 500 eV cutoff\n"
        b" Dimension of arrays:\n"
    )

    result = read_outcar_metadata(path, STANDARD_RULE)

    assert result.pressure_details == ((None, None),)
    assert [item.raw_key for item in result.parameters] == ["ENCUT"]
    assert any(w.category == "MetadataParseFailure" for w in result.warnings)


def test_open_failure_returns_bounded_path_free_warning(tmp_path: Path) -> None:
    missing = tmp_path / "private" / "OUTCAR"

    result = read_outcar_metadata(missing, STANDARD_RULE)

    assert result.parameters == ()
    assert result.pressure_details == ()
    assert len(result.warnings) == 1
    assert len(result.warnings[0].message) <= 512
    assert str(tmp_path) not in result.warnings[0].message


def test_unexpected_line_error_warns_and_scanning_continues(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b" Startparameter for this run:\n"
        b" BROKEN = 1\n"
        b" NSW = 4\n"
        b" Dimension of arrays:\n"
    )
    original = metadata_module.parse_parameter_assignments

    def fail_one(line: bytes, **kwargs: object):
        if b"BROKEN" in line:
            raise RuntimeError("unexpected internal detail")
        return original(line, **kwargs)

    monkeypatch.setattr(metadata_module, "parse_parameter_assignments", fail_one)

    result = read_outcar_metadata(path, STANDARD_RULE)

    assert [item.raw_key for item in result.parameters] == ["NSW"]
    assert any(w.category == "MetadataParseFailure" for w in result.warnings)


def test_memory_error_is_not_swallowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b" Startparameter for this run:\n"
        b" NSW = 4\n"
        b" Dimension of arrays:\n"
    )

    def fail_memory(*_args: object, **_kwargs: object):
        raise MemoryError

    monkeypatch.setattr(metadata_module, "parse_parameter_assignments", fail_memory)

    with pytest.raises(MemoryError):
        read_outcar_metadata(path, STANDARD_RULE)
