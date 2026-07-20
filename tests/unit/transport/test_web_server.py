from pathlib import Path
from typing import Any

import pytest

from vasp_analyzer.cli.app import WebLaunchRequest
from vasp_analyzer.core import AnalyzerError
from vasp_analyzer.transport.web import _loopback_socket, launch_web


class FakeListener:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def getsockname(self) -> tuple[str, int]:
        return ("127.0.0.1", 8123)

    def close(self) -> None:
        self.events.append("socket-close")


class ImmediateThread:
    def __init__(self, *, target: Any, kwargs: dict[str, object], **_ignored: object) -> None:
        self.target = target
        self.kwargs = kwargs
        self.alive = False
        self.joins: list[float | None] = []

    def start(self) -> None:
        self.alive = True
        self.target(**self.kwargs)
        self.alive = False

    def is_alive(self) -> bool:
        return self.alive

    def join(self, timeout: float | None = None) -> None:
        self.joins.append(timeout)


class FakeServer:
    def __init__(self, events: list[str], *, failure: Exception | None = None) -> None:
        self.events = events
        self.failure = failure
        self.started = False
        self.should_exit = False

    def run(self, *, sockets: list[FakeListener]) -> None:
        assert len(sockets) == 1
        if self.failure is not None:
            raise self.failure
        self.started = True
        self.events.append("ready")


def test_loopback_socket_binds_exact_host_and_reports_explicit_port_conflict() -> None:
    holder = _loopback_socket(0)
    host, port = holder.getsockname()
    try:
        assert host == "127.0.0.1"
        with pytest.raises(OSError):
            _loopback_socket(port)
    finally:
        holder.close()


@pytest.mark.parametrize("browser_result", [False, OSError("browser unavailable")])
def test_server_is_ready_before_browser_policy_and_cleanup(
    browser_result: bool | OSError,
) -> None:
    events: list[str] = []
    listener = FakeListener(events)
    server = FakeServer(events)

    def open_browser(url: str) -> bool:
        assert server.started
        events.append(f"browser:{url}")
        if isinstance(browser_result, OSError):
            raise browser_result
        return browser_result

    launch_web(
        WebLaunchRequest(path=Path("calculation")),
        listener_factory=lambda _port: listener,
        app_factory=lambda _path, _profile: object(),
        server_factory=lambda _app, _port: server,
        thread_factory=ImmediateThread,
        browser_open=open_browser,
        emit=lambda message, **_kwargs: events.append(f"emit:{message}"),
    )

    assert events.index("ready") < events.index("emit:http://127.0.0.1:8123")
    assert events.index("ready") < events.index("browser:http://127.0.0.1:8123")
    assert server.should_exit is True
    assert events[-1] == "socket-close"


def test_background_server_failure_is_typed_and_cleans_up() -> None:
    events: list[str] = []
    listener = FakeListener(events)
    server = FakeServer(events, failure=RuntimeError("private server detail"))

    with pytest.raises(AnalyzerError, match="browser fallback server failed") as raised:
        launch_web(
            WebLaunchRequest(path=Path("calculation"), open_browser=False),
            listener_factory=lambda _port: listener,
            app_factory=lambda _path, _profile: object(),
            server_factory=lambda _app, _port: server,
            thread_factory=ImmediateThread,
            emit=lambda _message, **_kwargs: None,
        )

    assert "private server detail" not in str(raised.value)
    assert server.should_exit is True
    assert events[-1] == "socket-close"


def test_background_thread_start_failure_is_typed_and_cleans_up() -> None:
    events: list[str] = []
    listener = FakeListener(events)
    server = FakeServer(events)

    class BrokenThread(ImmediateThread):
        def start(self) -> None:
            raise RuntimeError("private thread detail")

    with pytest.raises(AnalyzerError, match="could not start browser fallback") as raised:
        launch_web(
            WebLaunchRequest(path=Path("calculation"), open_browser=False),
            listener_factory=lambda _port: listener,
            app_factory=lambda _path, _profile: object(),
            server_factory=lambda _app, _port: server,
            thread_factory=BrokenThread,
            emit=lambda _message, **_kwargs: None,
        )

    assert "private thread detail" not in str(raised.value)
    assert server.should_exit is True
    assert events[-1] == "socket-close"


def test_keyboard_interrupt_signals_joins_and_closes() -> None:
    events: list[str] = []
    listener = FakeListener(events)
    server = FakeServer(events)

    class InterruptThread(ImmediateThread):
        def start(self) -> None:
            server.started = True
            self.alive = True

        def join(self, timeout: float | None = None) -> None:
            self.joins.append(timeout)
            if len(self.joins) == 1:
                raise KeyboardInterrupt
            self.alive = False

    launch_web(
        WebLaunchRequest(path=Path("calculation"), open_browser=False),
        listener_factory=lambda _port: listener,
        app_factory=lambda _path, _profile: object(),
        server_factory=lambda _app, _port: server,
        thread_factory=InterruptThread,
        emit=lambda _message, **_kwargs: None,
    )

    assert server.should_exit is True
    assert events[-1] == "socket-close"
