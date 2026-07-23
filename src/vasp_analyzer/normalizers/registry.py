from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path

from pydantic import ValidationError

from .errors import NormalizerDefinitionError
from .models import NormalizerDefinition

_PREFIX_LIMIT = 1024 * 1024


@dataclass(frozen=True)
class NormalizerSource:
    path: str
    built_in: bool


@dataclass(frozen=True)
class NormalizerMatch:
    definition: NormalizerDefinition
    source: NormalizerSource
    definition_hash: str

    @classmethod
    def from_definition(
        cls,
        definition: NormalizerDefinition | Mapping[str, object],
        source: NormalizerSource | None = None,
    ) -> NormalizerMatch:
        model = (
            definition
            if isinstance(definition, NormalizerDefinition)
            else NormalizerDefinition.model_validate(definition)
        )
        canonical = json.dumps(
            model.model_dump(mode="json", by_alias=True),
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
        return cls(
            definition=model,
            source=source or NormalizerSource("<memory>", False),
            definition_hash=hashlib.sha256(canonical).hexdigest(),
        )


def _load_definition(path: object, *, built_in: bool) -> NormalizerMatch:
    display_path = str(path)
    try:
        text = path.read_text(encoding="utf-8")  # type: ignore[attr-defined]
        definition = NormalizerDefinition.model_validate_json(text)
    except (OSError, UnicodeError, ValueError, ValidationError) as error:
        raise NormalizerDefinitionError(
            f"invalid normalizer definition {display_path}: {error}"
        ) from error
    return NormalizerMatch.from_definition(
        definition, NormalizerSource(display_path, built_in)
    )


def load_registry(
    environ: Mapping[str, str],
    home: str | Path,
) -> tuple[NormalizerMatch, ...]:
    definitions = files("vasp_analyzer.normalizers.definitions")
    built_in_paths = sorted(
        (
            resource
            for resource in definitions.iterdir()
            if resource.name.endswith(".json") and resource.name != "schema.json"
        ),
        key=lambda resource: resource.name,
    )
    registry = [_load_definition(path, built_in=True) for path in built_in_paths]

    xdg_config_home = environ.get("XDG_CONFIG_HOME")
    config_root = Path(xdg_config_home) if xdg_config_home else Path(home) / ".config"
    user_directory = config_root / "vasp-analyzer" / "normalizers"
    if user_directory.is_dir():
        registry.extend(
            _load_definition(path, built_in=False)
            for path in sorted(user_directory.glob("*.json"), key=lambda item: item.name)
        )

    by_id: dict[str, NormalizerMatch] = {}
    for entry in registry:
        previous = by_id.get(entry.definition.id)
        if previous is not None:
            raise NormalizerDefinitionError(
                f"duplicate normalizer ID {entry.definition.id!r}: "
                f"{previous.source.path} and {entry.source.path}"
            )
        by_id[entry.definition.id] = entry
    return tuple(registry)


def _matches(prefix: bytes, entry: NormalizerMatch) -> bool:
    detection = entry.definition.detect
    all_literals = tuple(literal.encode("ascii") for literal in detection.all)
    any_literals = tuple(literal.encode("ascii") for literal in detection.any)
    none_literals = tuple(literal.encode("ascii") for literal in detection.none)
    return (
        all(literal in prefix for literal in all_literals)
        and (not any_literals or any(literal in prefix for literal in any_literals))
        and not any(literal in prefix for literal in none_literals)
    )


def select_normalizer(
    prefix: bytes,
    registry: Sequence[NormalizerMatch],
) -> NormalizerMatch:
    bounded_prefix = prefix[:_PREFIX_LIMIT]
    standard = next(
        (entry for entry in registry if entry.definition.id == "standard"), None
    )
    if standard is None:
        raise NormalizerDefinitionError("registry is missing the standard normalizer")

    matches = [
        entry
        for entry in registry
        if entry.definition.id != "standard" and _matches(bounded_prefix, entry)
    ]
    if not matches:
        return standard
    highest_priority = max(entry.definition.priority for entry in matches)
    winners = sorted(
        (
            entry
            for entry in matches
            if entry.definition.priority == highest_priority
        ),
        key=lambda entry: entry.definition.id,
    )
    if len(winners) > 1:
        identifiers = ", ".join(entry.definition.id for entry in winners)
        raise NormalizerDefinitionError(
            f"ambiguous normalizers at priority {highest_priority}: {identifiers}"
        )
    return winners[0]


__all__ = [
    "NormalizerMatch",
    "NormalizerSource",
    "load_registry",
    "select_normalizer",
]
