"""Declarative compatibility profiles for VASP parser dialects."""

from .loader import load_profile
from .models import (
    CompatibilityProfile,
    DetailMarkers,
    EnergyTermRule,
    IterationPattern,
    NormalizationResult,
)
from .normalizer import normalize_poscar

__all__ = [
    "CompatibilityProfile",
    "DetailMarkers",
    "EnergyTermRule",
    "IterationPattern",
    "NormalizationResult",
    "load_profile",
    "normalize_poscar",
]
