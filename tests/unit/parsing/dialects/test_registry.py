"""Deterministic selection tests for built-in and forced VASP dialects."""

import pytest

from vasp_analyzer.core import UnsupportedDialect
from vasp_analyzer.parsing.dialects import detect_dialect
from vasp_analyzer.parsing.profiles import CompatibilityProfile


def test_home_barrier_marker_wins_over_standard() -> None:
    match = detect_dialect("vasp.5.4.1-barrier build\n")

    assert (match.dialect.id, match.score, match.markers) == (
        "home_barrier",
        100,
        ("vasp.5.4.1-barrier",),
    )


def test_standard_vasp_header_selects_standard() -> None:
    match = detect_dialect("vasp.6.5.1 build\n")

    assert (match.dialect.id, match.score, match.markers) == (
        "standard",
        10,
        ("vasp.",),
    )


def test_forced_profile_bypasses_header_detection() -> None:
    profile = CompatibilityProfile(
        schema_version=1,
        id="custom",
        display_name="Custom VASP",
        detection={"outcar_contains": ["custom marker"], "priority": 73},
    )

    match = detect_dialect("unrelated output\n", forced_profile=profile)

    assert match.dialect.profile is profile
    assert (match.dialect.id, match.score, match.markers) == ("custom", 73, ())


def test_unknown_header_fails_with_actionable_error() -> None:
    with pytest.raises(UnsupportedDialect, match="no supported OUTCAR marker"):
        detect_dialect("unrelated output\n")
