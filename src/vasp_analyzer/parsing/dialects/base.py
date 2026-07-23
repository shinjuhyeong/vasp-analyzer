"""Core immutable models for VASP parser dialect selection."""

from dataclasses import dataclass

from vasp_analyzer.parsing.profiles import CompatibilityProfile


@dataclass(frozen=True)
class Dialect:
    """A named VASP syntax dialect backed by a compatibility profile."""

    id: str
    display_name: str
    markers: tuple[str, ...]
    priority: int
    profile: CompatibilityProfile


@dataclass(frozen=True)
class DialectMatch:
    """The selected dialect and the literal evidence used to select it."""

    dialect: Dialect
    score: int
    markers: tuple[str, ...]
