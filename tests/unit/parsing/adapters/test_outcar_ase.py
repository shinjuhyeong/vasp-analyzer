from __future__ import annotations

import gc
import weakref
from collections import deque
from pathlib import Path

import numpy as np
import pytest
from ase.io import ParseError

from vasp_analyzer.core import DatasetConsistencyError
from vasp_analyzer.parsing.adapters import outcar_ase
from vasp_analyzer.parsing.adapters.outcar_ase import iter_outcar_steps
from vasp_analyzer.parsing.dialects import HOME_BARRIER
from vasp_analyzer.parsing.dialects.registry import profile_dialect
from vasp_analyzer.parsing.profiles import load_profile
from vasp_analyzer.parsing.recovery import ScanResult, scan_outcar


FIXTURES = Path(__file__).parents[3] / "fixtures" / "outcar"
PREFIX = (FIXTURES / "appended-prefix.OUTCAR").read_bytes()
SUFFIX = b""" direct lattice vectors                 reciprocal lattice vectors
   3.010000 0.000000 0.000000  0.332226 0.000000 0.000000
   0.000000 3.010000 0.000000  0.000000 0.332226 0.000000
   0.000000 0.000000 3.010000  0.000000 0.000000 0.332226
 POSITION                                       TOTAL-FORCE (eV/Angst)
 -----------------------------------------------------------------------------------
   0.010000 0.000000 0.000000  0.050000 0.000000 0.000000
   1.490000 1.500000 1.500000 -0.050000 0.000000 0.000000
 free energy    TOTEN  =       -10.100000 eV
"""


class FakeCell:
    def __init__(self, rows: list[list[float]]) -> None:
        self.array = np.asarray(rows, dtype=float)


class FakeAtoms:
    def __init__(
        self,
        *,
        cell: list[list[float]],
        positions: list[list[float]],
        scaled_positions: list[list[float]],
        forces: list[list[float]],
        energy: float,
        extrapolated_energy: float | None = None,
        species: tuple[str, ...] = ("H", "H"),
    ) -> None:
        self.cell = FakeCell(cell)
        self.positions = np.asarray(positions, dtype=float)
        self._scaled_positions = np.asarray(scaled_positions, dtype=float)
        self._forces = np.asarray(forces, dtype=float)
        self._energy = energy
        self._extrapolated_energy = (
            energy if extrapolated_energy is None else extrapolated_energy
        )
        self._species = species

    def get_chemical_symbols(self) -> list[str]:
        return list(self._species)

    def get_scaled_positions(self, *, wrap: bool) -> np.ndarray:
        assert wrap is False
        return self._scaled_positions

    def get_forces(self, *, apply_constraint: bool) -> np.ndarray:
        assert apply_constraint is False
        return self._forces

    def get_potential_energy(
        self, *, force_consistent: bool = False, apply_constraint: bool
    ) -> float:
        assert apply_constraint is False
        return self._energy if force_consistent else self._extrapolated_energy


class PoppingFrames:
    def __init__(self, frames: list[FakeAtoms]) -> None:
        self.frames = deque(frames)

    def __iter__(self) -> PoppingFrames:
        return self

    def __next__(self) -> FakeAtoms:
        if not self.frames:
            raise StopIteration
        return self.frames.popleft()


def make_two_ase_atoms() -> list[FakeAtoms]:
    return [
        FakeAtoms(
            cell=[[4.0, 0.0, 0.0], [0.0, 4.0, 0.0], [0.0, 0.0, 4.0]],
            positions=[[0.2, 0.0, 0.0], [2.0, 2.0, 2.0]],
            scaled_positions=[[0.05, 0.0, 0.0], [0.5, 0.5, 0.5]],
            forces=[[0.2, 0.0, 0.0], [-0.2, 0.0, 0.0]],
            energy=-10.0,
            extrapolated_energy=-9.8,
        ),
        FakeAtoms(
            cell=[[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
            positions=[[0.5, 0.0, 0.0], [2.5, 2.5, 2.5]],
            scaled_positions=[[0.1, 0.0, 0.0], [0.5, 0.5, 0.5]],
            forces=[[0.3, 0.0, 0.0], [-0.3, 0.0, 0.0]],
            energy=-10.1,
            extrapolated_energy=-9.9,
        ),
    ]


def make_checkpoint_resumed_scan(tmp_path: Path) -> tuple[Path, ScanResult]:
    path = tmp_path / "OUTCAR"
    initial = PREFIX + b" General timing and accounting informations for this job:\n"
    path.write_bytes(initial)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(initial + SUFFIX)
    resumed = scan_outcar(path, HOME_BARRIER, first.checkpoint)
    assert [record.step_id for record in resumed.steps] == [1]
    return path, resumed


def test_ase_steps_use_scanner_ids_but_ase_numerical_data_and_release_atoms(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    atoms = make_two_ase_atoms()
    references = [weakref.ref(frame) for frame in atoms]
    frame_iterator = iter(atoms)
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: frame_iterator)

    steps = tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", scan))
    del atoms
    gc.collect()

    assert [step.step_id for step in steps] == [record.step_id for record in scan.steps]
    assert steps[1].lattice[0] == (5.0, 0.0, 0.0)
    assert steps[1].cartesian_positions[0] == (0.5, 0.0, 0.0)
    assert steps[1].fractional_positions[0] == (0.1, 0.0, 0.0)
    assert steps[1].raw_forces[0] == (0.3, 0.0, 0.0)
    assert steps[1].total_energy == scan.steps[1].energy == -10.1
    assert all(reference() is None for reference in references)


def test_ase_species_are_copied_to_immutable_step(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(make_two_ase_atoms()))

    steps = tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", scan))

    assert steps[0].species == ("H", "H")


def test_ase_species_must_match_scanner_species_when_known(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER).model_copy(
        update={"species": ("H", "O")}
    )
    frames = make_two_ase_atoms()
    frames[0]._species = ("O", "H")
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(frames))

    with pytest.raises(DatasetConsistencyError, match="scanner.*ASE.*species"):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", scan))


def test_iread_is_called_with_streaming_outcar_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "complete-two-step.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)
    calls: list[tuple[Path, str, str]] = []

    def fake_iread(actual_path: Path, *, format: str, index: str):
        calls.append((actual_path, format, index))
        return iter(make_two_ase_atoms())

    monkeypatch.setattr(outcar_ase, "iread", fake_iread)

    tuple(iter_outcar_steps(path, scan))

    assert calls == [(path, "vasp-out", ":")]


def test_each_ase_atoms_is_released_before_its_converted_step_is_yielded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    atoms = make_two_ase_atoms()
    references = [weakref.ref(frame) for frame in atoms]
    frames = PoppingFrames(atoms)
    del atoms
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: frames)

    trajectory = iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", scan)
    first = next(trajectory)
    gc.collect()

    assert first.step_id == 0
    assert references[0]() is None
    assert references[1]() is not None

    second = next(trajectory)
    gc.collect()

    assert second.step_id == 1
    assert references[1]() is None
    with pytest.raises(StopIteration):
        next(trajectory)


@pytest.mark.parametrize("frame_count", [0, 1, 3])
def test_ase_frame_count_must_match_scanner_records(
    monkeypatch: pytest.MonkeyPatch, frame_count: int
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frames = make_two_ase_atoms()
    if frame_count == 3:
        frames.append(make_two_ase_atoms()[0])
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(frames[:frame_count]))

    with pytest.raises(
        DatasetConsistencyError,
        match=rf"ASE returned .* frames for {len(scan.steps)} indexed steps",
    ):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", scan))


def test_checkpoint_resumed_scan_selects_the_matching_physical_ase_frame(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path, resumed = make_checkpoint_resumed_scan(tmp_path)
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(make_two_ase_atoms()))

    (step,) = tuple(iter_outcar_steps(path, resumed))

    assert step.step_id == 1
    assert step.lattice[0] == (5.0, 0.0, 0.0)
    assert step.cartesian_positions[0] == (0.5, 0.0, 0.0)
    assert step.total_energy == resumed.steps[0].energy == -10.1


def test_unchanged_checkpoint_resume_with_no_records_does_not_read_ase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "complete-two-step.OUTCAR"
    first = scan_outcar(path, HOME_BARRIER)
    unchanged = scan_outcar(path, HOME_BARRIER, first.checkpoint)
    assert unchanged.steps == ()

    def unexpected_iread(*args, **kwargs):
        raise AssertionError("ASE must not be read for an empty resumed scan")

    monkeypatch.setattr(outcar_ase, "iread", unexpected_iread)

    assert tuple(iter_outcar_steps(path, unchanged)) == ()


@pytest.mark.parametrize("frame_count", [1, 3])
def test_checkpoint_resumed_scan_retains_strict_underflow_and_overflow(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, frame_count: int
) -> None:
    path, resumed = make_checkpoint_resumed_scan(tmp_path)
    frames = make_two_ase_atoms()
    if frame_count == 3:
        frames.append(make_two_ase_atoms()[0])
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(frames[:frame_count]))

    with pytest.raises(DatasetConsistencyError, match="ASE returned"):
        tuple(iter_outcar_steps(path, resumed))


@pytest.mark.parametrize("step_ids", [(1, 0), (0, 2)])
def test_scanner_step_ids_must_be_ordered_and_contiguous(
    monkeypatch: pytest.MonkeyPatch, step_ids: tuple[int, int]
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    invalid = scan.model_copy(
        update={
            "steps": tuple(
                record.model_copy(update={"step_id": step_id})
                for record, step_id in zip(scan.steps, step_ids, strict=True)
            )
        }
    )
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(make_two_ase_atoms()))

    with pytest.raises(DatasetConsistencyError, match="ordered and contiguous"):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", invalid))


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("cell", [[float("nan"), 0.0, 0.0], [0.0, 4.0, 0.0], [0.0, 0.0, 4.0]]),
        ("positions", [[float("inf"), 0.0, 0.0], [2.0, 2.0, 2.0]]),
        ("scaled_positions", [[float("nan"), 0.0, 0.0], [0.5, 0.5, 0.5]]),
        ("forces", [[float("inf"), 0.0, 0.0], [-0.2, 0.0, 0.0]]),
        ("energy", float("nan")),
    ],
)
def test_nonfinite_ase_values_are_rejected(
    monkeypatch: pytest.MonkeyPatch, field: str, bad_value: object
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frame = make_two_ase_atoms()[0]
    if field == "cell":
        frame.cell = FakeCell(bad_value)  # type: ignore[arg-type]
    elif field == "positions":
        frame.positions = np.asarray(bad_value)
    elif field == "scaled_positions":
        frame._scaled_positions = np.asarray(bad_value)
    elif field == "forces":
        frame._forces = np.asarray(bad_value)
    else:
        frame._energy = float(bad_value)  # type: ignore[arg-type]
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([frame]))
    one_step_scan = scan.model_copy(update={"steps": scan.steps[:1]})

    with pytest.raises(DatasetConsistencyError, match="non-finite"):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", one_step_scan))


def test_singular_ase_cell_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frame = make_two_ase_atoms()[0]
    frame.cell = FakeCell([[1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([frame]))
    one_step_scan = scan.model_copy(update={"steps": scan.steps[:1]})

    with pytest.raises(DatasetConsistencyError, match="singular lattice"):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", one_step_scan))


def test_large_exactly_dependent_ase_cell_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frame = make_two_ase_atoms()[0]
    frame.cell = FakeCell(
        [
            [-860915.0, -787161.0, 363069.0],
            [-524132.0, -1304472.0, -129142.0],
            [336783.0, -517311.0, -492211.0],
        ]
    )
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([frame]))
    one_step_scan = scan.model_copy(update={"steps": scan.steps[:1]})

    with pytest.raises(DatasetConsistencyError, match="singular lattice"):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", one_step_scan))


def test_total_energy_requests_force_consistent_outcar_toten(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frame = make_two_ase_atoms()[0]
    assert frame._energy == scan.steps[0].energy
    assert frame._extrapolated_energy != scan.steps[0].energy
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([frame]))
    one_step_scan = scan.model_copy(update={"steps": scan.steps[:1]})

    (step,) = tuple(
        iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", one_step_scan)
    )

    assert step.total_energy == scan.steps[0].energy == -10.0


def test_ase_atom_count_must_match_scanner_record(monkeypatch: pytest.MonkeyPatch) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frame = make_two_ase_atoms()[0]
    frame.positions = frame.positions[:1]
    frame._scaled_positions = frame._scaled_positions[:1]
    frame._forces = frame._forces[:1]
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([frame]))
    one_step_scan = scan.model_copy(update={"steps": scan.steps[:1]})

    with pytest.raises(
        DatasetConsistencyError,
        match=r"expected 2 atoms; got fractional=1, Cartesian=1, forces=1",
    ):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", one_step_scan))


def test_mismatched_ase_fields_report_each_atom_count(monkeypatch: pytest.MonkeyPatch) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    frame = make_two_ase_atoms()[0]
    frame._forces = frame._forces[:1]
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([frame]))
    one_step_scan = scan.model_copy(update={"steps": scan.steps[:1]})

    with pytest.raises(
        DatasetConsistencyError,
        match=r"expected 2 atoms; got fractional=2, Cartesian=2, forces=1",
    ):
        tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", one_step_scan))


def test_only_final_energyless_replay_provisional_record_may_fall_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "trailing-no-energy.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)
    assert scan.checkpoint.replay_provisional is True
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(()))

    (step,) = tuple(iter_outcar_steps(path, scan))

    assert step.step_id == scan.steps[0].step_id
    assert step.lattice == scan.steps[0].lattice
    assert step.cartesian_positions == scan.steps[0].cartesian_positions
    assert step.raw_forces == scan.steps[0].raw_forces
    assert step.fractional_positions == ((0.0, 0.0, 0.0), (0.5, 0.5, 0.5))
    assert step.total_energy is None


def test_final_recovered_step_uses_scanner_species(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "trailing-no-energy.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER).model_copy(update={"species": ("H", "H")})
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(()))

    (step,) = tuple(iter_outcar_steps(path, scan))

    assert step.species == ("H", "H")


def test_final_replayed_energy_record_can_fallback_and_keeps_energy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "OUTCAR"
    initial = (FIXTURES / "trailing-no-energy.OUTCAR").read_bytes()
    path.write_bytes(initial)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(initial + b" free energy    TOTEN  =       -10.250000 eV\n")
    replayed = scan_outcar(path, HOME_BARRIER, first.checkpoint)
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(()))

    (step,) = tuple(iter_outcar_steps(path, replayed))

    assert step.step_id == 0
    assert step.total_energy == -10.25


def test_incomplete_ase_parse_error_uses_the_same_final_provisional_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "trailing-no-energy.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)

    def incomplete_frames():
        raise ParseError("Incomplete OUTCAR")
        yield

    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: incomplete_frames())

    (step,) = tuple(iter_outcar_steps(path, scan))

    assert step.cartesian_positions == scan.steps[-1].cartesian_positions
    assert step.total_energy is None


def test_ase_parse_error_outside_recoverable_tail_is_a_consistency_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "complete-two-step.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)

    def malformed_frames():
        raise ParseError("broken frame")
        yield

    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: malformed_frames())

    with pytest.raises(DatasetConsistencyError, match="ASE failed while reading indexed step 0"):
        tuple(iter_outcar_steps(path, scan))


def test_unrelated_ase_parse_error_cannot_use_provisional_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "trailing-no-energy.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)

    def malformed_frames():
        raise ParseError("malformed ionic data")
        yield

    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: malformed_frames())

    with pytest.raises(DatasetConsistencyError, match="ASE failed while reading indexed step 0"):
        tuple(iter_outcar_steps(path, scan))


def test_ase_parse_error_after_expected_frames_is_a_consistency_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "complete-two-step.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)

    def frames_then_error():
        yield from make_two_ase_atoms()
        raise ParseError("broken trailing frame")

    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: frames_then_error())

    with pytest.raises(DatasetConsistencyError, match="ASE failed after 2 indexed steps"):
        tuple(iter_outcar_steps(path, scan))


def test_energyless_nonprovisional_record_cannot_fall_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = FIXTURES / "trailing-no-energy.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)
    nonprovisional = scan.model_copy(
        update={
            "checkpoint": scan.checkpoint.model_copy(update={"replay_provisional": False})
        }
    )
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(()))

    with pytest.raises(DatasetConsistencyError, match="ASE returned 0 frames for 1 indexed steps"):
        tuple(iter_outcar_steps(path, nonprovisional))


def test_fallback_never_reuses_previous_ase_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    complete = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    provisional = scan_outcar(FIXTURES / "trailing-no-energy.OUTCAR", HOME_BARRIER)
    combined = complete.model_copy(
        update={
            "steps": (complete.steps[0], provisional.steps[0].model_copy(update={"step_id": 1})),
            "checkpoint": provisional.checkpoint,
        }
    )
    first_ase_frame = make_two_ase_atoms()[0]
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter([first_ase_frame]))

    first, recovered = tuple(
        iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", combined)
    )

    assert first.lattice[0] == (4.0, 0.0, 0.0)
    assert recovered.lattice[0] == (3.0, 0.0, 0.0)
    assert recovered.raw_forces != first.raw_forces
    assert recovered.total_energy is None


def test_sanitized_complete_fixture_is_read_by_real_ase_329() -> None:
    path = FIXTURES / "ase-complete-one-step.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)

    (step,) = tuple(iter_outcar_steps(path, scan))

    assert step.step_id == scan.steps[0].step_id == 0
    assert step.lattice == scan.steps[0].lattice
    assert step.cartesian_positions == scan.steps[0].cartesian_positions
    assert step.raw_forces == scan.steps[0].raw_forces
    assert step.total_energy == scan.steps[0].energy == -10.0


def test_real_ase_normalizes_declared_home_force_prefixes(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    source = (FIXTURES / "ase-complete-one-step.OUTCAR").read_text(encoding="ascii")
    source = source.replace("vasp.6.5.0 synthetic ASE fixture", "vasp.5.4.1-barrier")
    source = source.replace(
        "   0.000000 0.000000 0.000000  0.100000 0.000000 0.000000",
        "H_ 1 0.000000 0.000000 0.000000  0.100000 0.000000 0.000000",
    ).replace(
        "   1.500000 1.500000 1.500000 -0.100000 0.000000 0.000000",
        "H_ 2 1.500000 1.500000 1.500000 -0.100000 0.000000 0.000000",
    )
    path.write_text(source, encoding="ascii")
    (tmp_path / "POSCAR").write_text(
        "fixture\n1\n3 0 0\n0 3 0\n0 0 3\nH\n2\n"
        "Selective dynamics\n   0\nDirect\n"
        "0 0 0 T T T\n0.5 0.5 0.5 T T T\n",
        encoding="ascii",
    )
    scan = scan_outcar(path, HOME_BARRIER)

    (step,) = tuple(iter_outcar_steps(path, scan))

    assert step.cartesian_positions[1] == (1.5, 1.5, 1.5)
    assert step.raw_forces[0] == (0.1, 0.0, 0.0)


def test_custom_profile_force_markers_drive_scanner_and_ase_normalization(
    tmp_path: Path,
) -> None:
    profile_path = tmp_path / "custom.toml"
    profile_path.write_text(
        "schema_version = 1\nid = 'custom'\ndisplay_name = 'Custom'\n"
        "[outcar.markers]\nposition_force = ['atomic coordinates', 'push vectors']\n"
        "[validation]\nforce_prefix_columns = 2\n",
        encoding="utf-8",
    )
    dialect = profile_dialect(load_profile(profile_path))
    path = tmp_path / "OUTCAR"
    source = (FIXTURES / "ase-complete-one-step.OUTCAR").read_text(encoding="ascii")
    source = source.replace(
        "POSITION                                       TOTAL-FORCE (eV/Angst)",
        "AtOmIc CoOrDiNaTeS                              PuSh VeCtOrS",
    ).replace(
        "   0.000000 0.000000 0.000000  0.100000 0.000000 0.000000",
        "H_ 1 0.000000 0.000000 0.000000  0.100000 0.000000 0.000000",
    ).replace(
        "   1.500000 1.500000 1.500000 -0.100000 0.000000 0.000000",
        "H_ 2 1.500000 1.500000 1.500000 -0.100000 0.000000 0.000000",
    )
    path.write_text(source, encoding="ascii")

    scan = scan_outcar(path, dialect)
    (step,) = tuple(iter_outcar_steps(path, scan))

    assert scan.steps[0].raw_forces == step.raw_forces
    assert scan.steps[0].cartesian_positions == step.cartesian_positions


def test_real_ase_incomplete_outcar_parse_error_uses_validated_fallback() -> None:
    path = FIXTURES / "trailing-no-energy.OUTCAR"
    scan = scan_outcar(path, HOME_BARRIER)

    with pytest.raises(ParseError, match="Incomplete OUTCAR"):
        next(iter(outcar_ase.iread(path, format="vasp-out", index=":")))

    (step,) = tuple(iter_outcar_steps(path, scan))

    assert step.cartesian_positions == scan.steps[0].cartesian_positions
    assert step.raw_forces == scan.steps[0].raw_forces
    assert step.total_energy is None
