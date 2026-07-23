"""Authenticated handoff from a terminal to the VS Code control endpoint."""

from __future__ import annotations

import os
import re
import socket
import stat
from collections.abc import Callable, Mapping
from pathlib import Path
from time import monotonic
from typing import Literal

from pydantic import Field

from vasp_analyzer.calculation.discovery import discover_calculation
from vasp_analyzer.core import AnalyzerError, FrozenModel

EndpointSender = Callable[[str, bytes], bytes]

_ENDPOINT_ENV = "VASP_ANALYZER_ENDPOINT"
_TOKEN_ENV = "VASP_ANALYZER_TOKEN"
_MAX_ENDPOINT_CHARS = 512
_MAX_RESPONSE_BYTES = 4096
_MAX_CALCULATION_PATH_CHARS = 32_767
_PIPE_TIMEOUT_MILLISECONDS = 1500
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9._~+/=-]{32,512}\Z")


class HandoffResponse(FrozenModel):
    ok: Literal[True]


class HandoffRequest(FrozenModel):
    token: str = Field(repr=False, min_length=32, max_length=512)
    path: str = Field(min_length=1, max_length=_MAX_CALCULATION_PATH_CHARS)
    profile: str | None = Field(default=None, max_length=_MAX_CALCULATION_PATH_CHARS)


def canonical_calculation_path(path: Path) -> Path:
    """Return a canonical calculation root only after proving its OUTCAR is readable."""

    selected = Path(path).expanduser().resolve(strict=True)
    discovered = discover_calculation(selected)
    root = discovered.root.resolve(strict=True)
    try:
        with discovered.outcar.resolve(strict=True).open("rb") as stream:
            stream.read(1)
    except OSError as exc:
        raise AnalyzerError("OUTCAR is not readable") from exc
    return root


def _validated_endpoint(value: str | None) -> str | None:
    if not value or len(value) > _MAX_ENDPOINT_CHARS or "\x00" in value:
        return None
    if os.name == "nt":
        prefix = "\\\\.\\pipe\\"
        if not value.startswith(prefix) or len(value) <= len(prefix):
            return None
        suffix = value[len(prefix) :]
        if any(character in suffix for character in "\\/\r\n"):
            return None
        return value

    encoded = os.fsencode(value)
    endpoint = Path(value)
    if not endpoint.is_absolute() or len(encoded) > 103:
        return None
    try:
        metadata = endpoint.lstat()
    except OSError:
        return None
    if endpoint.is_symlink() or not stat.S_ISSOCK(metadata.st_mode):
        return None
    return value


def _validated_token(value: str | None) -> str | None:
    return value if value is not None and _TOKEN_PATTERN.fullmatch(value) else None


def _windows_pipe_exchange(endpoint: str, payload: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    error_io_pending = 997
    error_broken_pipe = 109
    generic_read = 0x80000000
    generic_write = 0x40000000
    open_existing = 3
    file_flag_overlapped = 0x40000000
    infinite = 0xFFFFFFFF
    wait_object_0 = 0

    class Overlapped(ctypes.Structure):
        _fields_ = [
            ("Internal", ctypes.c_size_t),
            ("InternalHigh", ctypes.c_size_t),
            ("Offset", wintypes.DWORD),
            ("OffsetHigh", wintypes.DWORD),
            ("hEvent", wintypes.HANDLE),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.WaitNamedPipeW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD)
    kernel32.WaitNamedPipeW.restype = wintypes.BOOL
    kernel32.CreateFileW.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CreateEventW.argtypes = (
        wintypes.LPVOID,
        wintypes.BOOL,
        wintypes.BOOL,
        wintypes.LPCWSTR,
    )
    kernel32.CreateEventW.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.GetOverlappedResult.argtypes = (
        wintypes.HANDLE,
        ctypes.POINTER(Overlapped),
        ctypes.POINTER(wintypes.DWORD),
        wintypes.BOOL,
    )
    kernel32.GetOverlappedResult.restype = wintypes.BOOL
    kernel32.WriteFile.argtypes = (
        wintypes.HANDLE,
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(Overlapped),
    )
    kernel32.WriteFile.restype = wintypes.BOOL
    kernel32.ReadFile.argtypes = (
        wintypes.HANDLE,
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(Overlapped),
    )
    kernel32.ReadFile.restype = wintypes.BOOL
    kernel32.CancelIoEx.argtypes = (wintypes.HANDLE, ctypes.POINTER(Overlapped))
    kernel32.CancelIoEx.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL

    def complete_io(
        handle: int,
        overlapped: Overlapped,
        transferred: wintypes.DWORD,
        deadline: float,
    ) -> int:
        remaining = max(0, int((deadline - monotonic()) * 1000))
        if kernel32.WaitForSingleObject(overlapped.hEvent, remaining) != wait_object_0:
            kernel32.CancelIoEx(handle, ctypes.byref(overlapped))
            kernel32.WaitForSingleObject(overlapped.hEvent, infinite)
            raise TimeoutError("extension endpoint timed out")
        if not kernel32.GetOverlappedResult(
            handle,
            ctypes.byref(overlapped),
            ctypes.byref(transferred),
            False,
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(transferred.value)

    def write_overlapped(handle: int, data: bytes, deadline: float) -> None:
        event = kernel32.CreateEventW(None, True, False, None)
        if not event:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            overlapped = Overlapped(hEvent=event)
            transferred = wintypes.DWORD()
            buffer = ctypes.create_string_buffer(data)
            completed = kernel32.WriteFile(
                handle,
                buffer,
                len(data),
                ctypes.byref(transferred),
                ctypes.byref(overlapped),
            )
            if not completed:
                error = ctypes.get_last_error()
                if error != error_io_pending:
                    raise ctypes.WinError(error)
                complete_io(handle, overlapped, transferred, deadline)
        finally:
            kernel32.CloseHandle(event)

    def read_overlapped(handle: int, size: int, deadline: float) -> bytes:
        event = kernel32.CreateEventW(None, True, False, None)
        if not event:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            overlapped = Overlapped(hEvent=event)
            transferred = wintypes.DWORD()
            buffer = ctypes.create_string_buffer(size)
            completed = kernel32.ReadFile(
                handle,
                buffer,
                size,
                ctypes.byref(transferred),
                ctypes.byref(overlapped),
            )
            if not completed:
                error = ctypes.get_last_error()
                if error == error_broken_pipe:
                    return b""
                if error != error_io_pending:
                    raise ctypes.WinError(error)
                complete_io(handle, overlapped, transferred, deadline)
            return buffer.raw[: transferred.value]
        finally:
            kernel32.CloseHandle(event)

    deadline = monotonic() + (_PIPE_TIMEOUT_MILLISECONDS / 1000)
    if not kernel32.WaitNamedPipeW(endpoint, _PIPE_TIMEOUT_MILLISECONDS):
        raise ctypes.WinError(ctypes.get_last_error())
    handle = kernel32.CreateFileW(
        endpoint,
        generic_read | generic_write,
        0,
        None,
        open_existing,
        file_flag_overlapped,
        None,
    )
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        write_overlapped(handle, payload, deadline)
        response = bytearray()
        while len(response) <= _MAX_RESPONSE_BYTES:
            chunk = read_overlapped(
                handle,
                min(1024, _MAX_RESPONSE_BYTES + 1 - len(response)),
                deadline,
            )
            if not chunk:
                break
            response.extend(chunk)
            if b"\n" in chunk:
                break
        return bytes(response)
    finally:
        kernel32.CancelIoEx(handle, None)
        kernel32.CloseHandle(handle)


def default_endpoint_sender(endpoint: str, payload: bytes) -> bytes:
    """Send one bounded request to an existing Unix socket or Windows named pipe."""

    if os.name == "nt":
        response = _windows_pipe_exchange(endpoint, payload)
    else:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1.0)
            client.connect(endpoint)
            client.sendall(payload)
            response = bytearray()
            while len(response) <= _MAX_RESPONSE_BYTES:
                chunk = client.recv(min(1024, _MAX_RESPONSE_BYTES + 1 - len(response)))
                if not chunk:
                    break
                response.extend(chunk)
                if b"\n" in chunk:
                    break
            response = bytes(response)
    if len(response) > _MAX_RESPONSE_BYTES:
        raise ValueError("endpoint response exceeds the size limit")
    return response


def try_extension_handoff(
    path: Path,
    *,
    profile_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
    sender: EndpointSender = default_endpoint_sender,
) -> bool:
    """Return true only for a valid, authenticated, acknowledged endpoint request."""

    environment = os.environ if environ is None else environ
    endpoint = _validated_endpoint(environment.get(_ENDPOINT_ENV))
    token = _validated_token(environment.get(_TOKEN_ENV))
    if endpoint is None or token is None:
        return False
    try:
        canonical = canonical_calculation_path(path)
        canonical_profile = None
        if profile_path is not None:
            canonical_profile_path = Path(profile_path).expanduser().resolve(strict=True)
            if not canonical_profile_path.is_file():
                return False
            canonical_profile = str(canonical_profile_path)
        request = HandoffRequest(
            token=token,
            path=str(canonical),
            profile=canonical_profile,
        )
        payload = (
            request.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")
            + b"\n"
        )
        raw_response = sender(endpoint, payload)
        if len(raw_response) > _MAX_RESPONSE_BYTES:
            return False
        response = HandoffResponse.model_validate_json(raw_response)
    except (AnalyzerError, OSError, UnicodeError, ValueError):
        return False
    return response.ok


__all__ = [
    "EndpointSender",
    "HandoffRequest",
    "HandoffResponse",
    "canonical_calculation_path",
    "default_endpoint_sender",
    "try_extension_handoff",
]
