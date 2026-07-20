from pathlib import Path

import pytest

from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.dataset import load_dataset
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import DatasetConsistencyError

FIXTURES = Path(__file__).parents[1] / "fixtures"


def write_poscar(path: Path, species: tuple[str, str] = ("H", "H")) -> None:
    names = " ".join(species)
    path.write_text(
        f"fixture\n1\n3 0 0\n0 3 0\n0 0 3\n{names}\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n",
        encoding="utf-8",
    )


def write_selective_poscar(path: Path, allowed: bool) -> None:
    first = "T T F" if allowed else "F F F"
    second = "T T T" if allowed else "F F F"
    path.write_text(
        "fixture\n1\n3 0 0\n0 3 0\n0 0 3\nH\n2\nSelective dynamics\nDirect\n"
        f"0 0 0 {first}\n0.5 0.5 0.5 {second}\n",
        encoding="utf-8",
    )


def make_calculation(tmp_path: Path, outcar_name: str = "ase-complete-one-step.OUTCAR") -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "OUTCAR").write_bytes((FIXTURES / "outcar" / outcar_name).read_bytes())
    return tmp_path


def test_species_mismatch_names_both_sources(tmp_path: Path) -> None:
    root = make_calculation(tmp_path)
    write_poscar(root / "POSCAR", ("O", "H"))

    with pytest.raises(DatasetConsistencyError, match=r"POSCAR.*OUTCAR"):
        load_dataset(root)


def test_dataset_is_immutable_and_preserves_provenance_capabilities(tmp_path: Path) -> None:
    root = make_calculation(tmp_path)
    write_poscar(root / "POSCAR")

    dataset = load_dataset(root)

    assert dataset.sites[0].element == "H"
    assert dataset.ionic_steps[0].index == 0
    assert dataset.provenance is not None
    assert {cap.name: cap.available for cap in dataset.capabilities} == {
        "structure": True, "convergence": True, "dos": False, "band": False, "charge": False
    }
    assert "DOSCAR" in next(cap.reason for cap in dataset.capabilities if cap.name == "dos")
    with pytest.raises(Exception):
        dataset.root = "changed"


def test_outcar_only_dataset_constructs_unknown_constraint_sites(tmp_path: Path) -> None:
    root = make_calculation(tmp_path)

    dataset = load_dataset(root)

    assert tuple(site.element for site in dataset.sites) == ("H", "H")
    assert dataset.sites[0].selective_dynamics.as_tuple() == (None, None, None)
    assert dataset.ionic_steps[0].free_forces is None


def test_session_cache_reuse_and_refresh_upserts_provisional_step(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc", "trailing-no-energy.OUTCAR")
    cache = CacheStore(tmp_path / "cache")
    session = CalculationSession(root, cache=cache)
    first = session.load()
    assert first.ionic_steps[0].total_energy is None
    assert CalculationSession(root, cache=cache).load() == first

    with (root / "OUTCAR").open("ab") as stream:
        stream.write(b" free energy    TOTEN  =       -10.250000 eV\n")
    refreshed = session.refresh_if_changed()

    assert len(refreshed.ionic_steps) == 1
    assert refreshed.ionic_steps[0].index == 0
    assert refreshed.ionic_steps[0].total_energy == -10.25


def test_cache_identity_includes_poscar_changes(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    write_poscar(root / "POSCAR")
    cache = CacheStore(tmp_path / "cache")
    CalculationSession(root, cache=cache).load()
    write_poscar(root / "POSCAR", ("O", "H"))

    with pytest.raises(DatasetConsistencyError, match=r"POSCAR.*OUTCAR"):
        CalculationSession(root, cache=cache).load()


def test_refresh_rebuilds_after_checkpoint_rejection(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    assert len(session.load().ionic_steps) == 1
    (root / "OUTCAR").write_bytes(
        b" vasp.6.5.0 replacement\n VRHFIN =H: s1\n ions per type = 2\n NIONS = 2 ions\n"
    )

    with pytest.raises(DatasetConsistencyError, match="no structure records"):
        session.refresh_if_changed()


def test_poscar_mask_change_recomputes_retained_force_metrics(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    write_selective_poscar(root / "POSCAR", allowed=True)
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    assert session.load().ionic_steps[0].strongest_free_component is not None
    write_selective_poscar(root / "POSCAR", allowed=False)

    refreshed = session.refresh_if_changed()

    assert refreshed.ionic_steps[0].free_forces == ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    assert refreshed.ionic_steps[0].strongest_free_component is None
    assert refreshed.ionic_steps[0].rms_free_force is None
