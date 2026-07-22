import pytest

from scripts.verify_installed_wheel import (
    InstalledWheelSmokeError,
    validate_no_browser_result,
    validate_stdio_output,
)


def test_installed_stdio_smoke_requires_schema_3_result() -> None:
    validate_stdio_output('{"id":1,"result":{"schemaVersion":3}}\n')

    with pytest.raises(InstalledWheelSmokeError, match="schema 3"):
        validate_stdio_output('{"id":1,"result":{"schemaVersion":2}}\n')


def test_installed_default_smoke_requires_handoff_error_without_loopback_url() -> None:
    validate_no_browser_result(
        2,
        "VS Code extension handoff unavailable; use --web only for explicit browser mode.",
    )

    with pytest.raises(InstalledWheelSmokeError, match="browser"):
        validate_no_browser_result(0, "http://127.0.0.1:8765")
