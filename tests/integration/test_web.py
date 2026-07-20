import json
from pathlib import Path

from fastapi.testclient import TestClient

from vasp_analyzer.transport.web import create_web_app


FIXTURES = Path(__file__).parents[1] / "fixtures"


def _calculation(tmp_path: Path) -> Path:
    root = tmp_path / "calculation"
    root.mkdir()
    (root / "OUTCAR").write_bytes(
        (FIXTURES / "outcar" / "ase-complete-one-step.OUTCAR").read_bytes()
    )
    return root


def _assets(tmp_path: Path) -> Path:
    root = tmp_path / "assets"
    root.mkdir()
    (root / "index.html").write_text(
        '<!doctype html><div id="app"></div><script src="/assets/index.js"></script>',
        encoding="utf-8",
    )
    (root / "index.js").write_text("globalThis.__offline = true;", encoding="utf-8")
    (root / "index.css").write_text("body { color: black; }", encoding="utf-8")
    return root


def _app(calculation: Path, assets: Path):
    return create_web_app(
        calculation,
        asset_dir=assets,
        allowed_hosts=("127.0.0.1", "localhost", "testserver"),
    )


def test_web_fallback_uses_the_shared_typed_protocol(tmp_path: Path) -> None:
    client = TestClient(_app(_calculation(tmp_path), _assets(tmp_path)))

    dataset = client.post(
        "/api/request", json={"id": 1, "method": "getDataset", "params": {}}
    )
    step = client.post(
        "/api/request", json={"id": 2, "method": "getStep", "params": {"stepIndex": 0}}
    )
    volumetric = client.post(
        "/api/request",
        json={
            "id": 3,
            "method": "getVolumetric",
            "params": {"source": "CHGCAR", "mode": "isosurface"},
        },
    )

    assert dataset.json()["result"]["schemaVersion"] == 1
    assert step.json()["result"]["index"] == 0
    assert volumetric.json() == {
        "id": 3,
        "error": {
            "code": "capability_unavailable",
            "message": "Volumetric data is not available in this release",
        },
    }


def test_web_protocol_rejects_malformed_requests_with_typed_nondisclosing_errors(
    tmp_path: Path,
) -> None:
    client = TestClient(_app(_calculation(tmp_path), _assets(tmp_path)))

    response = client.post(
        "/api/request",
        content=json.dumps({"id": 7, "method": "getStep", "params": {}}),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": 7,
        "error": {"code": "invalid_request", "message": "Request is not valid protocol JSON"},
    }


def test_web_assets_are_offline_path_safe_and_hardened(tmp_path: Path) -> None:
    calculation = _calculation(tmp_path)
    client = TestClient(_app(calculation, _assets(tmp_path)))

    page = client.get("/")

    assert page.status_code == 200
    assert "https://" not in page.text
    assert page.headers["content-security-policy"] == (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
        "frame-ancestors 'none'; form-action 'none'"
    )
    assert page.headers["x-content-type-options"] == "nosniff"
    assert page.headers["referrer-policy"] == "no-referrer"
    assert client.get("/assets/index.js").status_code == 200
    assert client.get("/assets/../../OUTCAR").status_code in {400, 404}
    assert client.get("/assets/%2e%2e/%2e%2e/OUTCAR").status_code in {400, 404}
    assert client.get("/assets/").status_code == 404


def test_web_rejects_dns_rebinding_host_headers(tmp_path: Path) -> None:
    client = TestClient(create_web_app(_calculation(tmp_path), asset_dir=_assets(tmp_path)))

    assert client.get("/", headers={"host": "attacker.example"}).status_code == 400
    assert client.get("/", headers={"host": "127.0.0.1:7123"}).status_code == 200
