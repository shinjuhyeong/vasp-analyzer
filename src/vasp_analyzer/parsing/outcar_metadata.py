"""Bounded best-effort OUTCAR metadata extraction independent of trajectories."""

from __future__ import annotations

import re
from pathlib import Path

from vasp_analyzer.core import (
    AnalyzerError,
    FrozenModel,
    ParameterOccurrence,
    ParserWarning,
)
from vasp_analyzer.parsing.profiles.models import OutcarRule
from vasp_analyzer.parsing.recovery import (
    parse_parameter_assignments,
    parse_pressure_line,
)

_MAX_LINE_BYTES = 1024 * 1024
_PARAMETER_ASSIGNMENT = re.compile(
    rb"^\s*[A-Za-z][A-Za-z0-9_.-]{0,63}\s*="
)


class OutcarMetadata(FrozenModel):
    parameters: tuple[ParameterOccurrence, ...] = ()
    pressure_details: tuple[tuple[float | None, float | None], ...] = ()
    warnings: tuple[ParserWarning, ...] = ()


def _contains(line: bytes, markers: tuple[str, ...]) -> bool:
    folded = line.lower()
    return any(marker.encode("utf-8").lower() in folded for marker in markers)


def _warning(message: str, line_number: int) -> ParserWarning:
    return ParserWarning(
        category="MetadataParseFailure",
        message=message,
        line_number=line_number,
    )


def read_outcar_metadata(path: Path, rule: OutcarRule) -> OutcarMetadata:
    """Read ordered parameters and pressure details without parsing trajectories."""

    parameters: list[ParameterOccurrence] = []
    pressure_details: list[tuple[float | None, float | None]] = []
    warnings: list[ParserWarning] = []
    parameter_section_active = False
    with path.open("rb") as stream:
        line_number = 0
        while True:
            raw = stream.readline(_MAX_LINE_BYTES + 1)
            if not raw:
                break
            line_number += 1
            if len(raw) > _MAX_LINE_BYTES and not raw.endswith((b"\n", b"\r")):
                warnings.append(
                    _warning(
                        f"OUTCAR metadata line exceeds {_MAX_LINE_BYTES} bytes",
                        line_number,
                    )
                )
                while raw and not raw.endswith((b"\n", b"\r")):
                    raw = stream.readline(_MAX_LINE_BYTES + 1)
                parameter_section_active = False
                continue

            if _contains(raw, rule.details.parameter_sections):
                parameter_section_active = True
                continue
            if parameter_section_active and _contains(
                raw, rule.details.parameter_section_end
            ):
                parameter_section_active = False
            elif parameter_section_active and _PARAMETER_ASSIGNMENT.match(raw):
                try:
                    parameters.extend(
                        parse_parameter_assignments(
                            raw,
                            start_ordinal=len(parameters),
                            line_number=line_number,
                        )
                    )
                except (AnalyzerError, ValueError) as error:
                    warnings.append(
                        _warning(f"ignored malformed parameter metadata: {error}", line_number)
                    )

            try:
                pressure = parse_pressure_line(raw, rule)
            except (AnalyzerError, ValueError) as error:
                warnings.append(
                    _warning(f"ignored malformed pressure metadata: {error}", line_number)
                )
                pressure_details.append((None, None))
            else:
                if pressure is not None:
                    pressure_details.append(pressure)

    return OutcarMetadata(
        parameters=tuple(parameters),
        pressure_details=tuple(pressure_details),
        warnings=tuple(warnings),
    )


__all__ = ["OutcarMetadata", "read_outcar_metadata"]
