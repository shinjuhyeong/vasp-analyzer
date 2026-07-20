"""Discovery of files belonging to a VASP calculation."""

from dataclasses import dataclass
from pathlib import Path

from vasp_analyzer.core.errors import AnalyzerError


@dataclass(frozen=True)
class DiscoveredFile:
    name: str
    path: Path


@dataclass(frozen=True)
class DiscoveredCalculation:
    root: Path
    outcar: Path
    poscar: Path | None
    contcar: Path | None
    optional: tuple[DiscoveredFile, ...]


def discover_calculation(path: Path) -> DiscoveredCalculation:
    selected = path.expanduser().resolve()
    root = selected.parent if selected.is_file() else selected
    outcar = selected if selected.name == "OUTCAR" else root / "OUTCAR"
    if not outcar.is_file():
        raise AnalyzerError(f"OUTCAR not found under {root}")
    optional_names = (
        "AECCAR0",
        "AECCAR1",
        "AECCAR2",
        "CHGCAR",
        "DOSCAR",
        "EIGENVAL",
        "ELFCAR",
        "LOCPOT",
        "PROCAR",
        "vasprun.xml",
    )
    return DiscoveredCalculation(
        root=root,
        outcar=outcar,
        poscar=(root / "POSCAR") if (root / "POSCAR").is_file() else None,
        contcar=(root / "CONTCAR") if (root / "CONTCAR").is_file() else None,
        optional=tuple(
            DiscoveredFile(name, (root / name).resolve())
            for name in optional_names
            if (root / name).is_file()
        ),
    )
