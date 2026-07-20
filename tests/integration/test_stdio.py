import io
import json
from pathlib import Path
from typing import cast

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
    assert response["result"]["schemaVersion"] == 1
    assert response["result"]["ionicSteps"][0]["cartesianPositions"]


def test_stdio_recovers_after_invalid_json_and_invalid_params(tmp_path: Path) -> None:
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
    assert responses[1]["error"]["code"] == "invalid_params"
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
