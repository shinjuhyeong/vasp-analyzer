import json
from hashlib import sha256
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.calculation.dataset import inspect_calculation, inspect_source
from vasp_analyzer.calculation.discovery import discover_calculation
from vasp_analyzer.core import (
    CalculationDataset,
    EnergyTerm,
    IonicStep,
    ParameterOccurrence,
    ParserProvenance,
)
from vasp_analyzer.normalizers import load_registry, normalize_outcar, select_normalizer
from vasp_analyzer.transport.protocol import Request, dispatch


FIXTURES = Path(__file__).parents[2] / "fixtures"


def _session(tmp_path: Path) -> CalculationSession:
    root = tmp_path / "calculation"
    root.mkdir()
    outcar = root / "OUTCAR"
    outcar.write_text("vasp.6.5.0 standard\nNIONS = 1\n", encoding="utf-8")
    match = select_normalizer(outcar.read_bytes(), load_registry({}, tmp_path))
    with normalize_outcar(outcar, match) as normalized:
        manifest = normalized.manifest
    reference = sha256(
        (
            f"{manifest.source_sha256}\0{manifest.definition_sha256}\0"
            f"{manifest.changed_line_count}"
        ).encode("ascii")
    ).hexdigest()
    step = IonicStep(
        index=0,
        lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        fractional_positions=(),
        cartesian_positions=(),
        raw_forces=(),
        free_forces=(),
        free_force_norms=(),
        total_energy=-1.0,
        delta_energy=None,
        scf_iterations=None,
        electronic_converged=None,
        ionic_converged=None,
        strongest_free_component=None,
        rms_free_force=None,
    )
    dataset = CalculationDataset(
        root=str(root),
        source_files=(inspect_source(outcar),),
        sites=(),
        initial_structure=None,
        ionic_steps=(step,),
        capabilities=(),
        provenance=ParserProvenance(
            adapter="vaspparser",
            adapter_version="0.0.7",
            dialect="standard",
            normalizer_id="standard",
            normalizer_display_name="Standard VASP",
            normalizer_schema_version=1,
            normalizer_definition_sha256=manifest.definition_sha256,
            normalization_manifest_reference=reference,
        ),
    )
    session = CalculationSession(root, cache=CacheStore(tmp_path / "cache"))
    session._dataset = dataset
    session._source = inspect_calculation(discover_calculation(root))
    return session


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

    assert dataset_response.model_dump(by_alias=True)["result"]["schemaVersion"] == 4
    assert step_response.model_dump(by_alias=True)["result"]["index"] == 0


def test_dispatch_preserves_detailed_camel_case_step_contract(tmp_path: Path) -> None:
    dataset = _session(tmp_path).refresh_if_changed()
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

    assert response["schemaVersion"] == 4
    assert response["ionicSteps"][0]["energyTerms"][0]["rawLabel"] == "Ewald energy TEWEN"
    assert response["ionicSteps"][0]["stressTensorKb"][1] == [0.2, 3.0, 0.3]
    assert [item["rawKey"] for item in response["parameters"]] == ["ENCUT"]


def test_normalization_operations_are_lazy_and_session_scoped(tmp_path: Path) -> None:
    session = _session(tmp_path)
    dataset = dispatch(
        session, Request.model_validate({"id": 1, "method": "getDataset", "params": {}})
    ).model_dump(mode="json", by_alias=True)["result"]
    reference = dataset["provenance"]["normalizationManifestReference"]

    assert "normalizedOutcar" not in dataset
    assert "normalizationManifest" not in dataset

    manifest = dispatch(
        session,
        Request.model_validate(
            {
                "id": 2,
                "method": "getNormalizationManifest",
                "params": {"manifestReference": reference},
            }
        ),
    ).model_dump(mode="json", by_alias=True)["result"]
    normalized = dispatch(
        session,
        Request.model_validate(
            {
                "id": 3,
                "method": "getNormalizedOutcar",
                "params": {"manifestReference": reference},
            }
        ),
    ).model_dump(mode="json", by_alias=True)["result"]

    assert manifest["normalizerId"] == "standard"
    assert manifest["changes"] == []
    assert normalized["manifestReference"] == reference
    assert "NIONS = 1" in normalized["content"]


def test_normalization_operation_rejects_foreign_reference(tmp_path: Path) -> None:
    response = dispatch(
        _session(tmp_path),
        Request.model_validate(
            {
                "id": 1,
                "method": "getNormalizationManifest",
                "params": {"manifestReference": "0" * 64},
            }
        ),
    ).model_dump(mode="json", by_alias=True)

    assert response["error"]["code"] == "normalization_session_expired"


def test_normalization_operation_rejects_changed_source(tmp_path: Path) -> None:
    session = _session(tmp_path)
    reference = session.refresh_if_changed().provenance.normalization_manifest_reference
    assert reference is not None
    (Path(session.path) / "OUTCAR").write_text(
        "vasp.6.5.0 changed\nNIONS = 1\n", encoding="utf-8"
    )

    response = dispatch(
        session,
        Request.model_validate(
            {
                "id": 1,
                "method": "getNormalizedOutcar",
                "params": {"manifestReference": reference},
            }
        ),
    ).model_dump(mode="json", by_alias=True)

    assert response["error"]["code"] == "normalization_session_expired"


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
