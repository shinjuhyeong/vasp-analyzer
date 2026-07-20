"""Analyzer-owned contracts and adapters for normalized parser input."""

from .poscar_pymatgen import ParsedStructure, parse_poscar

__all__ = ["ParsedStructure", "parse_poscar"]
