from __future__ import annotations

import hashlib
import json
import os
from importlib.resources import files
from pathlib import Path

import pytest
from typer.testing import CliRunner

from vasp_analyzer.cli.app import create_app
from vasp_analyzer.cli import normalizer as normalizer_cli


RUNNER = CliRunner()


def _private_home_outcar() -> Path | None:
    for parent in (Path.cwd(), *Path.cwd().parents):
        candidate = parent / "audit-input" / "OUTCAR_homever"
        if candidate.is_file():
            return candidate
    return None


def _home_definition() -> dict[str, object]:
    resource = files("vasp_analyzer.normalizers.definitions").joinpath(
        "home_barrier.json"
    )
    return json.loads(resource.read_text(encoding="utf-8"))


def test_normalizer_list_is_deterministic_and_identifies_sources(
    tmp_path: Path,
) -> None:
    user_directory = tmp_path / "vasp-analyzer" / "normalizers"
    user_directory.mkdir(parents=True)
    definition = {
        "schemaVersion": 1,
        "id": "custom",
        "displayName": "Custom",
        "priority": 5,
        "detect": {"all": ["CUSTOM"], "any": [], "none": []},
        "rules": [],
    }
    (user_directory / "custom.json").write_text(
        json.dumps(definition), encoding="utf-8"
    )
    app = create_app(environ={"XDG_CONFIG_HOME": str(tmp_path)})

    first = RUNNER.invoke(app, ["normalizer", "list"])
    second = RUNNER.invoke(app, ["normalizer", "list"])

    assert first.exit_code == 0
    assert first.stdout == second.stdout
    payload = json.loads(first.stdout)
    assert [item["id"] for item in payload["normalizers"]] == [
        "home-barrier",
        "standard",
        "custom",
    ]
    assert payload["normalizers"][0]["builtIn"] is True
    assert payload["normalizers"][0]["sourcePath"].endswith("home_barrier.json")
    assert payload["normalizers"][2]["builtIn"] is False
    assert payload["normalizers"][2]["sourcePath"] == str(
        user_directory / "custom.json"
    )


def test_normalizer_validate_reports_schema_and_registry_conflicts(
    tmp_path: Path,
) -> None:
    app = create_app(environ={"XDG_CONFIG_HOME": str(tmp_path / "config")})
    invalid = tmp_path / "invalid.json"
    invalid.write_text('{"schemaVersion": 2}', encoding="utf-8")
    conflict = tmp_path / "conflict.json"
    conflict.write_text(json.dumps(_home_definition()), encoding="utf-8")

    invalid_result = RUNNER.invoke(
        app, ["normalizer", "validate", str(invalid)]
    )
    conflict_result = RUNNER.invoke(
        app, ["normalizer", "validate", str(conflict)]
    )

    assert invalid_result.exit_code == 2
    assert "invalid normalizer definition" in invalid_result.stderr
    assert conflict_result.exit_code == 2
    assert "duplicate normalizer ID 'home-barrier'" in conflict_result.stderr


def test_normalizer_validate_emits_canonical_definition_metadata(
    tmp_path: Path,
) -> None:
    definition = _home_definition()
    definition["id"] = "candidate"
    path = tmp_path / "candidate.json"
    path.write_text(json.dumps(definition), encoding="utf-8")
    app = create_app(environ={"XDG_CONFIG_HOME": str(tmp_path / "config")})

    result = RUNNER.invoke(app, ["normalizer", "validate", str(path)])

    assert result.exit_code == 0
    assert json.loads(result.stdout) == {
        "schemaVersion": 1,
        "id": "candidate",
        "displayName": "Home VASP Barrier",
        "priority": 100,
        "definitionSha256": json.loads(result.stdout)["definitionSha256"],
        "sourcePath": str(path),
        "valid": True,
    }
    assert len(json.loads(result.stdout)["definitionSha256"]) == 64


def test_normalizer_test_uses_isolated_definition_real_adapter_and_cleans_temp(
    tmp_path: Path,
) -> None:
    home_outcar = _private_home_outcar()
    if home_outcar is None:
        import pytest

        pytest.skip("private home OUTCAR is not available")
    definition_path = tmp_path / "home.json"
    definition_path.write_text(
        json.dumps(_home_definition()), encoding="utf-8"
    )
    app = create_app(environ={"XDG_CONFIG_HOME": str(tmp_path / "empty")})

    result = RUNNER.invoke(
        app,
        ["normalizer", "test", str(definition_path), str(home_outcar)],
    )

    assert result.exit_code == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["summary"]["ionicSteps"] == 35
    assert payload["summary"]["atomCount"] == 25
    assert payload["summary"]["adapter"] == "vaspparser"
    assert payload["manifest"]["normalizerId"] == "home-barrier"
    assert payload["manifest"]["changedLineCount"] == 875
    assert payload["sourceHashVerified"] is True
    assert payload["temporaryCleaned"] is True
    assert payload["manifest"]["sourceSha256"] == hashlib.sha256(
        home_outcar.read_bytes()
    ).hexdigest()


def test_normalizer_test_rejects_a_supplied_fake_standard(
    tmp_path: Path,
) -> None:
    definition = {
        "schemaVersion": 1,
        "id": "standard",
        "displayName": "Fake standard",
        "priority": 10000,
        "detect": {"all": ["NEVER-MATCH"], "any": [], "none": []},
        "rules": [],
    }
    definition_path = tmp_path / "fake-standard.json"
    definition_path.write_text(json.dumps(definition), encoding="utf-8")
    outcar = tmp_path / "OUTCAR"
    outcar.write_bytes(b"ordinary output")

    result = RUNNER.invoke(
        create_app(environ={}),
        ["normalizer", "test", str(definition_path), str(outcar)],
    )

    assert result.exit_code == 2
    assert "reserved packaged normalizer ID 'standard'" in result.stderr


def test_normalizer_test_does_not_reopen_source_path_after_pinning(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    definition = _home_definition()
    definition_path = tmp_path / "home.json"
    definition_path.write_text(json.dumps(definition), encoding="utf-8")
    outcar = _private_home_outcar()
    if outcar is None:
        pytest.skip("private home OUTCAR is not available")
    original_open = Path.open

    def reject_outcar_path_open(self: Path, *args: object, **kwargs: object):
        if self == outcar:
            raise AssertionError("OUTCAR path was reopened outside the pinned session")
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", reject_outcar_path_open)

    result = RUNNER.invoke(
        create_app(environ={}),
        ["normalizer", "test", str(definition_path), str(outcar)],
    )

    assert result.exit_code == 0, result.stderr
    assert json.loads(result.stdout)["sourceHashVerified"] is True


def test_normalizer_test_fails_closed_when_pinned_source_mutates(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    definition = {
        "schemaVersion": 1,
        "id": "mutation-check",
        "displayName": "Mutation check",
        "priority": 1,
        "detect": {"all": ["MARKER"], "any": [], "none": []},
        "rules": [],
    }
    definition_path = tmp_path / "candidate.json"
    definition_path.write_text(json.dumps(definition), encoding="utf-8")
    outcar = tmp_path / "OUTCAR"
    outcar.write_bytes(
        b"MARKER\n VRHFIN =H: s1\n ions per type = 1\n"
    )

    def mutate_source(*_args: object) -> object:
        outcar.write_bytes(outcar.read_bytes() + b"changed\n")
        raise ValueError("parser stopped after mutation")

    monkeypatch.setattr(
        normalizer_cli,
        "parse_vaspparser_outcar",
        mutate_source,
    )

    result = RUNNER.invoke(
        create_app(environ={}),
        ["normalizer", "test", str(definition_path), str(outcar)],
    )

    assert result.exit_code == 2
    assert "parser stopped after mutation" in result.stderr
    assert "source content changed" in result.stderr


def test_normalizer_test_fails_closed_when_source_path_is_replaced(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    if os.name == "nt":
        pytest.skip("Windows does not permit replacing an open file")
    definition = {
        "schemaVersion": 1,
        "id": "replacement-check",
        "displayName": "Replacement check",
        "priority": 1,
        "detect": {"all": ["MARKER"], "any": [], "none": []},
        "rules": [],
    }
    definition_path = tmp_path / "candidate.json"
    definition_path.write_text(json.dumps(definition), encoding="utf-8")
    outcar = tmp_path / "OUTCAR"
    outcar.write_bytes(
        b"MARKER\n VRHFIN =H: s1\n ions per type = 1\n"
    )

    def replace_source(*_args: object) -> object:
        replacement = tmp_path / "replacement"
        replacement.write_bytes(outcar.read_bytes())
        os.replace(replacement, outcar)
        raise ValueError("parser stopped after replacement")

    monkeypatch.setattr(
        normalizer_cli,
        "parse_vaspparser_outcar",
        replace_source,
    )

    result = RUNNER.invoke(
        create_app(environ={}),
        ["normalizer", "test", str(definition_path), str(outcar)],
    )

    assert result.exit_code == 2
    assert "parser stopped after replacement" in result.stderr
    assert "source identity changed" in result.stderr
