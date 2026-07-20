from pathlib import Path

import pytest

from vasp_analyzer.calculation.discovery import discover_calculation
from vasp_analyzer.core.errors import AnalyzerError


def test_outcar_path_resolves_parent(tmp_path: Path) -> None:
    outcar = tmp_path / "OUTCAR"
    outcar.write_text("fixture", encoding="utf-8")
    found = discover_calculation(outcar)
    assert found.root == tmp_path.resolve()
    assert found.outcar == outcar.resolve()


def test_missing_outcar_is_actionable(tmp_path: Path) -> None:
    with pytest.raises(AnalyzerError, match="OUTCAR"):
        discover_calculation(tmp_path)


def test_discovery_inventories_poscar_contcar_and_outcar(tmp_path: Path) -> None:
    for name in ("POSCAR", "CONTCAR", "OUTCAR", "vasprun.xml", "CHGCAR"):
        (tmp_path / name).write_text(name, encoding="utf-8")
    found = discover_calculation(tmp_path)
    assert (found.poscar, found.contcar, found.outcar) == tuple(
        (tmp_path / name).resolve() for name in ("POSCAR", "CONTCAR", "OUTCAR")
    )
    assert tuple(item.name for item in found.optional) == ("CHGCAR", "vasprun.xml")
