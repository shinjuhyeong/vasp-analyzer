import json
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import CalculationDataset, EnergyTerm, ParameterOccurrence
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


@pytest.mark.parametrize(
    ("method", "params"),
    [
        ("getDataset", {"stepIndex": 0}),
        ("getDataset", {"source": "CHGCAR", "mode": "slice"}),
        ("getStep", {}),
        ("getStep", {"source": "CHGCAR", "mode": "isosurface"}),
        ("getVolumetric", {}),
        ("getVolumetric", {"stepIndex": 0}),
    ],
)
def test_request_rejects_every_method_params_mismatch(
    method: str, params: dict[str, object]
) -> None:
    with pytest.raises(ValidationError, match="params"):
        Request.model_validate({"id": 1, "method": method, "params": params})


@pytest.mark.parametrize(
    ("method", "params"),
    [
        ("getDataset", {}),
        ("getStep", {"stepIndex": 0}),
        ("getVolumetric", {"source": "CHGCAR", "mode": "slice"}),
    ],
)
def test_request_accepts_only_the_exact_params_for_each_method(
    method: str, params: dict[str, object]
) -> None:
    request = Request.model_validate_json(
        json.dumps({"id": 1, "method": method, "params": params})
    )

    assert request.method == method


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

    assert dataset_response.model_dump(by_alias=True)["result"]["schemaVersion"] == 3
    assert step_response.model_dump(by_alias=True)["result"]["index"] == 0


def test_dispatch_preserves_detailed_camel_case_step_contract(tmp_path: Path) -> None:
    dataset = _session(tmp_path).load()
    step = dataset.ionic_steps[0].model_copy(
        update={
            "energy_terms": (
                EnergyTerm(
                    key="ewald",
                    raw_label="Ewald energy TEWEN",
                    value=2.5,
                    kind="contribution",
                ),
            ),
            "external_pressure_kb": 4.0,
            "stress_tensor_kb": ((2.0, 0.2, 0.4), (0.2, 3.0, 0.3), (0.4, 0.3, 4.0)),
        }
    )
    dataset = dataset.model_copy(
        update={
            "ionic_steps": (step,),
            "parameters": (
                ParameterOccurrence(
                    key="encut",
                    raw_key="ENCUT",
                    raw_value="520",
                    value=520,
                    ordinal=0,
                    line_number=4,
                ),
            ),
        }
    )

    class StaticSession:
        def refresh_if_changed(self) -> CalculationDataset:
            return dataset

    response = dispatch(
        cast(CalculationSession, StaticSession()),
        Request.model_validate({"id": 1, "method": "getDataset", "params": {}}),
    ).model_dump(mode="json", by_alias=True)["result"]

    assert response["schemaVersion"] == 3
    assert response["ionicSteps"][0]["energyTerms"][0]["rawLabel"] == "Ewald energy TEWEN"
    assert response["ionicSteps"][0]["stressTensorKb"][1] == [0.2, 3.0, 0.3]
    assert [item["rawKey"] for item in response["parameters"]] == ["ENCUT"]


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
