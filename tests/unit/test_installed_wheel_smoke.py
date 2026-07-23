import pytest

from scripts.verify_installed_wheel import (
    InstalledWheelSmokeError,
    validate_normalizer_cli_outputs,
    validate_no_browser_result,
    validate_stdio_output,
)

PROVENANCE = '"provenance":{"adapter":"vaspparser"},'


def test_installed_stdio_smoke_requires_schema_4_result() -> None:
    validate_stdio_output(
        '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE + '"initialStructure":null,'
        '"ionicSteps":[{"scfIterations":1}]}}\n',
        expect_initial_structure=False,
    )

    with pytest.raises(InstalledWheelSmokeError, match="schema 4"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":2,' + PROVENANCE + '"ionicSteps":[]}}\n',
            expect_initial_structure=False,
        )


def test_installed_stdio_smoke_requires_clean_typed_parameter_metadata() -> None:
    output = (
        '{"id":1,"result":{"schemaVersion":4,'
        + PROVENANCE
        + '"initialStructure":null,'
        '"ionicSteps":[{"scfIterations":1}],'
        '"parameters":['
        '{"key":"encut","rawValue":"600.0 eV 44.10 Ry",'
        '"value":600.0,"unit":"eV"}]}}\n'
    )

    validate_stdio_output(
        output,
        expect_initial_structure=False,
        expected_parameters={"encut": (600.0, "eV")},
    )

    with pytest.raises(InstalledWheelSmokeError, match="parameter encut"):
        validate_stdio_output(
            output,
            expect_initial_structure=False,
            expected_parameters={"encut": ("600.0 eV 44.10 Ry", "eV")},
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
            '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE + '"initialStructure":null,'
            '"ionicSteps":[{"scfIterations":null}]}}\n',
            expect_initial_structure=False,
        )


def test_installed_stdio_smoke_requires_exact_step_count_and_all_scf_iterations() -> None:
    validate_stdio_output(
        '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE + '"initialStructure":null,'
        '"ionicSteps":[{"scfIterations":1},{"scfIterations":2}]}}\n',
        expect_initial_structure=False,
        expected_steps=2,
    )

    with pytest.raises(InstalledWheelSmokeError, match="2 ionic steps"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE + '"initialStructure":null,'
            '"ionicSteps":[{"scfIterations":1}]}}\n',
            expect_initial_structure=False,
            expected_steps=2,
        )

    with pytest.raises(InstalledWheelSmokeError, match="SCF iterations"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE + '"initialStructure":null,'
            '"ionicSteps":[{"scfIterations":1},{"scfIterations":null}]}}\n',
            expect_initial_structure=False,
            expected_steps=2,
        )


def test_installed_stdio_smoke_requires_poscar_initial_structure() -> None:
    validate_stdio_output(
        '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE +
        '"initialStructure":{"source":"POSCAR"},'
        '"ionicSteps":[{"scfIterations":1}]}}\n',
        expect_initial_structure=True,
    )

    with pytest.raises(InstalledWheelSmokeError, match="POSCAR"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE + '"initialStructure":null,'
            '"ionicSteps":[{"scfIterations":1}]}}\n',
            expect_initial_structure=True,
        )


def test_installed_stdio_smoke_requires_outcar_only_initial_structure_to_be_null() -> None:
    with pytest.raises(InstalledWheelSmokeError, match="OUTCAR-only"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE +
            '"initialStructure":{"source":"POSCAR"},'
            '"ionicSteps":[{"scfIterations":1}]}}\n',
            expect_initial_structure=False,
        )

    with pytest.raises(InstalledWheelSmokeError, match="OUTCAR-only"):
        validate_stdio_output(
            '{"id":1,"result":{"schemaVersion":4,' + PROVENANCE +
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


def test_installed_normalizer_cli_requires_resources_and_safe_test_report() -> None:
    listed = {
        "schemaVersion": 1,
        "normalizers": [
            {"id": "home-barrier", "builtIn": True},
            {"id": "standard", "builtIn": True},
        ],
    }
    validated = {
        "schemaVersion": 1,
        "id": "candidate",
        "valid": True,
    }
    tested = {
        "schemaVersion": 1,
        "sourceHashVerified": True,
        "temporaryCleaned": True,
        "summary": {"adapter": "vaspparser", "ionicSteps": 1, "atomCount": 2},
        "manifest": {"normalizerId": "candidate", "sourceSha256": "abc"},
    }

    validate_normalizer_cli_outputs(
        listed,
        validated,
        tested,
        candidate_id="candidate",
        source_sha256="abc",
    )

    tested["temporaryCleaned"] = False
    with pytest.raises(InstalledWheelSmokeError, match="safely wired"):
        validate_normalizer_cli_outputs(
            listed,
            validated,
            tested,
            candidate_id="candidate",
            source_sha256="abc",
        )
