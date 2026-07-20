import json
import os
from pathlib import Path

import pytest
from typer.testing import CliRunner

from vasp_analyzer.cli.app import WebLaunchRequest, create_app


FIXTURES = Path(__file__).parents[1] / "fixtures"
runner = CliRunner()


def _calculation(tmp_path: Path) -> Path:
    root = tmp_path / "calculation"
    root.mkdir()
    (root / "OUTCAR").write_bytes(
        (FIXTURES / "outcar" / "ase-complete-one-step.OUTCAR").read_bytes()
    )
    return root


@pytest.mark.parametrize("argument", [None, "OUTCAR", "."])
def test_cli_accepts_all_discovery_forms(
    argument: str | None, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _calculation(tmp_path)
    launches: list[WebLaunchRequest] = []
    app = create_app(web_launcher=launches.append, environ={})
    monkeypatch.chdir(root)

    result = runner.invoke(app, [] if argument is None else [argument])

    assert result.exit_code == 0, result.output
    assert launches[0].path == root.resolve()


def test_valid_handoff_sends_only_token_and_canonical_path(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    sent: list[tuple[str, bytes]] = []
    launches: list[WebLaunchRequest] = []
    endpoint = r"\\.\pipe\vasp-analyzer-test" if os.name == "nt" else str(tmp_path / "endpoint.sock")
    if os.name != "nt":
        import socket

        holder = socket.socket(socket.AF_UNIX)
        holder.bind(endpoint)
    else:
        holder = None

    def send(address: str, payload: bytes) -> bytes:
        sent.append((address, payload))
        return b'{"ok":true}\n'

    try:
        app = create_app(
            web_launcher=launches.append,
            endpoint_sender=send,
            environ={
                "VASP_ANALYZER_ENDPOINT": endpoint,
                "VASP_ANALYZER_TOKEN": "a" * 32,
            },
        )
        result = runner.invoke(app, [str(root)])
    finally:
        if holder is not None:
            holder.close()

    assert result.exit_code == 0, result.output
    assert launches == []
    assert json.loads(sent[0][1]) == {"token": "a" * 32, "path": str(root.resolve())}


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"VASP_ANALYZER_ENDPOINT": "relative.sock", "VASP_ANALYZER_TOKEN": "a" * 32},
        {"VASP_ANALYZER_ENDPOINT": r"\\.\pipe\x", "VASP_ANALYZER_TOKEN": "short"},
    ],
)
def test_absent_or_invalid_handoff_falls_back_without_sending(
    environment: dict[str, str], tmp_path: Path
) -> None:
    root = _calculation(tmp_path)
    launches: list[WebLaunchRequest] = []

    def unexpected_send(_address: str, _payload: bytes) -> bytes:
        raise AssertionError("invalid endpoint must not be contacted")

    app = create_app(
        web_launcher=launches.append,
        endpoint_sender=unexpected_send,
        environ=environment,
    )
    result = runner.invoke(app, [str(root)])

    assert result.exit_code == 0, result.output
    assert launches[0].path == root.resolve()


def test_stale_or_invalid_endpoint_response_falls_back(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    launches: list[WebLaunchRequest] = []
    endpoint = r"\\.\pipe\vasp-analyzer-test" if os.name == "nt" else str(tmp_path / "endpoint.sock")
    if os.name != "nt":
        import socket

        holder = socket.socket(socket.AF_UNIX)
        holder.bind(endpoint)
    else:
        holder = None

    try:
        app = create_app(
            web_launcher=launches.append,
            endpoint_sender=lambda _address, _payload: b'{"ok":false,"extra":"bad"}\n',
            environ={
                "VASP_ANALYZER_ENDPOINT": endpoint,
                "VASP_ANALYZER_TOKEN": "b" * 32,
            },
        )
        result = runner.invoke(app, [str(root)])
    finally:
        if holder is not None:
            holder.close()

    assert result.exit_code == 0, result.output
    assert launches[0].path == root.resolve()
    assert "VS Code handoff unavailable" in result.output


def test_stale_endpoint_connection_falls_back_without_disclosing_credentials(
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path)
    launches: list[WebLaunchRequest] = []
    endpoint = r"\\.\pipe\vasp-analyzer-stale" if os.name == "nt" else str(tmp_path / "stale.sock")
    if os.name != "nt":
        import socket

        holder = socket.socket(socket.AF_UNIX)
        holder.bind(endpoint)
    else:
        holder = None

    def stale_send(_address: str, _payload: bytes) -> bytes:
        raise OSError("endpoint is stale")

    token = "secret-token-" + "d" * 32
    try:
        app = create_app(
            web_launcher=launches.append,
            endpoint_sender=stale_send,
            environ={
                "VASP_ANALYZER_ENDPOINT": endpoint,
                "VASP_ANALYZER_TOKEN": token,
            },
        )
        result = runner.invoke(app, [str(root)])
    finally:
        if holder is not None:
            holder.close()

    assert result.exit_code == 0, result.output
    assert launches[0].path == root.resolve()
    assert "VS Code handoff unavailable" in result.output
    assert token not in result.output
    assert str(root.resolve()) not in result.output


def test_profile_is_validated_before_launch(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    profile = tmp_path / "invalid.toml"
    profile.write_text("not valid toml =", encoding="utf-8")
    launches: list[WebLaunchRequest] = []
    app = create_app(web_launcher=launches.append, environ={})

    result = runner.invoke(app, [str(root), "--profile", str(profile)])

    assert result.exit_code != 0
    assert launches == []
    assert "Invalid profile" in result.output


def test_forced_profile_skips_path_only_extension_handoff(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    profile = FIXTURES / "profiles" / "home-example.toml"
    launches: list[WebLaunchRequest] = []

    def unexpected_send(_address: str, _payload: bytes) -> bytes:
        raise AssertionError("path-only handoff cannot preserve a forced profile")

    app = create_app(
        web_launcher=launches.append,
        endpoint_sender=unexpected_send,
        environ={
            "VASP_ANALYZER_ENDPOINT": r"\\.\pipe\vasp-analyzer-test",
            "VASP_ANALYZER_TOKEN": "c" * 32,
        },
    )

    result = runner.invoke(app, [str(root), "--profile", str(profile)])

    assert result.exit_code == 0, result.output
    assert launches[0].profile is not None
    assert launches[0].profile.id == "home-example"


def test_explicit_web_flags_skip_handoff_and_route_port_and_open_state(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    launches: list[WebLaunchRequest] = []

    def unexpected_send(_address: str, _payload: bytes) -> bytes:
        raise AssertionError("--web must not contact the extension endpoint")

    app = create_app(
        web_launcher=launches.append,
        endpoint_sender=unexpected_send,
        environ={
            "VASP_ANALYZER_ENDPOINT": r"\\.\pipe\vasp-analyzer-test",
            "VASP_ANALYZER_TOKEN": "e" * 32,
        },
    )

    result = runner.invoke(app, [str(root), "--web", "--port", "8765", "--no-open"])

    assert result.exit_code == 0, result.output
    assert launches == [
        WebLaunchRequest(path=root.resolve(), port=8765, open_browser=False)
    ]


@pytest.mark.parametrize(
    ("flags", "expected"),
    [
        (["--port", "8765"], WebLaunchRequest(path=Path("."), port=8765)),
        (["--port", "0"], WebLaunchRequest(path=Path("."), port=0)),
        (["--no-open"], WebLaunchRequest(path=Path("."), open_browser=False)),
    ],
)
def test_each_browser_only_option_skips_extension_handoff(
    flags: list[str],
    expected: WebLaunchRequest,
    tmp_path: Path,
) -> None:
    root = _calculation(tmp_path)
    launches: list[WebLaunchRequest] = []

    def unexpected_send(_address: str, _payload: bytes) -> bytes:
        raise AssertionError("browser-only options must not contact the extension endpoint")

    app = create_app(
        web_launcher=launches.append,
        endpoint_sender=unexpected_send,
        environ={
            "VASP_ANALYZER_ENDPOINT": r"\\.\pipe\vasp-analyzer-test",
            "VASP_ANALYZER_TOKEN": "f" * 32,
        },
    )

    result = runner.invoke(app, [str(root), *flags])

    assert result.exit_code == 0, result.output
    assert launches == [expected.model_copy(update={"path": root.resolve()})]


def test_serve_stdio_and_dialect_validate_commands(tmp_path: Path) -> None:
    root = _calculation(tmp_path)
    app = create_app(web_launcher=lambda _request: None, environ={})

    stdio = runner.invoke(
        app,
        ["serve", "--stdio", str(root)],
        input='{"id":1,"method":"getDataset","params":{}}\n',
    )
    dialect = runner.invoke(app, ["dialect", "validate", str(root)])

    assert stdio.exit_code == 0, stdio.output
    assert json.loads(stdio.output)["result"]["schemaVersion"] == 1
    assert dialect.exit_code == 0, dialect.output
    assert json.loads(dialect.output)["dialect"] == "standard"


def test_corpus_validate_routes_to_existing_validator(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import importlib

    app_module = importlib.import_module("vasp_analyzer.cli.app")
    from vasp_analyzer.cli.corpus import CorpusReport

    report = CorpusReport(
        files=0,
        bytes_total=0,
        home_barrier=0,
        with_force_blocks=0,
        force_blocks=0,
        complete=0,
        incomplete=0,
        max_steps=0,
        elapsed_seconds=0.0,
        peak_rss_bytes=0,
        warnings=(),
        fingerprints=(),
    )
    monkeypatch.setattr(app_module, "validate_corpus", lambda path: report)
    app = create_app(web_launcher=lambda _request: None, environ={})

    result = runner.invoke(app, ["corpus", "validate", str(tmp_path)])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["files"] == 0
