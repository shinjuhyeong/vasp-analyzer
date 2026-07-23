"""Standalone commands for inspecting and testing declarative OUTCAR normalizers."""

from __future__ import annotations

import json
from collections.abc import Mapping
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path

from pydantic import ValidationError

from vasp_analyzer.calculation.dataset import _header_sites
from vasp_analyzer.core import ParserProvenance
from vasp_analyzer.normalizers import (
    NormalizerDefinition,
    NormalizerDefinitionError,
    NormalizerMatch,
    NormalizerSource,
    load_registry,
    normalize_outcar,
    select_normalizer,
)
from vasp_analyzer.parsing.adapters.vaspparser_outcar import parse_vaspparser_outcar

_PREFIX_BYTES = 1024 * 1024


def _json(payload: object) -> str:
    return json.dumps(
        payload,
        ensure_ascii=True,
        indent=2,
        sort_keys=True,
    )


def _read_definition(path: Path) -> NormalizerMatch:
    try:
        definition = NormalizerDefinition.model_validate_json(
            path.read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, ValueError, ValidationError) as error:
        raise NormalizerDefinitionError(
            f"invalid normalizer definition {path}: {error}"
        ) from error
    return NormalizerMatch.from_definition(
        definition,
        NormalizerSource(str(path), False),
    )


def _standard_match() -> NormalizerMatch:
    resource = files("vasp_analyzer.normalizers.definitions").joinpath(
        "standard.json"
    )
    try:
        definition = NormalizerDefinition.model_validate_json(
            resource.read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, ValueError, ValidationError) as error:
        raise NormalizerDefinitionError(
            f"invalid packaged standard normalizer {resource}: {error}"
        ) from error
    return NormalizerMatch.from_definition(
        definition,
        NormalizerSource(str(resource), True),
    )


def list_normalizers(
    environ: Mapping[str, str],
    home: Path,
) -> str:
    registry = load_registry(environ, home)
    return _json(
        {
            "normalizers": [
                {
                    "builtIn": entry.source.built_in,
                    "definitionSha256": entry.definition_hash,
                    "displayName": entry.definition.display_name,
                    "id": entry.definition.id,
                    "priority": entry.definition.priority,
                    "sourcePath": entry.source.path,
                }
                for entry in registry
            ],
            "schemaVersion": 1,
        }
    )


def validate_normalizer(
    path: Path,
    environ: Mapping[str, str],
    home: Path,
) -> str:
    candidate = _read_definition(path)
    registry = load_registry(environ, home)
    conflict = next(
        (
            entry
            for entry in registry
            if entry.definition.id == candidate.definition.id
        ),
        None,
    )
    if conflict is not None:
        raise NormalizerDefinitionError(
            f"duplicate normalizer ID {candidate.definition.id!r}: "
            f"{conflict.source.path} and {candidate.source.path}"
        )
    definition = candidate.definition
    return _json(
        {
            "definitionSha256": candidate.definition_hash,
            "displayName": definition.display_name,
            "id": definition.id,
            "priority": definition.priority,
            "schemaVersion": definition.schema_version,
            "sourcePath": candidate.source.path,
            "valid": True,
        }
    )


def test_normalizer(path: Path, outcar: Path) -> str:
    candidate = _read_definition(path)
    if candidate.definition.id == "standard":
        raise NormalizerDefinitionError(
            "reserved packaged normalizer ID 'standard' cannot be tested as a candidate"
        )
    standard = _standard_match()
    registry = (standard, candidate)
    temporary_path: Path | None = None
    try:
        with normalize_outcar(outcar, candidate) as normalized:
            prefix = normalized.source_prefix(_PREFIX_BYTES)
            selected = select_normalizer(prefix, registry)
            if selected.definition.id != candidate.definition.id:
                raise NormalizerDefinitionError(
                    f"normalizer {candidate.definition.id!r} did not match "
                    "the OUTCAR prefix"
                )
            sites = _header_sites(prefix)
            provenance = ParserProvenance(
                adapter="vaspparser",
                adapter_version=version("vaspparser"),
                dialect="normalizer-test",
                normalizer_id=candidate.definition.id,
                normalizer_display_name=candidate.definition.display_name,
                normalizer_schema_version=candidate.definition.schema_version,
                normalizer_definition_sha256=candidate.definition_hash,
            )
            temporary_path = (
                normalized.parser_path
                if normalized.parser_path != outcar.absolute()
                else None
            )
            trajectory = parse_vaspparser_outcar(
                normalized.parser_path,
                sites,
                provenance,
            )
            manifest = normalized.manifest
    except Exception as error:
        notes = getattr(error, "__notes__", ())
        if notes:
            raise NormalizerDefinitionError(
                "; ".join((str(error), *notes))
            ) from error
        raise
    source_hash_verified = True
    temporary_cleaned = temporary_path is None or not temporary_path.exists()
    if not temporary_cleaned:
        raise NormalizerDefinitionError(
            "normalizer test temporary output was not cleaned"
        )
    return _json(
        {
            "manifest": {
                "changedLineCount": manifest.changed_line_count,
                "definitionSha256": manifest.definition_sha256,
                "firstChangedLine": manifest.first_changed_line,
                "lastChangedLine": manifest.last_changed_line,
                "normalizerId": manifest.normalizer_id,
                "ruleChangedLineCounts": manifest.rule_changed_line_counts,
                "sourceSha256": manifest.source_sha256,
                "sourceSize": manifest.source_size,
                "warnings": list(manifest.warnings),
            },
            "schemaVersion": 1,
            "sourceHashVerified": source_hash_verified,
            "summary": {
                "adapter": trajectory.provenance.adapter,
                "adapterVersion": trajectory.provenance.adapter_version,
                "atomCount": len(trajectory.sites),
                "ionicSteps": len(trajectory.step_indices),
            },
            "temporaryCleaned": temporary_cleaned,
        }
    )


__all__ = [
    "list_normalizers",
    "test_normalizer",
    "validate_normalizer",
]
