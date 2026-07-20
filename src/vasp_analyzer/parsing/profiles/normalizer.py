"""Narrow, declarative POSCAR compatibility normalization."""

from vasp_analyzer.core import MalformedBlock

from .models import CompatibilityProfile, NormalizationResult

_DROP_RULE_NAME = "poscar.drop_exact_line_after"
_COORDINATE_MODES = frozenset({"direct", "cartesian"})


def _line_content(line: str) -> str:
    return line.removesuffix("\n").removesuffix("\r")


def _validate_coordinate_mode(lines: list[str], index: int) -> None:
    if index >= len(lines):
        raise MalformedBlock(
            f"Expected Direct or Cartesian coordinate mode at line {index + 1}, "
            "found <end of file>"
        )

    content = _line_content(lines[index])
    if content.strip().casefold() not in _COORDINATE_MODES:
        raise MalformedBlock(
            f"Expected Direct or Cartesian coordinate mode at line {index + 1}, "
            f"found {content!r}"
        )


def normalize_poscar(text: str, profile: CompatibilityProfile) -> NormalizationResult:
    """Apply the profile's supported exact-line POSCAR normalization rule."""
    rule = profile.poscar
    anchor = rule.drop_exact_line_after
    dropped_line = rule.drop_exact_line
    if anchor is None or dropped_line is None:
        return NormalizationResult(text=text)

    lines = text.splitlines(keepends=True)
    try:
        anchor_index = next(
            index for index, line in enumerate(lines) if _line_content(line) == anchor
        )
    except StopIteration:
        return NormalizationResult(text=text)

    candidate_index = anchor_index + 1
    if candidate_index >= len(lines):
        _validate_coordinate_mode(lines, candidate_index)

    candidate = _line_content(lines[candidate_index])
    if candidate != dropped_line:
        _validate_coordinate_mode(lines, candidate_index)
        return NormalizationResult(text=text)

    coordinate_mode_index = candidate_index + 1
    _validate_coordinate_mode(lines, coordinate_mode_index)
    del lines[candidate_index]
    return NormalizationResult(
        text="".join(lines),
        applied_rules=(_DROP_RULE_NAME,),
        compatibility_metadata=(candidate,),
    )
