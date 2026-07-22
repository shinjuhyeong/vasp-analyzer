"""Single-pass, byte-oriented indexing of complete OUTCAR ionic records."""

from __future__ import annotations

import math
import re
from enum import Enum
from hashlib import sha256
from pathlib import Path

from vasp_analyzer.core import (
    EnergyTerm,
    FrozenModel,
    Mat3,
    OutcarFormatError,
    ParameterOccurrence,
    ParserWarning,
    Vec3,
)
from vasp_analyzer.parsing.dialects import Dialect

from .checkpoint import (
    ParserCheckpoint,
    _hash_prefix_and_count_lines,
    checkpoint_is_append_only,
)
from .details import (
    parse_energy_line,
    parse_parameter_assignments,
    parse_pressure_line,
    parse_stress_rows,
    parse_volume_line,
)

_NIONS = re.compile(rb"\bNIONS\s*=\s*(\d+)\b", re.IGNORECASE)
_VRHFIN = re.compile(rb"\bVRHFIN\s*=\s*([A-Z][a-z]?)\s*:")
_IONS_PER_TYPE = re.compile(rb"\bions\s+per\s+type\s*=\s*(.+)$", re.IGNORECASE)
_ENERGY = re.compile(rb"=\s*([^\s]+)")
_LATTICE_MARKER = b"direct lattice vectors"
_NORMAL_FINISH_MARKER = b"general timing and accounting"
_PARAMETER_ASSIGNMENT_LINE = re.compile(rb"^\s*[A-Za-z][A-Za-z0-9_.-]{0,63}\s*=")
_ENERGY_ASSIGNMENT_LINE = re.compile(rb"^\s*(?=[^=\r\n]*[A-Za-z0-9])[^=\r\n]+?=")
_COMBINED_ENERGY_AGGREGATES = re.compile(
    rb"^\s*energy\s+without\s+entropy\s*=\s*([^\s]+)(?:\s+eV)?\s+"
    rb"energy\(sigma->0\)\s*=\s*([^\s]+)(?:\s+eV)?\s*$",
    re.IGNORECASE,
)
_SCIENTIFIC_NUMBER = rb"[+-]?(?:\d+(?:\.\d*)?|\.\d+)[EeDd][+-]?\d+"
_OPTIMIZER_DIAGNOSTIC = re.compile(
    rb"^\s*d\s+Force\s*=\s*(" + _SCIENTIFIC_NUMBER + rb")\s*"
    rb"\[\s*(" + _SCIENTIFIC_NUMBER + rb")\s*,\s*(" + _SCIENTIFIC_NUMBER + rb")\s*\]\s*"
    rb"d\s+(?:Energy|Ewald)\s*=\s*(" + _SCIENTIFIC_NUMBER + rb")\s*"
    rb"(" + _SCIENTIFIC_NUMBER + rb")\s*$",
    re.IGNORECASE,
)


class _EnergyPhase(Enum):
    CLOSED = "closed"
    AWAITING_SEPARATOR = "awaiting_separator"
    BODY = "body"


class _NonNumericRow(OutcarFormatError):
    pass


class _NonFiniteRow(OutcarFormatError):
    pass


class StepRecord(FrozenModel):
    step_id: int
    block_start: int
    block_end: int
    atom_count: int
    lattice: Mat3
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    energy: float | None
    energy_terms: tuple[EnergyTerm, ...] = ()
    external_pressure_kb: float | None = None
    pulay_stress_kb: float | None = None
    stress_tensor_kb: Mat3 | None = None
    cell_volume: float | None = None
    scf_iterations: int | None = None
    electronic_converged: bool | None = None
    ionic_converged: bool | None = None

    @property
    def index(self) -> int:
        """Expose the analyzer's zero-based step index."""

        return self.step_id


class ScanResult(FrozenModel):
    steps: tuple[StepRecord, ...]
    parameters: tuple[ParameterOccurrence, ...] = ()
    warnings: tuple[ParserWarning, ...]
    checkpoint: ParserCheckpoint
    resumed_from: int
    normally_finished: bool
    species: tuple[str, ...] = ()
    force_prefix_columns: int = 0
    position_force_markers: tuple[str, ...] = ("POSITION", "TOTAL-FORCE")


def _contains_all(line: bytes, markers: tuple[str, ...]) -> bool:
    lowered = line.lower()
    return bool(markers) and all(marker.encode("utf-8").lower() in lowered for marker in markers)


def _contains_any(line: bytes, markers: tuple[str, ...]) -> bool:
    lowered = line.lower()
    return any(marker.encode("utf-8").lower() in lowered for marker in markers)


def _combined_energy_terms(line: bytes, dialect: Dialect) -> tuple[EnergyTerm, EnergyTerm] | None:
    """Tokenize VASP's two assignments on its combined entropy/sigma line."""

    match = _COMBINED_ENERGY_AGGREGATES.fullmatch(line.rstrip(b"\r\n"))
    if match is None:
        return None
    without_entropy = parse_energy_line(
        b"energy without entropy = " + match.group(1) + b" eV\n",
        dialect.profile.outcar,
    )
    sigma_to_zero = parse_energy_line(
        b"energy(sigma->0) = " + match.group(2) + b" eV\n",
        dialect.profile.outcar,
    )
    if without_entropy is None or sigma_to_zero is None:  # pragma: no cover - invariant
        raise OutcarFormatError("combined energy aggregate line is malformed")
    return without_entropy, sigma_to_zero


def _is_hyphen_separator(line: bytes) -> bool:
    stripped = line.strip()
    return len(stripped) >= 10 and not stripped.strip(b"-")


def _is_optimizer_diagnostic(
    line: bytes, prefixes: tuple[str, ...], *, offset: int
) -> bool:
    stripped = line.rstrip(b"\r\n")
    if not any(stripped.lstrip().lower().startswith(prefix.encode().lower()) for prefix in prefixes):
        return False
    match = _OPTIMIZER_DIAGNOSTIC.fullmatch(stripped)
    if match is None:
        raise OutcarFormatError(f"optimizer diagnostic at byte {offset} is malformed")
    _finite_numbers(
        b" ".join(match.groups()), context="optimizer diagnostic", offset=offset
    )
    return True


def _finite_numbers(line: bytes, *, context: str, offset: int) -> tuple[float, ...]:
    values: list[float] = []
    for token in line.split():
        try:
            value = float(token.replace(b"D", b"E").replace(b"d", b"e"))
        except ValueError as error:
            raise _NonNumericRow(
                f"{context} at byte {offset} contains a non-numeric value"
            ) from error
        if not math.isfinite(value):
            raise _NonFiniteRow(f"{context} at byte {offset} contains a non-finite value")
        values.append(value)
    return tuple(values)


def _force_values(line: bytes, dialect: Dialect, *, offset: int) -> tuple[float, ...]:
    tokens = line.split()
    expected = dialect.profile.validation.expected_force_columns
    prefix = dialect.profile.validation.force_prefix_columns
    if prefix and len(tokens) == expected + prefix:
        tokens = tokens[prefix:]
    return _finite_numbers(b" ".join(tokens), context="position/force row", offset=offset)


def _looks_like_force_row(line: bytes, dialect: Dialect, *, offset: int) -> bool:
    expected = dialect.profile.validation.expected_force_columns
    prefix = dialect.profile.validation.force_prefix_columns
    if len(line.split()) not in ({expected, expected + prefix} if prefix else {expected}):
        return False
    try:
        values = _force_values(line, dialect, offset=offset)
    except OutcarFormatError:
        return False
    return len(values) == expected


def _collapse_repeated_elements(
    element_types: list[str], type_count: int
) -> tuple[str, ...] | None:
    if type_count <= 0 or len(element_types) % type_count:
        return None
    groups = tuple(
        tuple(element_types[start : start + type_count])
        for start in range(0, len(element_types), type_count)
    )
    return groups[0] if groups and all(group == groups[0] for group in groups) else None


def _mat3(rows: list[tuple[float, ...]], offset: int) -> Mat3:
    if len(rows) != 3 or any(len(row) != 6 for row in rows):
        raise OutcarFormatError(
            f"lattice at byte {offset} must contain three six-column numeric rows"
        )
    lattice: Mat3 = (
        (rows[0][0], rows[0][1], rows[0][2]),
        (rows[1][0], rows[1][1], rows[1][2]),
        (rows[2][0], rows[2][1], rows[2][2]),
    )
    a, b, c = lattice
    determinant = (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )
    if not math.isfinite(determinant) or determinant == 0.0:
        raise OutcarFormatError(f"lattice at byte {offset} is singular")
    return lattice


def _empty_details() -> dict[str, object]:
    return {
        "energy_terms": [],
        "external_pressure_kb": None,
        "pulay_stress_kb": None,
        "stress_tensor_kb": None,
        "cell_volume": None,
    }


def _step(
    *,
    step_id: int,
    block_start: int,
    block_end: int,
    atom_count: int,
    lattice: Mat3,
    positions: tuple[Vec3, ...],
    forces: tuple[Vec3, ...],
    energy: float | None,
    energy_terms: tuple[EnergyTerm, ...],
    external_pressure_kb: float | None,
    pulay_stress_kb: float | None,
    stress_tensor_kb: Mat3 | None,
    cell_volume: float | None,
    scf_iterations: int | None,
    ionic_converged: bool | None,
) -> StepRecord:
    return StepRecord(
        step_id=step_id,
        block_start=block_start,
        block_end=block_end,
        atom_count=atom_count,
        lattice=lattice,
        cartesian_positions=positions,
        raw_forces=forces,
        energy=energy,
        energy_terms=energy_terms,
        external_pressure_kb=external_pressure_kb,
        pulay_stress_kb=pulay_stress_kb,
        stress_tensor_kb=stress_tensor_kb,
        cell_volume=cell_volume,
        scf_iterations=scf_iterations,
        electronic_converged=None,
        ionic_converged=ionic_converged,
    )


def scan_outcar(
    path: Path, dialect: Dialect, checkpoint: ParserCheckpoint | None = None
) -> ScanResult:
    """Stream new OUTCAR bytes and return only newly verified ionic records."""

    path = Path(path)
    can_resume = checkpoint is not None and checkpoint_is_append_only(path, checkpoint)
    resumed_from = checkpoint.last_verified_offset if can_resume and checkpoint is not None else 0
    restore_parser_state = resumed_from > 0 and checkpoint is not None
    expected_atom_count = checkpoint.expected_atom_count if restore_parser_state else 0
    lattice = checkpoint.last_lattice if restore_parser_state else None
    next_step_id = checkpoint.next_step_id if restore_parser_state else 0
    species = checkpoint.species if restore_parser_state and checkpoint is not None else ()
    current_ionic_iteration = (
        checkpoint.current_ionic_iteration if restore_parser_state and checkpoint is not None else None
    )
    max_electronic_iteration = (
        checkpoint.max_electronic_iteration
        if restore_parser_state and checkpoint is not None
        else None
    )
    geometry_section_open = (
        checkpoint.geometry_section_open if restore_parser_state and checkpoint is not None else False
    )
    header_volume = checkpoint.header_volume if restore_parser_state and checkpoint is not None else None
    geometry_volume_consumed = (
        checkpoint.geometry_volume_consumed
        if restore_parser_state and checkpoint is not None
        else False
    )
    geometry_lattice_consumed = (
        checkpoint.geometry_lattice_consumed
        if restore_parser_state and checkpoint is not None
        else False
    )
    boundary_lattice = lattice
    boundary_current_ionic_iteration = current_ionic_iteration
    boundary_max_electronic_iteration = max_electronic_iteration
    boundary_geometry_section_open = geometry_section_open
    boundary_header_volume = header_volume
    boundary_geometry_volume_consumed = geometry_volume_consumed
    boundary_geometry_lattice_consumed = geometry_lattice_consumed
    element_types: list[str] = []

    steps: list[StepRecord] = []
    parameters: list[ParameterOccurrence] = []
    warnings: list[ParserWarning] = []
    normally_finished = checkpoint.normally_finished if restore_parser_state else False
    last_verified_offset = resumed_from
    pending: dict[str, object] | None = None
    next_details = _empty_details()
    if geometry_section_open and geometry_volume_consumed and header_volume is not None:
        next_details["cell_volume"] = header_volume
    next_detail_start: int | None = None
    upcoming_volume_crossed_lattice = False
    post_force_detail_mode = False
    force_rows_just_finished = False
    parameter_section_active = False
    energy_phase = _EnergyPhase.CLOSED
    stress_block_start: int | None = None
    stress_target: str | None = None
    stress_rows: list[bytes] | None = None
    stress_3x3_complete = False
    line_number = 0

    with path.open("rb") as stream:
        if resumed_from:
            digest, line_number = _hash_prefix_and_count_lines(stream, resumed_from)
        else:
            digest = sha256()
        stream.seek(resumed_from)
        offset = resumed_from

        def read_line() -> tuple[int, bytes] | None:
            nonlocal offset, line_number
            raw = stream.readline()
            if not raw:
                return None
            start = offset
            offset += len(raw)
            line_number += 1
            digest.update(raw)
            return start, raw

        def finalize_pending(*, stable: bool) -> None:
            nonlocal pending, next_step_id, last_verified_offset
            nonlocal energy_phase, post_force_detail_mode
            nonlocal boundary_lattice, boundary_current_ionic_iteration
            nonlocal boundary_max_electronic_iteration, boundary_geometry_section_open
            nonlocal boundary_header_volume, boundary_geometry_volume_consumed
            nonlocal boundary_geometry_lattice_consumed
            if pending is None:
                return
            if stable and stress_target == "pending":
                raise OutcarFormatError(
                    f"stress block at byte {stress_block_start} ended before a complete tensor"
                )
            pending["energy_terms"] = tuple(pending["energy_terms"])  # type: ignore[arg-type]
            record = _step(step_id=next_step_id, **pending)  # type: ignore[arg-type]
            steps.append(record)
            if stable:
                next_step_id += 1
                last_verified_offset = record.block_end
                boundary_lattice = lattice
                boundary_current_ionic_iteration = current_ionic_iteration
                boundary_max_electronic_iteration = max_electronic_iteration
                boundary_geometry_section_open = geometry_section_open
                boundary_header_volume = header_volume
                boundary_geometry_volume_consumed = geometry_volume_consumed
                boundary_geometry_lattice_consumed = geometry_lattice_consumed
            pending = None
            energy_phase = _EnergyPhase.CLOSED
            post_force_detail_mode = False

        def mark_next_detail(line_start: int) -> None:
            nonlocal next_detail_start
            if next_detail_start is None:
                next_detail_start = line_start

        def detail_target(line_start: int) -> dict[str, object]:
            if next_detail_start is not None:
                return next_details
            if pending is not None:
                return pending
            mark_next_detail(line_start)
            return next_details

        def volume_target(line_start: int) -> dict[str, object]:
            nonlocal header_volume, next_details, next_detail_start
            nonlocal upcoming_volume_crossed_lattice
            if (
                current_ionic_iteration is None
                and pending is None
                and next_detail_start is not None
                and upcoming_volume_crossed_lattice
                and next_details_are_only_volume()
            ):
                header_volume = float(next_details["cell_volume"])  # type: ignore[arg-type]
                next_details = _empty_details()
                next_detail_start = None
                upcoming_volume_crossed_lattice = False
            if next_details["cell_volume"] is not None:
                raise OutcarFormatError(
                    f"cell volume at byte {line_start} is ambiguous with an unconsumed volume"
                )
            if (
                pending is not None
                and pending["cell_volume"] is not None
                and post_force_detail_mode
            ):
                raise OutcarFormatError(
                    f"cell volume at byte {line_start} is ambiguous with the current record"
                )
            if next_detail_start is not None:
                return next_details
            if pending is None:
                mark_next_detail(line_start)
                return next_details
            has_current_details = (
                pending["energy"] is not None
                or pending["cell_volume"] is not None
                or pending["stress_tensor_kb"] is not None
                or pending["external_pressure_kb"] is not None
                or pending["pulay_stress_kb"] is not None
            )
            if has_current_details and not post_force_detail_mode:
                mark_next_detail(line_start)
                return next_details
            if not has_current_details and not post_force_detail_mode:
                raise OutcarFormatError(
                    f"cell volume at byte {line_start} is ambiguous without a detail section"
                )
            return pending

        def next_details_are_only_volume() -> bool:
            return (
                next_details["cell_volume"] is not None
                and next_details["energy_terms"] == []
                and next_details["external_pressure_kb"] is None
                and next_details["pulay_stress_kb"] is None
                and next_details["stress_tensor_kb"] is None
            )

        def active_stress_target() -> dict[str, object]:
            if stress_target == "pending" and pending is not None:
                return pending
            if stress_target == "next":
                return next_details
            raise OutcarFormatError("stress block lost its record association")

        def clear_stress_state() -> None:
            nonlocal stress_block_start, stress_target, stress_rows
            stress_block_start = None
            stress_target = None
            stress_rows = None

        def handle_incomplete_tail(message: str, block_offset: int) -> None:
            if not dialect.profile.validation.allow_incomplete_tail:
                raise OutcarFormatError(f"{message} at byte {block_offset}")
            warnings.append(
                ParserWarning(
                    category="IncompleteTail",
                    message=message,
                    byte_offset=block_offset,
                    line_number=line_number,
                )
            )

        while (item := read_line()) is not None:
            line_start, raw = item
            lowered = raw.lower()
            force_marker_now = _contains_all(raw, dialect.profile.outcar.markers.position_force)

            iteration = dialect.profile.outcar.details.iteration.parse(raw)
            iteration_prefix = dialect.profile.outcar.details.iteration.prefix.encode("ascii").lower()
            if iteration is None and lowered.lstrip().startswith(iteration_prefix):
                raise OutcarFormatError(f"iteration counters at byte {line_start} are malformed")
            if iteration is not None:
                ionic_iteration, electronic_iteration = iteration
                if current_ionic_iteration is None:
                    if (
                        next_detail_start is not None
                        and upcoming_volume_crossed_lattice
                        and next_details_are_only_volume()
                        and pending is None
                    ):
                        header_volume = float(next_details["cell_volume"])  # type: ignore[arg-type]
                        next_details = _empty_details()
                        next_detail_start = None
                        upcoming_volume_crossed_lattice = False
                    finalize_pending(stable=True)
                    if ionic_iteration <= next_step_id:
                        raise OutcarFormatError(
                            f"ionic iteration decreased to {ionic_iteration} at byte {line_start}"
                        )
                    current_ionic_iteration = ionic_iteration
                    max_electronic_iteration = electronic_iteration
                elif ionic_iteration < current_ionic_iteration:
                    raise OutcarFormatError(
                        f"ionic iteration decreased from {current_ionic_iteration} "
                        f"to {ionic_iteration} at byte {line_start}"
                    )
                elif ionic_iteration > current_ionic_iteration:
                    raise OutcarFormatError(
                        f"ionic iteration {current_ionic_iteration} ended without a force block"
                    )
                elif (
                    max_electronic_iteration is not None
                    and electronic_iteration < max_electronic_iteration
                ):
                    raise OutcarFormatError(
                        f"electronic iteration decreased from {max_electronic_iteration} "
                        f"to {electronic_iteration} at byte {line_start}"
                    )
                else:
                    max_electronic_iteration = max(
                        max_electronic_iteration or electronic_iteration, electronic_iteration
                    )
                continue

            if any(marker.lower() in lowered for marker in dialect.profile.outcar.details.volume_basis_section):
                if current_ionic_iteration is None:
                    raise OutcarFormatError(
                        f"geometry section at byte {line_start} has no active ionic iteration"
                    )
                if geometry_section_open:
                    raise OutcarFormatError(
                        f"geometry section at byte {line_start} is already open"
                    )
                geometry_section_open = True
                geometry_volume_consumed = False
                geometry_lattice_consumed = False
                continue

            if _contains_any(raw, dialect.profile.outcar.details.parameter_sections):
                parameter_section_active = True
                energy_phase = _EnergyPhase.CLOSED
                continue
            if parameter_section_active and _contains_any(
                raw, dialect.profile.outcar.details.parameter_section_end
            ):
                parameter_section_active = False
            if force_marker_now:
                parameter_section_active = False
            elif parameter_section_active and _PARAMETER_ASSIGNMENT_LINE.match(raw):
                parsed_parameters = parse_parameter_assignments(
                    raw,
                    start_ordinal=len(parameters),
                    line_number=line_number,
                )
                parameters.extend(parsed_parameters)

            vrhfin = _VRHFIN.search(raw)
            if vrhfin and not restore_parser_state and not species:
                element_types.append(vrhfin.group(1).decode("ascii"))

            ions_per_type = _IONS_PER_TYPE.search(raw)
            if ions_per_type and not restore_parser_state and not species:
                try:
                    parsed_counts = tuple(int(token) for token in ions_per_type.group(1).split())
                except ValueError as error:
                    raise OutcarFormatError(
                        f"ions per type at byte {line_start} contains a non-integer count"
                    ) from error
                if not parsed_counts or any(count <= 0 for count in parsed_counts):
                    raise OutcarFormatError(
                        f"ions per type at byte {line_start} must contain positive counts"
                    )
                collapsed_elements = _collapse_repeated_elements(element_types, len(parsed_counts))
                if collapsed_elements is None:
                    raise OutcarFormatError(
                        f"ions per type at byte {line_start} names {len(parsed_counts)} types "
                        f"but VRHFIN names {len(element_types)} elements"
                    )
                species = tuple(
                    element
                    for element, count in zip(collapsed_elements, parsed_counts, strict=True)
                    for _ in range(count)
                )

            nions = _NIONS.search(raw)
            if nions:
                parsed_count = int(nions.group(1))
                if parsed_count <= 0:
                    raise OutcarFormatError(f"NIONS at byte {line_start} must be positive")
                if expected_atom_count and parsed_count != expected_atom_count:
                    raise OutcarFormatError(
                        f"NIONS changed from {expected_atom_count} to {parsed_count} at byte {line_start}"
                    )
                expected_atom_count = parsed_count
                if species and len(species) != parsed_count:
                    raise OutcarFormatError(
                        f"ions per type totals {len(species)} atoms but NIONS is {parsed_count}"
                    )

            if _NORMAL_FINISH_MARKER in lowered:
                normally_finished = True
                if stress_target is not None:
                    raise OutcarFormatError(
                        f"stress block at byte {stress_block_start} ended before a complete tensor"
                    )
                if next_detail_start is not None:
                    raise OutcarFormatError(
                        f"details at byte {next_detail_start} were not followed by a force record"
                    )
                finalize_pending(stable=True)
                last_verified_offset = offset

            if pending is not None and _contains_all(raw, dialect.profile.outcar.markers.converged):
                pending["ionic_converged"] = True

            if _LATTICE_MARKER in lowered:
                if geometry_section_open and geometry_lattice_consumed:
                    raise OutcarFormatError(
                        f"lattice at byte {line_start} was already consumed by the geometry section"
                    )
                if pending is None and stress_target is not None:
                    raise OutcarFormatError(
                        f"stress block at byte {stress_block_start} ended before a complete tensor"
                    )
                if not geometry_section_open and next_detail_start is not None and (
                    upcoming_volume_crossed_lattice or not next_details_are_only_volume()
                ):
                    raise OutcarFormatError(
                        f"details at byte {next_detail_start} crossed a lattice boundary"
                    )
                finalize_pending(stable=True)
                lattice_rows: list[tuple[float, ...]] = []
                incomplete_lattice = False
                for _ in range(3):
                    lattice_item = read_line()
                    if lattice_item is None:
                        handle_incomplete_tail("incomplete lattice block", line_start)
                        incomplete_lattice = True
                        break
                    lattice_offset, lattice_raw = lattice_item
                    try:
                        lattice_values = _finite_numbers(
                            lattice_raw, context="lattice row", offset=lattice_offset
                        )
                    except _NonNumericRow:
                        if lattice_raw.endswith((b"\n", b"\r")):
                            raise
                        handle_incomplete_tail("incomplete lattice row", lattice_offset)
                        incomplete_lattice = True
                        break
                    if len(lattice_values) != 6 and not lattice_raw.endswith((b"\n", b"\r")):
                        handle_incomplete_tail("incomplete lattice row", lattice_offset)
                        incomplete_lattice = True
                        break
                    lattice_rows.append(lattice_values)
                if incomplete_lattice:
                    break
                lattice = _mat3(lattice_rows, line_start)
                if geometry_section_open:
                    geometry_lattice_consumed = True
                if current_ionic_iteration is not None and not geometry_section_open:
                    if next_detail_start is not None:
                        raise OutcarFormatError(
                            f"details at byte {next_detail_start} crossed a lattice boundary"
                        )
                if next_detail_start is not None:
                    upcoming_volume_crossed_lattice = True
                force_rows_just_finished = False
                continue

            if _contains_all(raw, dialect.profile.outcar.markers.position_force):
                if stress_target is not None:
                    raise OutcarFormatError(
                        f"stress block at byte {stress_block_start} ended before a complete tensor"
                    )
                finalize_pending(stable=True)
                if expected_atom_count <= 0:
                    raise OutcarFormatError(
                        f"force block at byte {line_start} appears before a valid NIONS value"
                    )
                if lattice is None:
                    raise OutcarFormatError(
                        f"force block at byte {line_start} appears before a complete lattice"
                    )
                if current_ionic_iteration is not None:
                    if current_ionic_iteration != next_step_id + 1:
                        raise OutcarFormatError(
                            f"ionic iteration {current_ionic_iteration} is not contiguous with "
                            f"completed step {next_step_id}"
                        )
                    if max_electronic_iteration is None:
                        raise OutcarFormatError("active ionic iteration has no electronic iteration")
                separator = read_line()
                if separator is None:
                    handle_incomplete_tail("force block ended before its atom rows", line_start)
                    break
                separator_offset, separator_raw = separator
                if separator_raw.strip(b" \t\r\n-"):
                    raise OutcarFormatError(
                        f"force block at byte {separator_offset} is missing its separator"
                    )

                positions: list[Vec3] = []
                forces: list[Vec3] = []
                incomplete = False
                for atom_index in range(expected_atom_count):
                    atom_item = read_line()
                    if atom_item is None:
                        handle_incomplete_tail(
                            f"force block has {atom_index} of {expected_atom_count} atom rows",
                            line_start,
                        )
                        incomplete = True
                        break
                    atom_offset, atom_raw = atom_item
                    try:
                        values = _force_values(atom_raw, dialect, offset=atom_offset)
                    except _NonNumericRow:
                        if atom_raw.endswith((b"\n", b"\r")):
                            raise
                        handle_incomplete_tail(
                            f"incomplete atom row {atom_index + 1} of {expected_atom_count}",
                            atom_offset,
                        )
                        incomplete = True
                        break
                    if len(values) != dialect.profile.validation.expected_force_columns:
                        if not atom_raw.endswith((b"\n", b"\r")):
                            handle_incomplete_tail(
                                f"incomplete atom row {atom_index + 1} of {expected_atom_count}",
                                atom_offset,
                            )
                            incomplete = True
                            break
                        raise OutcarFormatError(
                            f"position/force row at byte {atom_offset} has {len(values)} columns; expected 6"
                        )
                    positions.append((values[0], values[1], values[2]))
                    forces.append((values[3], values[4], values[5]))
                if incomplete:
                    break
                pending = {
                    "block_start": line_start,
                    "block_end": offset,
                    "atom_count": expected_atom_count,
                    "lattice": lattice,
                    "positions": tuple(positions),
                    "forces": tuple(forces),
                    "energy": None,
                    **next_details,
                    "scf_iterations": max_electronic_iteration,
                    "ionic_converged": None,
                }
                next_details = _empty_details()
                next_detail_start = None
                upcoming_volume_crossed_lattice = False
                post_force_detail_mode = False
                force_rows_just_finished = True
                current_ionic_iteration = None
                max_electronic_iteration = None
                geometry_section_open = False
                geometry_volume_consumed = False
                geometry_lattice_consumed = False
                continue

            if force_rows_just_finished:
                if _looks_like_force_row(raw, dialect, offset=line_start):
                    raise OutcarFormatError(
                        f"force block at byte {line_start} contains more than "
                        f"{expected_atom_count} atom rows"
                    )
                force_rows_just_finished = False

            if pending is not None and _contains_any(
                raw, dialect.profile.outcar.details.energy_section
            ):
                energy_phase = _EnergyPhase.AWAITING_SEPARATOR
                continue

            if pending is not None and energy_phase is _EnergyPhase.AWAITING_SEPARATOR:
                if _is_hyphen_separator(raw):
                    energy_phase = _EnergyPhase.BODY
                    continue
                if _contains_all(raw, dialect.profile.outcar.markers.total_energy):
                    # Retain support for compact analyzer fixtures that contain only
                    # the canonical total-energy row and omit the formatted body.
                    energy_phase = _EnergyPhase.CLOSED
                else:
                    continue

            if pending is not None and energy_phase is _EnergyPhase.BODY and _is_hyphen_separator(raw):
                energy_phase = _EnergyPhase.CLOSED
                continue

            if _contains_any(raw, dialect.profile.outcar.details.stress_section):
                if stress_target is not None:
                    raise OutcarFormatError(
                        f"stress block at byte {stress_block_start} contains a nested marker"
                    )
                energy_phase = _EnergyPhase.CLOSED
                stress_block_start = line_start
                stress_target = (
                    "next" if next_detail_start is not None or pending is None else "pending"
                )
                if stress_target == "next":
                    mark_next_detail(line_start)
                else:
                    post_force_detail_mode = True
                stress_rows = None
                stress_3x3_complete = False
                continue

            if stress_3x3_complete:
                try:
                    trailing_stress_values = _finite_numbers(
                        raw, context="stress tensor row", offset=line_start
                    )
                except _NonNumericRow:
                    stress_3x3_complete = False
                else:
                    if trailing_stress_values:
                        raise OutcarFormatError(
                            f"stress tensor at byte {line_start} contains more than three rows"
                        )
                    stress_3x3_complete = False

            if stress_target is not None and stress_rows is not None:
                if not raw.endswith((b"\n", b"\r")):
                    handle_incomplete_tail(
                        "incomplete stress tensor", stress_block_start or line_start
                    )
                    clear_stress_state()
                    break
                values = _finite_numbers(raw, context="stress tensor row", offset=line_start)
                if len(values) != 3:
                    raise OutcarFormatError(
                        f"stress tensor row at byte {line_start} must contain three components"
                    )
                stress_rows.append(raw)
                if len(stress_rows) == 3:
                    target = active_stress_target()
                    target["stress_tensor_kb"] = parse_stress_rows(tuple(stress_rows), unit="kB")
                    if target is pending:
                        pending["block_end"] = offset
                    clear_stress_state()
                    stress_3x3_complete = True
                continue

            if _contains_any(
                raw, dialect.profile.outcar.details.external_pressure
            ) and not raw.endswith((b"\n", b"\r")):
                handle_incomplete_tail("incomplete external pressure line", line_start)
                break
            pressure = parse_pressure_line(raw, dialect.profile.outcar)
            if pressure is not None:
                target = detail_target(line_start)
                target["external_pressure_kb"], target["pulay_stress_kb"] = pressure
                if target is pending:
                    pending["block_end"] = offset
                    post_force_detail_mode = True
                continue

            if _contains_any(raw, dialect.profile.outcar.details.cell_volume) and not raw.endswith(
                (b"\n", b"\r")
            ):
                handle_incomplete_tail("incomplete cell volume line", line_start)
                break
            volume = parse_volume_line(raw, dialect.profile.outcar)
            if volume is not None:
                if geometry_section_open:
                    if geometry_volume_consumed:
                        raise OutcarFormatError(
                            f"cell volume at byte {line_start} is ambiguous with an already "
                            "consumed geometry-section volume"
                        )
                    geometry_volume_consumed = True
                    header_volume = volume
                target = volume_target(line_start)
                target["cell_volume"] = volume
                if target is pending:
                    pending["block_end"] = offset
                continue

            if stress_target is not None and raw.lstrip().lower().startswith(b"in "):
                if not raw.endswith((b"\n", b"\r")):
                    handle_incomplete_tail(
                        "incomplete stress tensor", stress_block_start or line_start
                    )
                    clear_stress_state()
                    break
                tokens = raw.split()
                if len(tokens) == 2 and tuple(token.lower() for token in tokens) == (
                    b"in",
                    b"kb",
                ):
                    stress_rows = []
                else:
                    target = active_stress_target()
                    target["stress_tensor_kb"] = parse_stress_rows((raw,))
                    if target is pending:
                        pending["block_end"] = offset
                    clear_stress_state()
                continue

            if pending is not None and energy_phase is _EnergyPhase.BODY:
                if not raw.strip():
                    continue
                if not raw.endswith((b"\n", b"\r")):
                    handle_incomplete_tail("incomplete energy detail line", line_start)
                    break
                if _is_optimizer_diagnostic(
                    raw,
                    dialect.profile.outcar.details.optimizer_diagnostics,
                    offset=line_start,
                ):
                    continue
                combined = _combined_energy_terms(raw, dialect)
                if combined is not None:
                    pending["energy_terms"].extend(combined)  # type: ignore[union-attr]
                    pending["block_end"] = offset
                    continue
                if _ENERGY_ASSIGNMENT_LINE.match(raw) is None:
                    continue
                energy_term = parse_energy_line(raw, dialect.profile.outcar)
                if energy_term is not None:
                    pending["energy_terms"].append(energy_term)  # type: ignore[union-attr]
                    if energy_term.key == "toten":
                        pending["energy"] = energy_term.value
                    pending["block_end"] = offset
                    continue
                raise OutcarFormatError(f"energy assignment at byte {line_start} is malformed")

            if pending is not None and _contains_all(
                raw, dialect.profile.outcar.markers.total_energy
            ):
                if not raw.endswith((b"\n", b"\r")):
                    handle_incomplete_tail("incomplete energy line", line_start)
                    break
                match = _ENERGY.search(raw)
                if match is None:
                    raise OutcarFormatError(f"energy line at byte {line_start} has no value")
                energy_values = _finite_numbers(match.group(1), context="energy", offset=line_start)
                if len(energy_values) != 1:
                    raise OutcarFormatError(f"energy line at byte {line_start} is malformed")
                pending["energy"] = energy_values[0]
                pending["block_end"] = offset

        stress_tail_reported = False
        if stress_target is not None:
            handle_incomplete_tail(
                "incomplete stress tensor",
                stress_block_start if stress_block_start is not None else offset,
            )
            clear_stress_state()
            stress_tail_reported = True
        unverified_next_record = next_detail_start is not None
        if unverified_next_record and not stress_tail_reported:
            handle_incomplete_tail(
                "details ended before their force record", next_detail_start or offset
            )

        provisional_start = int(pending["block_start"]) if pending is not None else None
        replay_start = provisional_start if provisional_start is not None else last_verified_offset
        replay_provisional = (pending is not None or unverified_next_record) and replay_start > 0
        resumable_active_iteration = (
            current_ionic_iteration is not None
            and pending is None
            and (
                next_detail_start is None
                or geometry_section_open
                and geometry_lattice_consumed
                and next_details_are_only_volume()
            )
            and stress_target is None
        )
        if resumable_active_iteration:
            replay_start = offset
            last_verified_offset = offset
            replay_provisional = False
        checkpoint_lattice = lattice
        checkpoint_current_ionic_iteration = current_ionic_iteration
        checkpoint_max_electronic_iteration = max_electronic_iteration
        checkpoint_geometry_section_open = geometry_section_open
        checkpoint_header_volume = header_volume
        checkpoint_geometry_volume_consumed = geometry_volume_consumed
        checkpoint_geometry_lattice_consumed = geometry_lattice_consumed
        if replay_provisional and (
            current_ionic_iteration is not None
            or pending is not None and pending.get("scf_iterations") is not None
        ):
            replay_start = last_verified_offset
            checkpoint_lattice = boundary_lattice
            checkpoint_current_ionic_iteration = boundary_current_ionic_iteration
            checkpoint_max_electronic_iteration = boundary_max_electronic_iteration
            checkpoint_geometry_section_open = boundary_geometry_section_open
            checkpoint_header_volume = boundary_header_volume
            checkpoint_geometry_volume_consumed = boundary_geometry_volume_consumed
            checkpoint_geometry_lattice_consumed = boundary_geometry_lattice_consumed
        finalize_pending(stable=False)
    current_stat = path.stat()
    new_checkpoint = ParserCheckpoint(
        path=str(path.resolve()),
        size=offset,
        mtime_ns=current_stat.st_mtime_ns,
        prefix_fingerprint=digest.hexdigest(),
        last_verified_offset=(replay_start if replay_provisional else last_verified_offset),
        next_step_id=next_step_id,
        expected_atom_count=expected_atom_count,
        last_lattice=checkpoint_lattice,
        replay_provisional=replay_provisional,
        normally_finished=normally_finished,
        species=species,
        current_ionic_iteration=checkpoint_current_ionic_iteration,
        max_electronic_iteration=checkpoint_max_electronic_iteration,
        geometry_section_open=checkpoint_geometry_section_open,
        header_volume=checkpoint_header_volume,
        geometry_volume_consumed=checkpoint_geometry_volume_consumed,
        geometry_lattice_consumed=checkpoint_geometry_lattice_consumed,
    )
    return ScanResult(
        steps=tuple(steps),
        parameters=tuple(parameters),
        warnings=tuple(warnings),
        checkpoint=new_checkpoint,
        resumed_from=resumed_from,
        normally_finished=normally_finished,
        species=species,
        force_prefix_columns=dialect.profile.validation.force_prefix_columns,
        position_force_markers=dialect.profile.outcar.markers.position_force,
    )


__all__ = ["ScanResult", "StepRecord", "scan_outcar"]
