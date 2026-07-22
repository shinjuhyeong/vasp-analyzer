"""Pure parsers for bounded, declaratively recognized OUTCAR detail lines."""

from __future__ import annotations

import math
import re
from typing import Literal

from vasp_analyzer.core import EnergyTerm, Mat3, OutcarFormatError, ParameterOccurrence
from vasp_analyzer.parsing.profiles.models import OutcarRule

_NUMBER_TEXT = rb"[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?|inf(?:inity)?|nan)"
_NUMBER = re.compile(rb"^" + _NUMBER_TEXT + rb"$", re.IGNORECASE)
_ASSIGNMENT = re.compile(
    rb"^\s*(?P<label>[^=\r\n]+?)\s*=\s*(?P<values>.+?)\s*$"
)
_PARAMETER_START = re.compile(
    rb"(?<!\S)(?P<key>[A-Za-z][A-Za-z0-9_.-]{0,63})\s*=\s*"
)
_UNIT = re.compile(rb"^[A-Za-z][A-Za-z0-9_./^*-]{0,31}$")
_KNOWN_PARAMETER_UNITS = {
    b"a",
    b"angstrom",
    b"ev",
    b"ev/angstrom",
    b"fs",
    b"k",
    b"kb",
    b"rad",
    b"s",
    b"sec",
}

# Canonical VASP metadata enriches only presentation fields. The exact key and
# value text emitted by OUTCAR remain untouched for raw inspection.
_PARAMETER_METADATA: dict[str, tuple[str, str, str | None]] = {
    "encut": ("electronic", "Plane-wave cutoff energy", "eV"),
    "ediff": ("electronic", "Electronic convergence tolerance", "eV"),
    "nelm": ("electronic", "Maximum electronic iterations", None),
    "algo": ("electronic", "Electronic minimization algorithm", None),
    "ibrion": ("ionic", "Ionic update algorithm", None),
    "nsw": ("ionic", "Maximum ionic steps", None),
    "isif": ("ionic", "Ionic relaxation degrees of freedom", None),
    "ispin": ("spin", "Spin-polarization mode", None),
    "magmom": ("spin", "Initial magnetic moments", None),
    "lsorbit": ("spin", "Enable spin-orbit coupling", None),
    "gga": ("exchange-correlation", "Generalized-gradient functional", None),
    "metagga": ("exchange-correlation", "Meta-GGA functional", None),
    "lhfcalc": ("exchange-correlation", "Enable hybrid-functional calculation", None),
    "ncore": ("parallelization", "Bands distributed per orbital group", None),
    "npar": ("parallelization", "Band parallelization groups", None),
    "kpar": ("parallelization", "k-point parallelization groups", None),
    "lplane": ("parallelization", "Plane-wise FFT distribution", None),
    "lwave": ("output", "Write WAVECAR output", None),
    "lcharg": ("output", "Write CHGCAR output", None),
    "lorbit": ("output", "Orbital-projection output mode", None),
    "nwrite": ("output", "OUTCAR verbosity level", None),
}


def _parameter_metadata(
    key: str, value: bool | int | float | str | tuple[float, ...]
) -> tuple[str, str, str | None] | None:
    if key != "ediffg":
        return _PARAMETER_METADATA.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return (
            "ionic",
            "Ionic convergence threshold (uninterpreted)",
            None,
        )
    if value > 0:
        return (
            "ionic",
            "Ionic convergence threshold: energy-change criterion",
            "eV",
        )
    if value < 0:
        return (
            "ionic",
            "Ionic convergence threshold: force criterion",
            "eV/angstrom",
        )
    return "ionic", "Ionic convergence criterion disabled", None


def _decode(value: bytes, *, context: str) -> str:
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError as error:
        raise OutcarFormatError(f"{context} is not valid UTF-8") from error


def _normalized_text(value: str) -> str:
    return " ".join(value.split())


def _canonical_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", value.casefold()).strip("_")
    if not key:
        raise OutcarFormatError("detail label has no canonical characters")
    return key[:64]


def _finite_float(token: bytes, *, context: str) -> float:
    try:
        value = float(token.replace(b"D", b"E").replace(b"d", b"e"))
    except ValueError as error:
        raise OutcarFormatError(f"{context} is not numeric") from error
    if not math.isfinite(value):
        raise OutcarFormatError(f"{context} is non-finite")
    return value


def _marker_present(line: bytes, markers: tuple[str, ...]) -> bool:
    folded = line.lower()
    return any(marker.encode("utf-8").lower() in folded for marker in markers)


def _literal_alias_pattern(markers: tuple[str, ...]) -> bytes:
    patterns = []
    for marker in markers:
        tokens = marker.encode("utf-8").split()
        patterns.append(rb"\s+".join(re.escape(token) for token in tokens))
    return rb"(?:" + rb"|".join(patterns) + rb")"


def parse_energy_line(line: bytes, rule: OutcarRule) -> EnergyTerm | None:
    """Parse one complete energy assignment, preserving unknown finite labels."""
    match = _ASSIGNMENT.fullmatch(line.rstrip(b"\r\n"))
    if match is None:
        return None
    raw_label = _normalized_text(_decode(match.group("label"), context="energy label"))
    tokens = match.group("values").split()
    value_tokens: list[bytes] = []
    for token in tokens:
        if _NUMBER.fullmatch(token) is None:
            break
        value_tokens.append(token)
    if not value_tokens:
        raise OutcarFormatError("energy assignment has no numeric value")
    trailing = tokens[len(value_tokens) :]
    if trailing not in ([], [b"eV"]):
        raise OutcarFormatError("energy assignment has unsupported trailing syntax")
    values = tuple(_finite_float(token, context="energy value") for token in value_tokens)
    aliases = {
        _normalized_text(label).casefold(): item
        for item in rule.energy_terms
        for label in item.labels
    }
    matched_rule = aliases.get(raw_label.casefold())
    return EnergyTerm(
        key=matched_rule.key if matched_rule else _canonical_key(raw_label),
        raw_label=raw_label,
        value=sum(values),
        unit="eV",
        kind=matched_rule.kind if matched_rule else "contribution",
    )


def parse_pressure_line(
    line: bytes, rule: OutcarRule
) -> tuple[float | None, float | None] | None:
    """Parse VASP external pressure and optional (historically misspelled) Pulay stress."""
    if not _marker_present(line, rule.details.external_pressure):
        return None
    pattern = (
        rb"\s*"
        + _literal_alias_pattern(rule.details.external_pressure)
        + rb"\s*=\s*("
        + _NUMBER_TEXT
        + rb")\s+(?-i:kB)"
        + rb"(?:\s+Pu(?:l|ll)ay\s+stress\s*=\s*("
        + _NUMBER_TEXT
        + rb")\s+(?-i:kB))?\s*"
    )
    match = re.fullmatch(pattern, line.rstrip(b"\r\n"), re.IGNORECASE)
    if match is None:
        raise OutcarFormatError("external pressure line is malformed")
    external = _finite_float(match.group(1), context="external pressure")
    pulay = (
        _finite_float(match.group(2), context="Pulay stress")
        if match.group(2) is not None
        else None
    )
    return external, pulay


def parse_volume_line(line: bytes, rule: OutcarRule) -> float | None:
    """Parse a positive cell volume from a recognized volume line."""
    if not _marker_present(line, rule.details.cell_volume):
        return None
    match = re.search(
        rb"(?:=|:)\s*(" + _NUMBER_TEXT + rb")\s*$",
        line.rstrip(b"\r\n"),
        re.IGNORECASE,
    )
    if match is None:
        raise OutcarFormatError("cell volume line is malformed")
    value = _finite_float(match.group(1), context="cell volume")
    if value <= 0:
        raise OutcarFormatError("cell volume must be positive")
    return value


def parse_stress_rows(
    rows: tuple[bytes, ...], *, unit: Literal["kB"] | None = None
) -> Mat3:
    """Parse explicitly kB VASP rows or a 3x3 tensor with validated kB context."""
    if len(rows) == 1:
        tokens = rows[0].split()
        if len(tokens) >= 2 and tokens[0].lower() == b"in" and tokens[1].lower() == b"kb":
            tokens = tokens[2:]
        else:
            raise OutcarFormatError("six-component stress row must start with 'in kB'")
        if len(tokens) != 6:
            raise OutcarFormatError("stress row must contain six components")
        xx, yy, zz, xy, yz, zx = (
            _finite_float(token, context="stress component") for token in tokens
        )
        return ((xx, xy, zx), (xy, yy, yz), (zx, yz, zz))
    if len(rows) != 3:
        raise OutcarFormatError("stress tensor must contain one six-component or three rows")
    if unit != "kB":
        raise OutcarFormatError("3x3 stress tensor requires explicit kB context")
    parsed: list[tuple[float, float, float]] = []
    for row in rows:
        tokens = row.split()
        if len(tokens) != 3:
            raise OutcarFormatError("stress tensor rows must contain three components")
        values = tuple(_finite_float(token, context="stress component") for token in tokens)
        parsed.append((values[0], values[1], values[2]))
    return parsed[0], parsed[1], parsed[2]


def _coerce_parameter_value(
    raw: bytes,
) -> tuple[bool | int | float | str | tuple[float, ...], str | None]:
    text = _decode(raw, context="parameter value").strip()
    folded = text.casefold()
    if folded in {"t", ".true.", "true"}:
        return True, None
    if folded in {"f", ".false.", "false"}:
        return False, None
    tokens = raw.split()
    unit: str | None = None
    numeric_tokens = tokens
    if (
        len(tokens) >= 2
        and _NUMBER.fullmatch(tokens[0]) is not None
        and _UNIT.fullmatch(tokens[-1]) is not None
        and tokens[-1].lower() in _KNOWN_PARAMETER_UNITS
    ):
        numeric_tokens = tokens[:-1]
        unit = tokens[-1].decode("ascii")
    if numeric_tokens and all(
        _NUMBER.fullmatch(token) is not None for token in numeric_tokens
    ):
        values = tuple(
            _finite_float(token, context="parameter value") for token in numeric_tokens
        )
        if len(values) > 1:
            return values, unit
        token_text = numeric_tokens[0].decode("ascii")
        if re.fullmatch(r"[+-]?\d+", token_text):
            return int(token_text), unit
        return values[0], unit
    return text, None


def parse_parameter_assignments(
    line: bytes, *, start_ordinal: int = 0, line_number: int | None = None
) -> tuple[ParameterOccurrence, ...]:
    """Parse exact VASP assignments while retaining their source order."""
    if start_ordinal < 0:
        raise ValueError("start_ordinal must be nonnegative")
    parsed: list[ParameterOccurrence] = []
    content = line.rstrip(b"\r\n")
    matches = tuple(_PARAMETER_START.finditer(content))
    if not matches:
        if b"=" in content:
            raise OutcarFormatError("parameter assignment is malformed")
        return ()
    prefix = content[: matches[0].start()].strip(b" \t;")
    if prefix:
        raise OutcarFormatError("parameter assignment is malformed")
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        raw_bytes = content[match.end() : end].strip()
        if raw_bytes.endswith(b";"):
            raw_bytes = raw_bytes[:-1].rstrip()
        if not raw_bytes or b"=" in raw_bytes or b";" in raw_bytes:
            raise OutcarFormatError("parameter assignment is malformed")
        raw_key = _decode(match.group("key"), context="parameter key")
        raw_value = _decode(raw_bytes, context="parameter value").strip()
        value, unit = _coerce_parameter_value(raw_bytes)
        key = _canonical_key(raw_key)
        metadata = _parameter_metadata(key, value)
        parsed.append(
            ParameterOccurrence(
                key=key,
                raw_key=raw_key,
                raw_value=raw_value,
                value=value,
                unit=metadata[2] if metadata is not None else unit,
                category=metadata[0] if metadata is not None else None,
                description=metadata[1] if metadata is not None else None,
                ordinal=start_ordinal + len(parsed),
                line_number=line_number,
            )
        )
    return tuple(parsed)


__all__ = [
    "parse_energy_line",
    "parse_parameter_assignments",
    "parse_pressure_line",
    "parse_stress_rows",
    "parse_volume_line",
]
