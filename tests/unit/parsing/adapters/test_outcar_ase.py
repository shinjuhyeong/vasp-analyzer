from __future__ import annotations

import gc
import weakref
from pathlib import Path

import numpy as np
import pytest
from ase.io import ParseError

from vasp_analyzer.core import DatasetConsistencyError
from vasp_analyzer.parsing.adapters import outcar_ase
from vasp_analyzer.parsing.adapters.outcar_ase import iter_outcar_steps
from vasp_analyzer.parsing.dialects import HOME_BARRIER
from vasp_analyzer.parsing.recovery import scan_outcar


FIXTURES = Path(__file__).parents[3] / "fixtures" / "outcar"


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
    ) -> None:
        self.cell = FakeCell(cell)
        self.positions = np.asarray(positions, dtype=float)
        self._scaled_positions = np.asarray(scaled_positions, dtype=float)
        self._forces = np.asarray(forces, dtype=float)
        self._energy = energy

    def get_scaled_positions(self, *, wrap: bool) -> np.ndarray:
        assert wrap is False
        return self._scaled_positions

    def get_forces(self, *, apply_constraint: bool) -> np.ndarray:
        assert apply_constraint is False
        return self._forces

    def get_potential_energy(self, *, apply_constraint: bool) -> float:
        assert apply_constraint is False
        return self._energy


def make_two_ase_atoms() -> list[FakeAtoms]:
    return [
        FakeAtoms(
            cell=[[4.0, 0.0, 0.0], [0.0, 4.0, 0.0], [0.0, 0.0, 4.0]],
            positions=[[0.2, 0.0, 0.0], [2.0, 2.0, 2.0]],
            scaled_positions=[[0.05, 0.0, 0.0], [0.5, 0.5, 0.5]],
            forces=[[0.2, 0.0, 0.0], [-0.2, 0.0, 0.0]],
            energy=-20.0,
        ),
        FakeAtoms(
            cell=[[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
            positions=[[0.5, 0.0, 0.0], [2.5, 2.5, 2.5]],
            scaled_positions=[[0.1, 0.0, 0.0], [0.5, 0.5, 0.5]],
            forces=[[0.3, 0.0, 0.0], [-0.3, 0.0, 0.0]],
            energy=-21.0,
        ),
    ]


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
    assert steps[1].total_energy == -21.0 != scan.steps[1].energy
    assert all(reference() is None for reference in references)


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


def test_nonzero_scanner_step_ids_are_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    resumed = scan.model_copy(
        update={
            "steps": tuple(
                record.model_copy(update={"step_id": record.step_id + 7})
                for record in scan.steps
            )
        }
    )
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(make_two_ase_atoms()))

    steps = tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", resumed))

    assert [step.step_id for step in steps] == [7, 8]


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
