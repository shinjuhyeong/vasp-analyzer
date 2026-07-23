"""Deterministic registry and selection for supported VASP dialects."""

from vasp_analyzer.core import UnsupportedDialect
from vasp_analyzer.parsing.profiles import CompatibilityProfile

from .base import Dialect, DialectMatch
from .home_barrier import HOME_BARRIER
from .standard import STANDARD

BUILT_INS = (STANDARD, HOME_BARRIER)


def profile_dialect(profile: CompatibilityProfile) -> Dialect:
    """Adapt a validated compatibility profile to a selectable dialect."""
    return Dialect(
        id=profile.id,
        display_name=profile.display_name,
        markers=profile.detection.outcar_contains,
        priority=profile.detection.priority,
        profile=profile,
    )


def detect_dialect(
    outcar_head: str,
    forced_profile: CompatibilityProfile | None = None,
) -> DialectMatch:
    """Select the highest-priority dialect matching literal header markers."""
    if forced_profile is not None:
        return DialectMatch(
            profile_dialect(forced_profile),
            forced_profile.detection.priority,
            (),
        )

    matches = [
        DialectMatch(
            dialect,
            dialect.priority,
            tuple(marker for marker in dialect.markers if marker in outcar_head),
        )
        for dialect in BUILT_INS
        if any(marker in outcar_head for marker in dialect.markers)
    ]
    if not matches:
        raise UnsupportedDialect(
            "no supported OUTCAR marker; pass --profile with a validated TOML profile"
        )
    return max(matches, key=lambda item: (item.score, item.dialect.id))
