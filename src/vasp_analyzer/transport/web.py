"""Hardened loopback-only browser fallback using the shared protocol."""

from __future__ import annotations

import json
import socket
import threading
import time
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable
from urllib.parse import urlsplit

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


def _is_json_media_type(request: HttpRequest) -> bool:
    content_type = request.headers.get("content-type")
    if content_type is None:
        return False
    return content_type.split(";", 1)[0].strip().lower() == "application/json"


def _has_valid_origin(request: HttpRequest) -> bool:
    origin = request.headers.get("origin")
    if origin is None:
        return True
    host = request.headers.get("host")
    if host is None or origin == "null":
        return False
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "http"
        and parsed.netloc.lower() == host.lower()
        and parsed.hostname is not None
        and parsed.username is None
        and parsed.password is None
        and parsed.path == ""
        and parsed.query == ""
        and parsed.fragment == ""
        and (port is None or 0 < port <= 65535)
    )


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
        if not _is_json_media_type(request):
            return JSONResponse(
                status_code=415,
                content={
                    "error": {
                        "code": "unsupported_media_type",
                        "message": "Content-Type must be application/json",
                    }
                },
            )
        if not _has_valid_origin(request):
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "forbidden_origin",
                        "message": "Origin must match the loopback analyzer URL",
                    }
                },
            )
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


def _create_web_app(path: Path, profile: CompatibilityProfile | None) -> FastAPI:
    return create_web_app(path, profile=profile)


def _create_server(app: object, port: int) -> uvicorn.Server:
    return uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )


def launch_web(
    request: WebLaunchRequest,
    *,
    listener_factory: Callable[[int | None], Any] = _loopback_socket,
    app_factory: Callable[[Path, CompatibilityProfile | None], object] = _create_web_app,
    server_factory: Callable[[object, int], Any] = _create_server,
    thread_factory: Callable[..., Any] = threading.Thread,
    browser_open: Callable[[str], bool] = webbrowser.open,
    emit: Callable[..., None] = typer.echo,
    monotonic: Callable[[], float] = time.monotonic,
    pause: Callable[[float], None] = time.sleep,
) -> None:
    """Run a race-resistant loopback server and optionally open its browser URL."""

    try:
        listener = listener_factory(request.port)
        app = app_factory(request.path, request.profile)
    except (OSError, AnalyzerError) as exc:
        raise AnalyzerError(f"could not start browser fallback: {exc}") from exc
    port = int(listener.getsockname()[1])
    url = f"http://127.0.0.1:{port}"
    try:
        server = server_factory(app, port)
    except Exception as exc:
        listener.close()
        raise AnalyzerError("could not start browser fallback") from exc
    failures: list[BaseException] = []

    def run_server() -> None:
        try:
            server.run(sockets=[listener])
        except BaseException as exc:
            failures.append(exc)

    thread = thread_factory(
        target=run_server,
        kwargs={},
        name="vasp-analyzer-web",
        daemon=True,
    )
    thread_started = False
    try:
        try:
            thread.start()
            thread_started = True
        except Exception as exc:
            raise AnalyzerError("could not start browser fallback") from exc
        deadline = monotonic() + 10
        while thread.is_alive() and not server.started and monotonic() < deadline:
            pause(0.01)
        if failures:
            raise AnalyzerError("browser fallback server failed")
        if not server.started:
            raise AnalyzerError("browser fallback did not become ready")
        emit(url)
        if request.open_browser:
            try:
                opened = browser_open(url)
            except Exception:
                opened = False
            if not opened:
                emit(
                    "Browser could not be opened automatically; use the URL above.",
                    err=True,
                )
        while thread.is_alive():
            thread.join(timeout=0.25)
        if failures:
            raise AnalyzerError("browser fallback server failed")
    except KeyboardInterrupt:
        server.should_exit = True
    finally:
        server.should_exit = True
        if thread_started:
            try:
                thread.join(timeout=5)
            except Exception:
                pass
        listener.close()


__all__ = ["asset_root", "create_web_app", "launch_web"]
