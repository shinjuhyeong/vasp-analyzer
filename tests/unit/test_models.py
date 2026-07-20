from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.core.models import (
    CalculationDataset,
    ForceComponent,
    SelectiveMask,
    SourceFile,
)


def test_selective_mask_preserves_unknown_state() -> None:
    mask = SelectiveMask(a=True, b=False, c=None)
    assert mask.as_tuple() == (True, False, None)
    assert mask.model_dump(mode="json", by_alias=True) == {"a": True, "b": False, "c": None}


def test_force_component_retains_signed_value() -> None:
    component = ForceComponent(site_index=4, axis="c", value=-0.61)
    assert component.magnitude == 0.61


def test_source_files_are_deeply_immutable(tmp_path: Path) -> None:
    source = SourceFile(path=str(tmp_path / "OUTCAR"), size=7, mtime_ns=11, fingerprint="abc")
    dataset = CalculationDataset(
        root=str(tmp_path),
        source_files=(source,),
        sites=(),
        ionic_steps=(),
        capabilities=(),
    )
    with pytest.raises(ValidationError):
        dataset.source_files = ()
