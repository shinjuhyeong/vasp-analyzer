"""Strict loading for declarative parser compatibility profiles."""

import tomllib
from pathlib import Path

from pydantic import ValidationError

from vasp_analyzer.core import ProfileValidationError

from .models import CompatibilityProfile


def load_profile(path: Path) -> CompatibilityProfile:
    """Load a supported compatibility profile or reject it as invalid."""
    try:
        source = path.read_text(encoding="utf-8")
        return CompatibilityProfile.model_validate(tomllib.loads(source))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError, ValidationError) as exc:
        raise ProfileValidationError(f"Invalid profile {path.name}: {exc}") from exc
