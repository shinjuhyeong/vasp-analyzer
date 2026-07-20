from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.transport.protocol import Request, dispatch


FIXTURES = Path(__file__).parents[2] / "fixtures"


def _session(tmp_path: Path) -> CalculationSession:
    root = tmp_path / "calculation"
    root.mkdir()
    (root / "OUTCAR").write_bytes(
        (FIXTURES / "outcar" / "ase-complete-one-step.OUTCAR").read_bytes()
    )
    return CalculationSession(root, cache=CacheStore(tmp_path / "cache"))


def test_request_is_immutable_and_accepts_camel_case_step_index() -> None:
    request = Request.model_validate(
        {"id": 7, "method": "getStep", "params": {"stepIndex": 0}}
    )

    assert request.params.step_index == 0
    with pytest.raises(ValidationError):
        request.id = 8


def test_dispatch_returns_dataset_and_step_with_versioned_aliases(tmp_path: Path) -> None:
    session = _session(tmp_path)

    dataset_response = dispatch(
        session, Request.model_validate({"id": 1, "method": "getDataset", "params": {}})
    )
    step_response = dispatch(
        session,
        Request.model_validate(
            {"id": 2, "method": "getStep", "params": {"stepIndex": 0}}
        ),
    )

    assert dataset_response.model_dump(by_alias=True)["result"]["schemaVersion"] == 1
    assert step_response.model_dump(by_alias=True)["result"]["index"] == 0


def test_get_volumetric_returns_typed_capability_error(tmp_path: Path) -> None:
    response = dispatch(
        _session(tmp_path),
        Request.model_validate(
            {
                "id": 3,
                "method": "getVolumetric",
                "params": {"source": "CHGCAR", "mode": "isosurface"},
            }
        ),
    )

    payload = response.model_dump(by_alias=True)
    assert payload == {
        "id": 3,
        "error": {
            "code": "capability_unavailable",
            "message": "Volumetric data is not available in this release",
        },
    }


def test_get_step_reports_a_typed_out_of_range_error(tmp_path: Path) -> None:
    response = dispatch(
        _session(tmp_path),
        Request.model_validate(
            {"id": 4, "method": "getStep", "params": {"stepIndex": 99}}
        ),
    )

    assert response.model_dump(by_alias=True)["error"]["code"] == "step_not_found"
