from pathlib import Path

import pytest

from vasp_analyzer.discovery import discover_calculation
from vasp_analyzer.errors import AnalyzerError


def test_outcar_path_resolves_parent(tmp_path: Path) -> None:
    outcar = tmp_path / "OUTCAR"
    outcar.write_text("fixture", encoding="utf-8")
    found = discover_calculation(outcar)
    assert found.root == tmp_path.resolve()
    assert found.outcar == outcar.resolve()


def test_missing_outcar_is_actionable(tmp_path: Path) -> None:
    with pytest.raises(AnalyzerError, match="OUTCAR"):
        discover_calculation(tmp_path)
