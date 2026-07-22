import io
import json
from pathlib import Path
from typing import cast

import pytest

from vasp_analyzer.calculation.cache import CacheStore
from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.transport.stdio import serve_stdio


FIXTURES = Path(__file__).parents[1] / "fixtures"


def _calculation(tmp_path: Path) -> Path:
    (tmp_path / "OUTCAR").write_bytes(
        (FIXTURES / "outcar" / "ase-complete-one-step.OUTCAR").read_bytes()
    )
    return tmp_path


def _transact(root: Path, requests: list[dict[str, object] | str]) -> list[dict[str, object]]:
    lines = [item if isinstance(item, str) else json.dumps(item) for item in requests]
    source = io.StringIO("\n".join(lines) + "\n")
    sink = io.StringIO()
    session = CalculationSession(root, cache=CacheStore(root / "cache"))
    serve_stdio(session, source, sink)
    return [json.loads(line) for line in sink.getvalue().splitlines()]


def test_stdio_returns_camel_case_dataset(tmp_path: Path) -> None:
    response = _transact(
        _calculation(tmp_path), [{"id": 1, "method": "getDataset", "params": {}}]
    )[0]

    assert response["id"] == 1
    assert response["result"]["schemaVersion"] == 2
    assert response["result"]["ionicSteps"][0]["cartesianPositions"]
    assert response["result"]["ionicSteps"][0]["energyTerms"][0]["rawLabel"] == (
        "free energy TOTEN"
    )
    assert "stressTensorKb" in response["result"]["ionicSteps"][0]
    assert response["result"]["parameters"] == []


def test_stdio_preserves_standard_effective_parameter_metadata(tmp_path: Path) -> None:
    (tmp_path / "OUTCAR").write_bytes(
        (FIXTURES / "outcar" / "standard-startparameter-one-step.OUTCAR").read_bytes()
    )

    response = _transact(
        tmp_path, [{"id": 1, "method": "getDataset", "params": {}}]
    )[0]

    parameters = response["result"]["parameters"]
    assert [item["rawKey"] for item in parameters] == [
        "ENCUT", "EDIFFG", "HOME_EFFECTIVE"
    ]
    assert parameters[1]["unit"] == "eV/angstrom"
    assert parameters[1]["description"] == (
        "Ionic convergence threshold: force criterion"
    )
    assert parameters[2]["category"] is None


def test_stdio_recovers_after_invalid_json_and_mismatched_params(tmp_path: Path) -> None:
    responses = _transact(
        _calculation(tmp_path),
        [
            "not-json",
            {"id": 2, "method": "getStep", "params": {}},
            {"id": 3, "method": "getStep", "params": {"stepIndex": 0}},
        ],
    )

    assert responses[0]["error"]["code"] == "invalid_request"
    assert responses[1]["id"] == 2
    assert responses[1]["error"]["code"] == "invalid_request"
    assert responses[2]["result"]["index"] == 0


def test_stdio_converts_unexpected_failures_to_nondisclosing_typed_errors() -> None:
    class BrokenSession:
        def refresh_if_changed(self) -> None:
            raise RuntimeError("sensitive implementation detail")

    source = io.StringIO('{"id":9,"method":"getDataset","params":{}}\n')
    sink = io.StringIO()

    serve_stdio(cast(CalculationSession, BrokenSession()), source, sink)

    response = json.loads(sink.getvalue())
    assert response == {
        "id": 9,
        "error": {"code": "internal_error", "message": "Analyzer request failed"},
    }
    assert "sensitive" not in sink.getvalue()


@pytest.mark.parametrize("request_id", [-1, True, "1"])
def test_invalid_request_recovery_never_echoes_an_invalid_id(request_id: object) -> None:
    source = io.StringIO(
        json.dumps({"id": request_id, "method": "unknown", "params": {}}) + "\n"
    )
    sink = io.StringIO()

    serve_stdio(cast(CalculationSession, object()), source, sink)

    assert json.loads(sink.getvalue())["id"] is None


def test_invalid_request_recovery_echoes_only_a_valid_id() -> None:
    source = io.StringIO('{"id":12,"method":"unknown","params":{}}\n')
    sink = io.StringIO()

    serve_stdio(cast(CalculationSession, object()), source, sink)

    assert json.loads(sink.getvalue())["id"] == 12


@pytest.mark.parametrize("line", ['{"method":"unknown","params":{}}\n', "not-json\n"])
def test_missing_or_malformed_request_has_null_recovery_id(line: str) -> None:
    sink = io.StringIO()

    serve_stdio(cast(CalculationSession, object()), io.StringIO(line), sink)

    assert json.loads(sink.getvalue())["id"] is None


def test_oversized_request_has_null_recovery_id_and_next_line_is_processed() -> None:
    oversized = json.dumps(
        {
            "id": 99,
            "method": "getDataset",
            "params": {},
            "padding": "x" * (1024 * 1024),
        }
    )
    source = io.StringIO(
        oversized
        + '\n{"id":13,"method":"getVolumetric",'
        '"params":{"source":"CHGCAR","mode":"slice"}}\n'
    )
    sink = io.StringIO()

    serve_stdio(cast(CalculationSession, object()), source, sink)

    responses = [json.loads(line) for line in sink.getvalue().splitlines()]
    assert responses[0]["id"] is None
    assert responses[1]["id"] == 13
    assert responses[1]["error"]["code"] == "capability_unavailable"
