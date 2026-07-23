"""Shared Pydantic configuration for analyzer domain models."""

from pydantic import BaseModel, ConfigDict


def to_camel(name: str) -> str:
    """Convert a snake-case model field name to its JSON camel-case alias."""
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


class FrozenModel(BaseModel):
    """Immutable base model with stable camel-case JSON aliases."""

    model_config = ConfigDict(
        frozen=True,
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )
