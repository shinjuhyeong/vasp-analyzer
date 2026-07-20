"""Newline-delimited JSON transport used by the VS Code extension."""

from __future__ import annotations

import json
from typing import TextIO

from pydantic import ValidationError

from vasp_analyzer.calculation.session import CalculationSession

from .protocol import Request, dispatch, error_response

_MAX_REQUEST_CHARS = 1024 * 1024


def _request_id(line: str) -> int | None:
    try:
        value = json.loads(line)
    except (json.JSONDecodeError, UnicodeError):
        return None
    if not isinstance(value, dict):
        return None
    request_id = value.get("id")
    return request_id if isinstance(request_id, int) and not isinstance(request_id, bool) else None


def _read_bounded_line(source: TextIO) -> tuple[str, bool] | None:
    try:
        line = source.readline(_MAX_REQUEST_CHARS + 1)
    except EOFError:
        return None
    if line == "":
        return None
    oversized = len(line) > _MAX_REQUEST_CHARS
    if oversized and not line.endswith("\n"):
        while True:
            try:
                remainder = source.readline(_MAX_REQUEST_CHARS + 1)
            except EOFError:
                break
            if remainder == "" or remainder.endswith("\n"):
                break
    return line, oversized


def serve_stdio(session: CalculationSession, source: TextIO, sink: TextIO) -> None:
    """Serve independent requests; one malformed line cannot terminate the session."""

    while True:
        incoming = _read_bounded_line(source)
        if incoming is None:
            break
        line, oversized = incoming
        if oversized:
            response = error_response(None, "invalid_request", "Request exceeds the size limit")
        else:
            try:
                request = Request.model_validate_json(line)
            except ValidationError:
                response = error_response(
                    _request_id(line),
                    "invalid_request",
                    "Request is not valid protocol JSON",
                )
            else:
                try:
                    response = dispatch(session, request)
                except Exception:
                    response = error_response(
                        request.id,
                        "internal_error",
                        "Analyzer request failed",
                    )
        sink.write(response.model_dump_json(by_alias=True) + "\n")
        sink.flush()


__all__ = ["serve_stdio"]
