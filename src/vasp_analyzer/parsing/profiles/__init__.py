"""Declarative compatibility profiles for VASP parser dialects."""

from .loader import load_profile
from .models import (
    CompatibilityProfile,
    DetailMarkers,
    EnergyTermRule,
    NormalizationResult,
)
from .normalizer import normalize_poscar

__all__ = [
    "CompatibilityProfile",
    "DetailMarkers",
    "EnergyTermRule",
    "NormalizationResult",
    "load_profile",
    "normalize_poscar",
]
