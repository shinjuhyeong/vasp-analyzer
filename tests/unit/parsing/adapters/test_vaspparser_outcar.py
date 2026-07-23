from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from vasp_analyzer.core import (
    DatasetConsistencyError,
    ParserProvenance,
    SelectiveMask,
    Site,
)
from vasp_analyzer.parsing.adapters.vaspparser_outcar import parse_vaspparser_outcar


def _sites(count: int = 2) -> tuple[Site, ...]:
    return tuple(
        Site(
            site_index=index,
            element="H",
            initial_fractional_position=(float(index), 0.0, 0.0),
            initial_cartesian_position=(float(index), 0.0, 0.0),
            selective_dynamics=SelectiveMask(a=True, b=True, c=True),
        )
        for index in range(count)
    )


def _provenance() -> ParserProvenance:
    return ParserProvenance(
        adapter="vaspparser",
        adapter_version="0.0.7",
        dialect="standard",
    )


def _parse_dict() -> dict[str, object]:
    return {
        "energies": np.array([-1.0, -2.0]),
        "energy_components": [
            np.array([[1.0, 2.0], [3.0, 4.0]]),
            np.array([[5.0], [6.0]]),
        ],
        "positions": np.array(
            [
                [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
                [[0.1, 0.0, 0.0], [1.1, 0.0, 0.0]],
            ]
        ),
        "forces": np.array(
            [
                [[1.0e-3, 2.0e-3, 3.0e-3], [0.0, 0.0, 0.0]],
                [[4.0e-3, 5.0e-3, 6.0e-3], [0.0, 0.0, 0.0]],
            ]
        ),
        "cells": np.array([np.eye(3), np.eye(3) * 2.0]),
        "stresses": np.array([np.eye(3) * 0.1, np.eye(3) * 0.2]),
        "pressures": np.array([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]),
        "scf_energies": [np.array([-0.8, -1.0]), np.array([-1.7, -2.0])],
        "fermi_level": -0.5,
        "e_fermi_list": np.array([-0.4, -0.5]),
        "vbm_list": np.array([[-1.0, -1.1]]),
        "cbm_list": np.array([[0.2, 0.1]]),
        "steps": np.array([10, 20]),
    }


class _Parser:
    parse_dict: dict[str, object] = {}

    def from_file(self, filename: str) -> None:
        assert filename.endswith("OUTCAR")
        self.parse_dict = self.__class__.parse_dict


def _parse(monkeypatch: pytest.MonkeyPatch, data: dict[str, object]):
    import vasp_analyzer.parsing.adapters.vaspparser_outcar as adapter

    _Parser.parse_dict = data
    monkeypatch.setattr(adapter, "Outcar", _Parser)
    return parse_vaspparser_outcar(Path("OUTCAR"), _sites(), _provenance())


def test_copies_exact_arrays_into_analyzer_owned_immutable_contracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _parse_dict()
    trajectory = _parse(monkeypatch, data)

    assert trajectory.step_indices == (0, 1)
    assert trajectory.energies == (-1.0, -2.0)
    assert trajectory.positions[1][0] == (0.1, 0.0, 0.0)
    assert trajectory.fractional_positions[1][0] == (0.05, 0.0, 0.0)
    assert trajectory.forces[0][0] == (0.001, 0.002, 0.003)
    assert trajectory.cells[1][2] == (0.0, 0.0, 2.0)
    assert trajectory.energy_components[0] == ((1.0, 2.0), (3.0, 4.0))
    assert trajectory.scf_energies == ((-0.8, -1.0), (-1.7, -2.0))
    assert trajectory.pressures == ((0.1, 0.2, 0.3), (0.4, 0.5, 0.6))
    assert trajectory.fermi_level == -0.5
    assert trajectory.fermi_levels == (-0.4, -0.5)
    assert trajectory.vbm == ((-1.0, -1.1),)
    assert trajectory.cbm == ((0.2, 0.1),)
    assert trajectory.sites == _sites()
    assert trajectory.provenance == _provenance()

    # Mutating third-party arrays after return cannot alter analyzer data.
    data["positions"][1, 0, 0] = 99.0  # type: ignore[index]
    _Parser.parse_dict["energies"] = np.array([99.0, 99.0])
    assert trajectory.positions[1][0][0] == 0.1
    assert trajectory.energies == (-1.0, -2.0)


def test_accepts_values_already_converted_from_fortran_d_notation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _parse_dict()
    data["energies"] = np.array([1.0e-10, -2.5e10])

    trajectory = _parse(monkeypatch, data)

    assert trajectory.energies == (1.0e-10, -2.5e10)


@pytest.mark.parametrize(
    "key",
    [
        "energy_components",
        "stresses",
        "pressures",
        "scf_energies",
        "fermi_level",
        "e_fermi_list",
        "vbm_list",
        "cbm_list",
    ],
)
def test_absent_optional_quantities_map_to_none(
    monkeypatch: pytest.MonkeyPatch, key: str
) -> None:
    data = _parse_dict()
    data.pop(key)

    trajectory = _parse(monkeypatch, data)

    field = {
        "e_fermi_list": "fermi_levels",
        "vbm_list": "vbm",
        "cbm_list": "cbm",
    }.get(key, key)
    assert getattr(trajectory, field) is None


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("energies", np.array([-1.0])),
        ("positions", np.zeros((2, 2, 2))),
        ("forces", np.zeros((2, 1, 3))),
        ("cells", np.zeros((2, 3, 2))),
        ("stresses", np.zeros((2, 6))),
        ("pressures", np.zeros((2, 1))),
        ("scf_energies", [np.array([-1.0])]),
        ("energy_components", [np.ones((2, 1))]),
        ("e_fermi_list", np.array([-0.5])),
        ("vbm_list", np.zeros((1, 1))),
        ("cbm_list", np.zeros((1, 1))),
    ],
)
def test_rejects_shape_or_step_count_mismatch(
    monkeypatch: pytest.MonkeyPatch, key: str, value: object
) -> None:
    data = _parse_dict()
    data[key] = value

    with pytest.raises(DatasetConsistencyError, match=key):
        _parse(monkeypatch, data)


def test_rejects_site_atom_count_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    import vasp_analyzer.parsing.adapters.vaspparser_outcar as adapter

    _Parser.parse_dict = _parse_dict()
    monkeypatch.setattr(adapter, "Outcar", _Parser)

    with pytest.raises(DatasetConsistencyError, match="sites.*2 atoms"):
        parse_vaspparser_outcar(Path("OUTCAR"), _sites(1), _provenance())


@pytest.mark.parametrize(
    ("key", "mutate"),
    [
        ("energies", lambda data: data["energies"].__setitem__(0, np.nan)),
        ("positions", lambda data: data["positions"].__setitem__((0, 0, 0), np.inf)),
        ("energy_components", lambda data: data["energy_components"][0].__setitem__((0, 0), np.nan)),
        ("scf_energies", lambda data: data["scf_energies"][0].__setitem__(0, np.inf)),
        ("fermi_level", lambda data: data.__setitem__("fermi_level", np.nan)),
    ],
)
def test_rejects_nonfinite_values(
    monkeypatch: pytest.MonkeyPatch, key: str, mutate
) -> None:
    data = _parse_dict()
    mutate(data)

    with pytest.raises(DatasetConsistencyError, match=f"{key}.*finite"):
        _parse(monkeypatch, data)
