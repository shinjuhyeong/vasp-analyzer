from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Callable

from .models import ColumnSpec

_ELEMENTS = frozenset(
    """
    H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni
    Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe
    Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg
    Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg
    Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og
    """.split()
)
_POSITIVE_INTEGER = re.compile(r"[1-9][0-9]*\Z")
_FINITE_FLOAT = re.compile(
    r"[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[EeDd][+-]?[0-9]+)?\Z"
)


class FieldValueError(ValueError):
    """A projected row does not satisfy its declared field schema."""


def _element_label(token: str, column: ColumnSpec) -> None:
    suffixes = getattr(column, "allowed_suffixes", ())
    if token in _ELEMENTS:
        return
    if any(
        token.endswith(suffix)
        and token[: -len(suffix)] in _ELEMENTS
        for suffix in suffixes
    ):
        return
    raise ValueError("invalid elementLabel")


def _positive_integer(token: str, _column: ColumnSpec) -> None:
    if _POSITIVE_INTEGER.fullmatch(token) is None:
        raise ValueError("invalid positiveInteger")


def _finite_float(token: str, _column: ColumnSpec) -> None:
    if _FINITE_FLOAT.fullmatch(token) is None:
        raise ValueError("invalid finiteFloat")
    if not math.isfinite(float(token.replace("D", "E").replace("d", "e"))):
        raise ValueError("nonfinite finiteFloat")


def _literal(token: str, column: ColumnSpec) -> None:
    if token != getattr(column, "value", None):
        raise ValueError("invalid literal")


def _text(token: str, _column: ColumnSpec) -> None:
    if not token:
        raise ValueError("invalid text")


FIELD_REGISTRY: dict[str, Callable[[str, ColumnSpec], None]] = {
    "elementLabel": _element_label,
    "positiveInteger": _positive_integer,
    "finiteFloat": _finite_float,
    "literal": _literal,
    "text": _text,
}


def parse_fields(
    row: str,
    columns: Sequence[ColumnSpec],
    *,
    line_number: int,
) -> dict[str, str]:
    tokens = row.split()
    if len(tokens) != len(columns):
        raise FieldValueError(
            f"line {line_number}: expected {len(columns)} tokens, got {len(tokens)}"
        )
    values: dict[str, str] = {}
    for token, column in zip(tokens, columns, strict=True):
        try:
            FIELD_REGISTRY[column.type](token, column)
        except (KeyError, ValueError, OverflowError) as error:
            raise FieldValueError(
                f"line {line_number}: {column.name} ({column.type}): {error}"
            ) from error
        values[column.name] = token
    return values


__all__ = ["FIELD_REGISTRY", "FieldValueError", "parse_fields"]
