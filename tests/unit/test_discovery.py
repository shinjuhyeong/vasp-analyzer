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


@pytest.mark.parametrize("filename", ["outcar", "OutCar"])
def test_selected_outcar_filename_is_case_insensitive_and_preserved(
    tmp_path: Path, filename: str
) -> None:
    selected = tmp_path / filename
    selected.write_text("fixture", encoding="utf-8")

    found = discover_calculation(selected)

    assert found.root == tmp_path.resolve()
    assert found.outcar.name == filename
    assert str(found.outcar) == str(selected.resolve())


def test_explicit_outcar_like_file_with_descriptive_name_is_preserved(
    tmp_path: Path,
) -> None:
    selected = tmp_path / "OUTCAR_homever"
    selected.write_text("fixture", encoding="utf-8")

    found = discover_calculation(selected)

    assert found.root == tmp_path.resolve()
    assert found.outcar == selected.resolve()


def test_arbitrary_selected_file_does_not_replace_sibling_outcar(
    tmp_path: Path,
) -> None:
    selected = tmp_path / "POSCAR.backup"
    selected.write_text("not OUTCAR", encoding="utf-8")
    outcar = tmp_path / "OUTCAR"
    outcar.write_text("OUTCAR", encoding="utf-8")

    found = discover_calculation(selected)

    assert found.outcar == outcar.resolve()


def test_arbitrary_selected_file_without_sibling_outcar_is_rejected(
    tmp_path: Path,
) -> None:
    selected = tmp_path / "private.txt"
    selected.write_text("not OUTCAR", encoding="utf-8")

    with pytest.raises(AnalyzerError, match="OUTCAR"):
        discover_calculation(selected)


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
