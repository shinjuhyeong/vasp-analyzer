"""Analyzer-owned contracts and adapters for normalized parser input."""

from .poscar_pymatgen import ParsedStructure, parse_poscar
from .vaspparser_outcar import ParsedTrajectory, parse_vaspparser_outcar

__all__ = [
    "ParsedStructure",
    "ParsedTrajectory",
    "parse_poscar",
    "parse_vaspparser_outcar",
]
