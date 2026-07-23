from __future__ import annotations

from pathlib import Path

import pytest

from vasp_analyzer.calculation import dataset as dataset_module
from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.dataset import load_dataset
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import DatasetConsistencyError, OutcarFormatError
from vasp_analyzer.parsing.adapters.vaspparser_outcar import ParsedTrajectory


def _write_outcar(path: Path, suffix: bytes = b"") -> None:
    path.write_bytes(
        b"vasp.6.5.0 integration fixture\n"
        b"VRHFIN =H: s1\n"
        b"ions per type = 2\n"
        + suffix
    )


def _write_poscar(path: Path, species: tuple[str, str] = ("H", "H")) -> None:
    path.write_text(
        "fixture\n1\n3 0 0\n0 3 0\n0 0 3\n"
        f"{' '.join(species)}\n1 1\nSelective dynamics\nDirect\n"
        "0 0 0 T F T\n0.5 0.5 0.5 F F F\n",
        encoding="utf-8",
    )


def _trajectory(sites, provenance, energy: float = -10.0) -> ParsedTrajectory:
    return ParsedTrajectory(
        step_indices=(0,),
        sites=sites,
        provenance=provenance,
        energies=(energy,),
        energy_components=(tuple((float(index),) for index in range(11)),),
        positions=(((0.0, 0.0, 0.0), (1.5, 1.5, 1.5)),),
        fractional_positions=(((0.0, 0.0, 0.0), (0.5, 0.5, 0.5)),),
        forces=(((1.0, 2.0, 3.0), (4.0, 5.0, 6.0)),),
        cells=(((3.0, 0.0, 0.0), (0.0, 3.0, 0.0), (0.0, 0.0, 3.0)),),
        stresses=(((0.001, 0.0, 0.0), (0.0, 0.002, 0.0), (0.0, 0.0, 0.003)),),
        pressures=((0.001, 0.002, 0.003),),
        scf_energies=((-9.0, -10.0),),
        fermi_level=None,
        fermi_levels=None,
        vbm=None,
        cbm=None,
    )


@pytest.fixture(autouse=True)
def authoritative_adapter(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        lambda _path, sites, provenance: _trajectory(sites, provenance),
    )


def _calculation(tmp_path: Path, *, poscar: bool = False) -> Path:
    tmp_path.mkdir()
    _write_outcar(tmp_path / "OUTCAR")
    if poscar:
        _write_poscar(tmp_path / "POSCAR")
    return tmp_path


@pytest.mark.parametrize("filename", ["outcar", "OutCar"])
def test_selected_outcar_preserves_case_insensitive_real_path(
    tmp_path: Path, filename: str
) -> None:
    selected = tmp_path / filename
    _write_outcar(selected)

    dataset = load_dataset(selected)

    assert Path(dataset.source_files[0].path).name == filename
    assert dataset.provenance is not None
    assert dataset.provenance.adapter == "vaspparser"


def test_poscar_species_order_is_reconciled_with_outcar(tmp_path: Path) -> None:
    root = _calculation(tmp_path / "calc")
    _write_poscar(root / "POSCAR", ("O", "H"))

    with pytest.raises(DatasetConsistencyError, match=r"POSCAR.*OUTCAR"):
        load_dataset(root)


def test_dataset_preserves_selective_dynamics_energy_pressure_and_volume(
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path / "calc", poscar=True)

    dataset = load_dataset(root)
    step = dataset.ionic_steps[0]

    assert dataset.schema_version == 4
    assert dataset.sites[0].selective_dynamics.as_tuple() == (True, False, True)
    assert dataset.sites[1].selective_dynamics.as_tuple() == (False, False, False)
    assert len(step.energy_terms) == 11
    assert step.external_pressure_kb == pytest.approx(
        0.002 * dataset_module._EV_PER_ANGSTROM3_TO_KB
    )
    assert step.stress_tensor_kb is not None
    assert step.cell_volume == pytest.approx(27.0)
    assert step.scf_iterations == 2


def test_dataset_preserves_pulay_stress_and_parameter_occurrence_order(
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path / "calc", poscar=True)
    _write_outcar(
        root / "OUTCAR",
        b"Startparameter for this Run:\n"
        b"ENCUT = 400\n"
        b"ENCUT = 520\n"
        b"HOME_EFFECTIVE = alpha-beta\n"
        b"------------------------------\n"
        b"external pressure = -5.0 kB Pullay stress = 0.75 kB\n",
    )

    dataset = load_dataset(root)

    assert [item.raw_key for item in dataset.parameters] == [
        "ENCUT",
        "ENCUT",
        "HOME_EFFECTIVE",
    ]
    assert [item.ordinal for item in dataset.parameters] == [0, 1, 2]
    assert dataset.parameters[0].category == "electronic"
    assert dataset.parameters[2].value == "alpha-beta"
    assert dataset.ionic_steps[0].pulay_stress_kb == pytest.approx(0.75)


def test_parameter_append_replays_full_file_without_duplicate_occurrences(
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path / "calc")
    _write_outcar(
        root / "OUTCAR",
        b"Startparameter for this Run:\nENCUT = 400\n------------------------------\n",
    )
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    first = session.load()
    with (root / "OUTCAR").open("ab") as stream:
        stream.write(
            b"Startparameter for this Run:\nENCUT = 400; ENCUT = 400\n"
            b"------------------------------\n"
        )

    refreshed = session.refresh_if_changed()

    assert [item.raw_value for item in first.parameters] == ["400"]
    assert [item.raw_value for item in refreshed.parameters] == ["400", "400", "400"]
    assert [item.ordinal for item in refreshed.parameters] == [0, 1, 2]
    assert refreshed.parameters[1].line_number == refreshed.parameters[2].line_number


def test_malformed_metadata_is_isolated_with_warning(
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path / "calc")
    _write_outcar(
        root / "OUTCAR",
        b"Startparameter for this Run:\n"
        b"ENCUT = ;\n"
        b"NSW = 10\n"
        b"------------------------------\n"
        b"external pressure = nope kB Pullay stress = 1.0 kB\n",
    )

    dataset = load_dataset(root)

    assert [item.raw_key for item in dataset.parameters] == ["NSW"]
    assert [warning.category for warning in dataset.warnings] == [
        "MetadataParseFailure",
        "MetadataParseFailure",
    ]


def test_missing_pressure_detail_does_not_shift_pulay_to_wrong_step(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc")
    _write_outcar(
        root / "OUTCAR",
        b"external pressure = -4.0 kB Pullay stress = 0.4 kB\n",
    )
    def two_steps(_path, sites, provenance):
        one = _trajectory(sites, provenance)
        return one.model_copy(
            update={
                "step_indices": (0, 1),
                "energies": (-10.0, -11.0),
                "energy_components": one.energy_components * 2,
                "positions": one.positions * 2,
                "fractional_positions": one.fractional_positions * 2,
                "forces": one.forces * 2,
                "cells": one.cells * 2,
                "stresses": one.stresses * 2,
                "pressures": one.pressures * 2,
                "scf_energies": one.scf_energies * 2,
            }
        )

    monkeypatch.setattr(
        dataset_module,
        "parse_vaspparser_outcar",
        two_steps,
    )

    dataset = load_dataset(root)

    assert [step.pulay_stress_kb for step in dataset.ionic_steps] == [None, None]
    assert len(dataset.warnings) == 1
    assert dataset.warnings[0].category == "MetadataParseFailure"
    assert "1 pressure records for 2 ionic steps" in dataset.warnings[0].message


def test_outcar_only_sites_take_first_parsed_frame(tmp_path: Path) -> None:
    dataset = load_dataset(_calculation(tmp_path / "calc"))

    assert dataset.initial_structure is None
    assert dataset.sites[1].initial_fractional_position == (0.5, 0.5, 0.5)
    assert dataset.sites[1].selective_dynamics.as_tuple() == (None, None, None)


def test_poscar_provides_initial_structure(tmp_path: Path) -> None:
    dataset = load_dataset(_calculation(tmp_path / "calc", poscar=True))

    assert dataset.initial_structure is not None
    assert dataset.initial_structure.source == "POSCAR"
    assert dataset.initial_structure.cartesian_positions[1] == (1.5, 1.5, 1.5)


def test_session_cache_reuses_exact_authoritative_snapshot(tmp_path: Path) -> None:
    root = _calculation(tmp_path / "calc", poscar=True)
    cache = CacheStore(tmp_path / "cache")
    first = CalculationSession(root, cache=cache)
    loaded = first.load()
    second = CalculationSession(root, cache=cache)

    assert second.load() == loaded
    assert second.last_evidence.cache_reused is True


def test_cache_identity_includes_poscar_changes(tmp_path: Path) -> None:
    root = _calculation(tmp_path / "calc", poscar=True)
    cache = CacheStore(tmp_path / "cache")
    CalculationSession(root, cache=cache).load()
    _write_poscar(root / "POSCAR", ("O", "H"))

    with pytest.raises(DatasetConsistencyError, match=r"POSCAR.*OUTCAR"):
        CalculationSession(root, cache=cache).load()


def test_changed_parse_failure_retains_last_success_and_recovers(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = _calculation(tmp_path / "calc", poscar=True)
    calls = 0

    def parse(_path, sites, provenance):
        nonlocal calls
        calls += 1
        content = (root / "OUTCAR").read_bytes()
        if b"incomplete" in content:
            raise OutcarFormatError("incomplete tail")
        return _trajectory(sites, provenance, energy=-10.0 - calls)

    monkeypatch.setattr(dataset_module, "parse_vaspparser_outcar", parse)
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    first = session.load()
    _write_outcar(root / "OUTCAR", b"incomplete\n")

    retained = session.refresh_if_changed()
    assert session.refresh_if_changed() == retained
    assert retained.ionic_steps == first.ionic_steps
    assert retained.warnings[-1].category == "GrowingFileParseFailure"
    assert calls == 2

    _write_outcar(root / "OUTCAR", b"complete again\n")
    assert session.refresh_if_changed().ionic_steps != first.ionic_steps
    assert calls == 3


def test_optional_capability_file_does_not_change_core_cache_identity(
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path / "calc")
    (root / "CHGCAR").write_text("first", encoding="utf-8")
    cache = CacheStore(tmp_path / "cache")
    CalculationSession(root, cache=cache).load()
    (root / "CHGCAR").write_text("second", encoding="utf-8")
    reused = CalculationSession(root, cache=cache)

    reused.load()

    assert reused.last_evidence.cache_reused is True
