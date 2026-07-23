from __future__ import annotations

import json
import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.audit_outcar import audit_outcar
from vasp_analyzer.calculation import load_dataset

FIXTURES = Path(__file__).parents[1] / "fixtures" / "outcar"
SCRIPT = Path(__file__).parents[2] / "scripts" / "audit_outcar.py"
PRIVATE_AUDIT_ROOT = Path(r"C:\Users\tlswn\Documents\YBCO6.5\audit-input")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_audit_reports_production_parser_normalizer_shapes_and_source_hash(
    tmp_path: Path,
) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes((FIXTURES / "ase-complete-one-step.OUTCAR").read_bytes())

    report = audit_outcar(path)

    assert report["adapter"] == report["parser"] == "vaspparser"
    assert report["steps"] == 1
    assert report["atomCount"] == 2
    assert report["normalizer"]["id"] == "standard"
    assert report["normalizer"]["changedLineCount"] == 0
    assert report["shapes"] == {
        "cell": [1, 3, 3],
        "forces": [1, 2, 3],
        "positions": [1, 2, 3],
        "valid": True,
    }
    assert report["finite"] is True
    assert report["sourceUnchanged"] is True
    assert report["sourceSha256"] == report["sourceSha256After"]


def test_audit_command_exits_nonzero_on_parser_error(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_text("not an OUTCAR\n", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "error" in json.loads(result.stdout)


@pytest.mark.parametrize(
    ("filename", "expected_steps", "expected_atoms", "expected_encut"),
    [
        ("OUTCAR_official", 200, 6, 500.0),
        ("OUTCAR_homever", 35, 25, 600.0),
    ],
)
def test_private_audit_outcars_have_clean_effective_parameter_metadata(
    monkeypatch: pytest.MonkeyPatch,
    filename: str,
    expected_steps: int,
    expected_atoms: int,
    expected_encut: float,
) -> None:
    source = PRIVATE_AUDIT_ROOT / filename
    if not source.is_file():
        pytest.skip(f"private audit input is absent: {source}")
    monkeypatch.setattr(
        "os.link",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("disabled for test")),
    )
    before = _sha256(source)

    report = audit_outcar(source)
    dataset = load_dataset(source)

    assert report["steps"] == expected_steps
    assert report["atomCount"] == expected_atoms
    assert report["sourceUnchanged"] is True
    assert len(dataset.ionic_steps) == expected_steps
    assert len(dataset.sites) == expected_atoms
    effective = {parameter.key: parameter for parameter in dataset.parameters}
    expected = {
        "encut": (expected_encut, "eV"),
        "ispin": (1, None),
        "ibrion": (3 if filename == "OUTCAR_official" else 2, None),
        "nsw": (200 if filename == "OUTCAR_official" else 3000, None),
        "ediff": (1e-6, "eV"),
        "ediffg": (-0.01, "eV/angstrom"),
    }
    for key, (value, unit) in expected.items():
        parameter = effective[key]
        assert parameter.value == value
        assert parameter.unit == unit
        assert not isinstance(parameter.value, str)
    assert "stopping-criterion" in effective["ediff"].raw_value
    assert "stopping-criterion" not in str(effective["ediff"].value)
    assert "Ry" in effective["encut"].raw_value
    assert "Ry" not in str(effective["encut"].value)
    assert all(isinstance(warning, str) for warning in dataset.warnings)
    assert _sha256(source) == before
