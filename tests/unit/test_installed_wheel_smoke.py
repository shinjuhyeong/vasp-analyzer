import pytest

from scripts.verify_installed_wheel import (
    InstalledWheelSmokeError,
    validate_no_browser_result,
    validate_stdio_output,
)


def test_installed_stdio_smoke_requires_schema_3_result() -> None:
    validate_stdio_output(
        '{"id":1,"result":{"schemaVersion":3,"initialStructure":null,'
        '"ionicSteps":[{"scfIterations":1}]}}\n',
        expect_initial_structure=False,
    )

    with pytest.raises(InstalledWheelSmokeError, match="schema 3"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":2}}\n',
            expect_initial_structure=False,
        )


def test_installed_stdio_smoke_rejects_error_envelopes() -> None:
    with pytest.raises(InstalledWheelSmokeError, match="error"):
        validate_stdio_output(
            '{"id":1,"error":{"code":"outcar_format","message":"bad OUTCAR"}}\n',
            expect_initial_structure=False,
        )


def test_installed_stdio_smoke_requires_step_1_scf_iterations() -> None:
    with pytest.raises(InstalledWheelSmokeError, match="SCF iterations"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":3,"initialStructure":null,'
            '"ionicSteps":[{"scfIterations":null}]}}\n',
            expect_initial_structure=False,
        )


def test_installed_stdio_smoke_requires_poscar_initial_structure() -> None:
    validate_stdio_output(
        '{"id":1,"result":{"schemaVersion":3,'
        '"initialStructure":{"source":"POSCAR"},'
        '"ionicSteps":[{"scfIterations":1}]}}\n',
        expect_initial_structure=True,
    )

    with pytest.raises(InstalledWheelSmokeError, match="POSCAR"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":3,"initialStructure":null,'
            '"ionicSteps":[{"scfIterations":1}]}}\n',
            expect_initial_structure=True,
        )


def test_installed_stdio_smoke_requires_outcar_only_initial_structure_to_be_null() -> None:
    with pytest.raises(InstalledWheelSmokeError, match="OUTCAR-only"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":3,'
            '"initialStructure":{"source":"POSCAR"},'
            '"ionicSteps":[{"scfIterations":1}]}}\n',
            expect_initial_structure=False,
        )

    with pytest.raises(InstalledWheelSmokeError, match="OUTCAR-only"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":3,'
            '"ionicSteps":[{"scfIterations":1}]}}\n',
            expect_initial_structure=False,
        )


def test_installed_default_smoke_requires_handoff_error_without_loopback_url() -> None:
    validate_no_browser_result(
        2,
        "VS Code extension handoff unavailable; use --web only for explicit browser mode.",
    )

    with pytest.raises(InstalledWheelSmokeError, match="browser"):
        validate_no_browser_result(0, "http://127.0.0.1:8765")
