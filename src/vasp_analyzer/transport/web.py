"""Hardened loopback-only browser fallback using the shared protocol."""

from __future__ import annotations

import json
import socket
import threading
import time
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING

import typer
import uvicorn
from fastapi import FastAPI, Request as HttpRequest
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from vasp_analyzer.calculation.session import CalculationSession
from vasp_analyzer.core import AnalyzerError
from vasp_analyzer.parsing.profiles import CompatibilityProfile

from .protocol import Request, dispatch, error_response, recover_request_id

if TYPE_CHECKING:
    from vasp_analyzer.cli.app import WebLaunchRequest


_MAX_REQUEST_BYTES = 1024 * 1024
_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
    "frame-ancestors 'none'; form-action 'none'"
)
_INDEX = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VASP Analyzer</title>
  <link rel="stylesheet" href="/assets/index.css">
</head>
<body>
  <main id="app" aria-live="polite">Loading VASP calculation...</main>
  <script src="/assets/index.js"></script>
</body>
</html>
"""


def asset_root() -> Path:
    """Return the web assets installed inside the Python package."""

    return Path(__file__).parents[1] / "web_assets"


def _security_headers(response: object) -> None:
    headers = response.headers  # type: ignore[attr-defined]
    headers["Content-Security-Policy"] = _CSP
    headers["X-Content-Type-Options"] = "nosniff"
    headers["Referrer-Policy"] = "no-referrer"
    headers["X-Frame-Options"] = "DENY"
    headers["Cache-Control"] = "no-store"


async def _bounded_body(request: HttpRequest) -> bytes | None:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > _MAX_REQUEST_BYTES:
            return None
    return bytes(body)


def _recover_id(raw: bytes) -> int | None:
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeError):
        return None
    return recover_request_id(value.get("id")) if isinstance(value, dict) else None


def create_web_app(
    path: Path,
    *,
    profile: CompatibilityProfile | None = None,
    asset_dir: Path | None = None,
    allowed_hosts: tuple[str, ...] = ("127.0.0.1", "localhost"),
) -> FastAPI:
    """Create an offline app for one calculation, with no CORS or public bind."""

    selected_assets = Path(asset_dir) if asset_dir is not None else asset_root()
    if not selected_assets.is_dir():
        raise AnalyzerError("browser assets are missing; reinstall the analyzer package")
    session = CalculationSession(path, profile=profile)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))

    @app.middleware("http")
    async def hardened_headers(request: HttpRequest, call_next: object) -> object:
        response = await call_next(request)  # type: ignore[operator]
        _security_headers(response)
        return response

    @app.get("/", response_class=HTMLResponse)
    async def index() -> HTMLResponse:
        return HTMLResponse(_INDEX)

    @app.post("/api/request")
    async def protocol(request: HttpRequest) -> JSONResponse:
        raw = await _bounded_body(request)
        if raw is None:
            response = error_response(None, "invalid_request", "Request exceeds the size limit")
        else:
            try:
                parsed = Request.model_validate_json(raw)
            except ValidationError:
                response = error_response(
                    _recover_id(raw),
                    "invalid_request",
                    "Request is not valid protocol JSON",
                )
            else:
                try:
                    response = dispatch(session, parsed)
                except Exception:
                    response = error_response(
                        parsed.id, "internal_error", "Analyzer request failed"
                    )
        return JSONResponse(response.model_dump(mode="json", by_alias=True))

    app.mount(
        "/assets",
        StaticFiles(directory=selected_assets, check_dir=True, html=False),
        name="assets",
    )
    return app


def _loopback_socket(port: int | None) -> socket.socket:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        listener.bind(("127.0.0.1", port or 0))
        listener.listen(128)
    except Exception:
        listener.close()
        raise
    return listener


def launch_web(request: WebLaunchRequest) -> None:
    """Run a race-resistant loopback server and optionally open its browser URL."""

    try:
        listener = _loopback_socket(request.port)
        app = create_web_app(request.path, profile=request.profile)
    except (OSError, AnalyzerError) as exc:
        raise AnalyzerError(f"could not start browser fallback: {exc}") from exc
    port = int(listener.getsockname()[1])
    url = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(
        target=server.run,
        kwargs={"sockets": [listener]},
        name="vasp-analyzer-web",
        daemon=True,
    )
    thread.start()
    deadline = time.monotonic() + 10
    while thread.is_alive() and not server.started and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=2)
        listener.close()
        raise AnalyzerError("browser fallback did not become ready")
    typer.echo(url)
    try:
        if request.open_browser:
            try:
                opened = webbrowser.open(url)
            except OSError:
                opened = False
            if not opened:
                typer.echo(
                    "Browser could not be opened automatically; use the URL above.",
                    err=True,
                )
        while thread.is_alive():
            thread.join(timeout=0.25)
    except KeyboardInterrupt:
        server.should_exit = True
        thread.join(timeout=5)
    finally:
        server.should_exit = True
        listener.close()


__all__ = ["asset_root", "create_web_app", "launch_web"]
