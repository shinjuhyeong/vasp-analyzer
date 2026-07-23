"""Built-in dialect for the observed home-barrier VASP build."""

from vasp_analyzer.parsing.profiles import CompatibilityProfile

from .base import Dialect

_HOME_BARRIER_PROFILE = CompatibilityProfile(
    schema_version=1,
    id="home_barrier",
    display_name="Home Barrier VASP",
    detection={"outcar_contains": ("vasp.5.4.1-barrier",), "priority": 100},
    poscar={
        "drop_exact_line_after": "Selective dynamics",
        "drop_exact_line": "0",
    },
    validation={"force_prefix_columns": 2},
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

HOME_BARRIER = Dialect(
    id=_HOME_BARRIER_PROFILE.id,
    display_name=_HOME_BARRIER_PROFILE.display_name,
    markers=_HOME_BARRIER_PROFILE.detection.outcar_contains,
    priority=_HOME_BARRIER_PROFILE.detection.priority,
    profile=_HOME_BARRIER_PROFILE,
)
