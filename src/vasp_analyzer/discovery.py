from dataclasses import dataclass
from pathlib import Path

from .errors import AnalyzerError


@dataclass(frozen=True)
class CalculationFiles:
    root: Path
    outcar: Path
    poscar: Path | None
    contcar: Path | None
    optional: dict[str, Path]


def discover_calculation(path: Path) -> CalculationFiles:
    resolved = path.expanduser().resolve()
    root = resolved.parent if resolved.is_file() else resolved
    outcar = resolved if resolved.is_file() and resolved.name == "OUTCAR" else root / "OUTCAR"
    if not outcar.is_file():
        raise AnalyzerError(f"OUTCAR not found in {root}")
    optional_names = (
        "vasprun.xml",
        "DOSCAR",
        "EIGENVAL",
        "PROCAR",
        "CHGCAR",
        "ELFCAR",
        "LOCPOT",
    )
    return CalculationFiles(
        root=root,
        outcar=outcar,
        poscar=(root / "POSCAR") if (root / "POSCAR").is_file() else None,
        contcar=(root / "CONTCAR") if (root / "CONTCAR").is_file() else None,
        optional={name: root / name for name in optional_names if (root / name).is_file()},
    )
