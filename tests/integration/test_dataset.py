from pathlib import Path

import pytest

from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation import dataset as dataset_module
from vasp_analyzer.calculation.dataset import inspect_source, load_dataset
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import DatasetConsistencyError, ParameterOccurrence
from vasp_analyzer.parsing.adapters.outcar_ase import ParsedTrajectoryStep
from vasp_analyzer.parsing.profiles import CompatibilityProfile

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


def use_scanner_trajectory(monkeypatch: pytest.MonkeyPatch) -> None:
    def recovered_steps(_path: Path, scan):
        return tuple(
            ParsedTrajectoryStep(
                step_id=record.step_id,
                lattice=record.lattice,
                fractional_positions=tuple(
                    tuple(position[index] / record.lattice[index][index] for index in range(3))
                    for position in record.cartesian_positions
                ),
                cartesian_positions=record.cartesian_positions,
                raw_forces=record.raw_forces,
                total_energy=record.energy,
                species=scan.species,
            )
            for record in scan.steps
        )

    monkeypatch.setattr(dataset_module, "iter_outcar_steps", recovered_steps)


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


def test_dataset_reconciles_detailed_scanner_values_by_step_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    use_scanner_trajectory(monkeypatch)
    root = make_calculation(tmp_path / "detail", "detail-complete-two-step.OUTCAR")
    dataset = load_dataset(root)

    assert dataset.schema_version == 2
    assert [term.key for term in dataset.ionic_steps[1].energy_terms] == [
        "ewald",
        "toten",
        "energy_without_entropy",
        "sigma_to_zero",
    ]
    assert dataset.ionic_steps[1].energy_terms[0].raw_label == "Ewald energy TEWEN"
    assert dataset.ionic_steps[1].external_pressure_kb == pytest.approx(4.0)
    assert dataset.ionic_steps[1].pulay_stress_kb == pytest.approx(0.4)
    assert dataset.ionic_steps[1].stress_tensor_kb == (
        (2.0, 0.2, 0.4),
        (0.2, 3.0, 0.3),
        (0.4, 0.3, 4.0),
    )
    assert dataset.ionic_steps[1].cell_volume == pytest.approx(180.0)
    assert [parameter.raw_value for parameter in dataset.parameters[:2]] == ["400", "520"]
    assert dataset.parameters[-1].key == "nions"


def test_parameter_merge_deduplicates_only_complete_immutable_identity() -> None:
    first = ParameterOccurrence(
        key="encut", raw_key="ENCUT", raw_value="400", value=400, ordinal=0, line_number=3
    )
    same_key_new_occurrence = first.model_copy(
        update={"raw_value": "520", "value": 520, "ordinal": 1, "line_number": 4}
    )

    merge = getattr(dataset_module, "_merge_parameter_occurrences", None)
    assert callable(merge), "parameter occurrence merge is not implemented"
    merged = merge(
        (first,), (first, same_key_new_occurrence, same_key_new_occurrence)
    )

    assert merged == (first, same_key_new_occurrence)


def test_append_resume_preserves_existing_parameter_occurrences_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    use_scanner_trajectory(monkeypatch)
    root = tmp_path / "calc"
    root.mkdir()
    truncated = (FIXTURES / "outcar" / "detail-truncated-tail.OUTCAR").read_bytes()
    complete = (FIXTURES / "outcar" / "detail-complete-two-step.OUTCAR").read_bytes()
    assert complete.startswith(truncated)
    outcar = root / "OUTCAR"
    outcar.write_bytes(truncated)
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))

    first = session.load()
    outcar.write_bytes(complete)
    refreshed = session.refresh_if_changed()

    assert refreshed.parameters == first.parameters
    assert [item.ordinal for item in refreshed.parameters] == list(range(len(first.parameters)))
    assert refreshed.ionic_steps[1].stress_tensor_kb is not None


def test_provisional_replay_deduplicates_the_same_physical_parameter_occurrence(
    tmp_path: Path,
) -> None:
    root = tmp_path / "provisional"
    root.mkdir()
    fixture = (FIXTURES / "outcar" / "ase-complete-one-step.OUTCAR").read_bytes()
    finish = b" General timing and accounting informations for this job:\n"
    assert fixture.endswith(finish)
    outcar = root / "OUTCAR"
    outcar.write_bytes(fixture[: -len(finish)] + b" INCAR:\n ENCUT = 520\n")
    session = CalculationSession(root, cache=CacheStore(tmp_path / "provisional-cache"))

    first = session.load()
    with outcar.open("ab") as stream:
        stream.write(finish)
    refreshed = session.refresh_if_changed()

    assert len(first.parameters) == len(refreshed.parameters) == 1
    assert refreshed.parameters[0] == first.parameters[0]
    assert refreshed.parameters[0].ordinal == 0


def test_stable_append_assigns_monotonic_order_to_legitimate_repeated_parameters(
    tmp_path: Path,
) -> None:
    root = tmp_path / "stable"
    root.mkdir()
    fixture = (FIXTURES / "outcar" / "ase-complete-one-step.OUTCAR").read_bytes()
    fixture = fixture.replace(
        b" vasp.6.5.0 synthetic ASE fixture\n",
        b" vasp.6.5.0 synthetic ASE fixture\n INCAR:\n ENCUT = 400\n\n",
    )
    outcar = root / "OUTCAR"
    outcar.write_bytes(fixture)
    session = CalculationSession(root, cache=CacheStore(tmp_path / "stable-cache"))

    first = session.load()
    with outcar.open("ab") as stream:
        stream.write(b" INCAR:\n ENCUT = 400; ENCUT = 400\n")
    refreshed = session.refresh_if_changed()

    assert [item.ordinal for item in first.parameters] == [0, 1, 2]
    assert [item.ordinal for item in refreshed.parameters] == [0, 1, 2, 3, 4]
    assert [item.raw_value for item in refreshed.parameters[-2:]] == ["400", "400"]
    assert refreshed.parameters[-2] != refreshed.parameters[-1]
    assert refreshed.parameters[-2].line_number == refreshed.parameters[-1].line_number


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
    cached_session = CalculationSession(root, cache=cache)
    assert cached_session.load() == first
    assert cached_session.last_evidence.cache_reused is True

    with (root / "OUTCAR").open("ab") as stream:
        stream.write(b" free energy    TOTEN  =       -10.250000 eV\n")
    refreshed = session.refresh_if_changed()

    assert len(refreshed.ionic_steps) == 1
    assert refreshed.ionic_steps[0].index == 0
    assert refreshed.ionic_steps[0].total_energy == -10.25
    assert session.last_evidence.resumed_from == session.last_evidence.previous_verified_offset
    assert session.last_evidence.resumed_from is not None
    assert session.last_evidence.resumed_from > 0


def test_first_session_load_reports_cache_miss(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))

    session.load()

    assert session.last_evidence.cache_reused is False
    assert session.last_evidence.resumed_from is None


def test_disk_cache_round_trips_computed_force_component(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    write_selective_poscar(root / "POSCAR", allowed=True)
    cache = CacheStore(tmp_path / "cache")
    first = CalculationSession(root, cache=cache).load()
    assert first.ionic_steps[0].strongest_free_component is not None

    cached_session = CalculationSession(root, cache=cache)
    cached = cached_session.load()

    assert cached_session.last_evidence.cache_reused is True
    assert cached.ionic_steps[0].strongest_free_component is not None


def test_source_fingerprint_streams_without_path_read_bytes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "large-source"
    path.write_bytes(b"0123456789" * 100_000)

    def reject_read_bytes(self: Path) -> bytes:
        raise AssertionError(f"read_bytes copied source: {self.name}")

    monkeypatch.setattr(Path, "read_bytes", reject_read_bytes)

    source = inspect_source(path)

    assert source.size == 1_000_000
    assert len(source.fingerprint) == 64


def test_session_dialect_detection_uses_only_a_bounded_head_read(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = make_calculation(tmp_path / "calc")

    def reject_read_bytes(self: Path) -> bytes:
        raise AssertionError(f"read_bytes copied source: {self.name}")

    monkeypatch.setattr(Path, "read_bytes", reject_read_bytes)

    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    dataset = session.load()

    assert dataset.provenance is not None
    assert dataset.provenance.dialect == "standard"
    assert len(dataset.ionic_steps) == 1


def test_cache_identity_includes_poscar_changes(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    write_poscar(root / "POSCAR")
    cache = CacheStore(tmp_path / "cache")
    CalculationSession(root, cache=cache).load()
    write_poscar(root / "POSCAR", ("O", "H"))

    with pytest.raises(DatasetConsistencyError, match=r"POSCAR.*OUTCAR"):
        CalculationSession(root, cache=cache).load()


def test_optional_file_is_never_read_or_part_of_core_cache_identity(monkeypatch, tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    (root / "CHGCAR").write_text("optional one", encoding="utf-8")
    original_open = Path.open

    def guarded_open(self: Path, mode="r", *args, **kwargs):
        if self.name == "CHGCAR" and "r" in mode:
            raise AssertionError("disabled optional capability read CHGCAR")
        return original_open(self, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    cache = CacheStore(tmp_path / "cache")
    loaded = CalculationSession(root, cache=cache).load()
    assert loaded.ionic_steps
    assert {Path(source.path).name for source in loaded.source_files} == {"OUTCAR"}
    (root / "CHGCAR").write_text("optional two", encoding="utf-8")
    reused = CalculationSession(root, cache=cache)
    reused.load()
    assert reused.last_evidence.cache_reused is True


def test_same_profile_id_with_changed_rules_misses_cache(tmp_path: Path) -> None:
    root = make_calculation(tmp_path / "calc")
    cache = CacheStore(tmp_path / "cache")
    first = CompatibilityProfile(schema_version=1, id="custom", display_name="Custom")
    changed = CompatibilityProfile(
        schema_version=1,
        id="custom",
        display_name="Custom",
        detection={"outcar_contains": ("vasp.6",), "priority": 1},
    )
    CalculationSession(root, profile=first, cache=cache).load()
    second = CalculationSession(root, profile=changed, cache=cache)
    second.load()
    assert second.last_evidence.cache_reused is False


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
