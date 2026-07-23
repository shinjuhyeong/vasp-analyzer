"""Built-in dialect for ordinary VASP output."""

from vasp_analyzer.parsing.profiles import CompatibilityProfile

from .base import Dialect

_STANDARD_PROFILE = CompatibilityProfile(
    schema_version=1,
    id="standard",
    display_name="Standard VASP",
    detection={"outcar_contains": ("vasp.",), "priority": 10},
    outcar={
        "details": {
            "iteration": {
                "prefix": "Iteration",
                "ionic_group": r"\d+",
                "electronic_group": r"\d+",
            },
            "volume_basis_section": (b"VOLUME and BASIS-vectors are now",),
            "optimizer_diagnostics": ("d Force",),
        }
    },
)

STANDARD = Dialect(
    id=_STANDARD_PROFILE.id,
    display_name=_STANDARD_PROFILE.display_name,
    markers=_STANDARD_PROFILE.detection.outcar_contains,
    priority=_STANDARD_PROFILE.detection.priority,
    profile=_STANDARD_PROFILE,
)
