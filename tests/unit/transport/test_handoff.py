import json
import os
from pathlib import Path

from vasp_analyzer.transport.handoff import try_extension_handoff


def _endpoint(tmp_path: Path) -> tuple[str, object | None]:
    if os.name == "nt":
        return r"\\.\pipe\vasp-analyzer-test", None

    import socket

    endpoint = str(tmp_path / "endpoint.sock")
    holder = socket.socket(socket.AF_UNIX)
    holder.bind(endpoint)
    return endpoint, holder


def _calculation(tmp_path: Path) -> Path:
    root = tmp_path / "calculation"
    root.mkdir()
    (root / "OUTCAR").write_text("vasp output", encoding="utf-8")
    return root


def test_handoff_serializes_a_canonical_profile_path(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    profile = tmp_path / "profile.toml"
    profile.write_text("schema_version = 1", encoding="utf-8")
    endpoint, holder = _endpoint(tmp_path)
    sent: list[bytes] = []

    def send(_address: str, payload: bytes) -> bytes:
        sent.append(payload)
        return b'{"ok":true}\n'

    try:
        result = try_extension_handoff(
            root,
            profile_path=profile,
            environ={
                "VASP_ANALYZER_ENDPOINT": endpoint,
                "VASP_ANALYZER_TOKEN": "a" * 32,
            },
            sender=send,
        )
    finally:
        if holder is not None:
            holder.close()

    assert result is True
    assert json.loads(sent[0]) == {
        "token": "a" * 32,
        "path": str(root.resolve()),
        "profile": str(profile.resolve()),
    }


def test_handoff_rejects_a_profile_directory_without_sending(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    endpoint, holder = _endpoint(tmp_path)
    sent: list[bytes] = []

    try:
        result = try_extension_handoff(
            root,
            profile_path=tmp_path,
            environ={
                "VASP_ANALYZER_ENDPOINT": endpoint,
                "VASP_ANALYZER_TOKEN": "a" * 32,
            },
            sender=lambda _address, payload: sent.append(payload) or b'{"ok":true}\n',
        )
    finally:
        if holder is not None:
            holder.close()

    assert result is False
    assert sent == []
