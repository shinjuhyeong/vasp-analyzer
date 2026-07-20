# Standalone VASP Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline VASP analyzer that opens from an SSH-connected VS Code terminal or Explorer, renders an interactive crystallographic structure with forces and Selective Dynamics, and synchronizes it with ionic/electronic convergence data.

**Architecture:** A Python package discovers and parses VASP files into versioned Pydantic contracts. A remote VS Code extension launches the Python core over newline-delimited JSON on standard input/output and displays a bundled React Webview; typing `analyzer` in an integrated terminal hands the calculation path to the extension through an authenticated local socket. 3Dmol.js is isolated behind a renderer adapter, and future DOS, band, and volumetric modules consume the same stable site identities.

**Tech Stack:** Python 3.11+, pymatgen 2026.5.4+, Pydantic 2.13+, Typer, FastAPI/Uvicorn for the optional web fallback, pytest; TypeScript, VS Code Extension API, React, Vite, Vitest, 3Dmol.js, uPlot, pnpm.

## Global Constraints

- Runtime must work offline; bundle all JavaScript, CSS, renderer, and chart assets and make no CDN requests.
- `pip install` and `pipx install` must expose `analyzer` globally; Node.js is a development/build dependency only.
- Primary Remote SSH operation uses VS Code message passing and stdio, not HTTP or port forwarding.
- Support `analyzer`, `analyzer OUTCAR`, and `analyzer <directory>`.
- Accept the exact home-VASP sequence `Selective dynamics`, standalone `0`, then `Direct` without silently skipping other unknown lines.
- Treat `T` as movable and `F` as fixed. Strongest-force and RMS-free-force metrics use only `T` components.
- If no input file contains a Selective Dynamics mask, represent the mask as unknown and do not claim a constraint-aware maximum; never assume all directions are free.
- Preserve one stable `site_index` across all ionic steps and future DOS, band, and charge data. Supercell images add an image vector but retain the original site index.
- The first release implements structure and convergence; DOS, band, and charge UIs remain deferred, while their contracts and renderer boundaries are tested.
- Do not add a third-party plugin API.
- Keep real root-level VASP outputs ignored; curated synthetic or anonymized fixtures live under `tests/fixtures/`.

## Primary References

- pymatgen VASP I/O: <https://pymatgen.org/pymatgen.io.vasp.html>
- 3Dmol.js `GLViewer` API for unit cells, supercells, clickable atoms, arrows, and rotation: <https://3dmol.org/doc/GLViewer.html>
- VS Code Webview API: <https://code.visualstudio.com/api/extension-guides/webview>
- VS Code Remote Extension guidance: <https://code.visualstudio.com/api/advanced-topics/remote-extensions>
- VS Code terminal environment variables: <https://code.visualstudio.com/api/references/vscode-api>

---

## Planned File Map

### Python package

- `pyproject.toml` — build metadata, runtime dependencies, CLI entry point, pytest/ruff configuration.
- `src/vasp_analyzer/models.py` — versioned Pydantic wire/domain models only.
- `src/vasp_analyzer/errors.py` — typed user-facing parser and capability errors.
- `src/vasp_analyzer/discovery.py` — resolve file/directory input and inventory calculation files.
- `src/vasp_analyzer/parsers/poscar.py` — narrow home-VASP normalization plus pymatgen POSCAR conversion.
- `src/vasp_analyzer/parsers/outcar.py` — streaming OUTCAR species, lattice, ionic-step, energy, and SCF parser.
- `src/vasp_analyzer/analysis/forces.py` — Selective-Dynamics-aware force metrics.
- `src/vasp_analyzer/dataset.py` — reconcile files and assemble `CalculationDataset`.
- `src/vasp_analyzer/protocol.py` — JSON request/response message contracts.
- `src/vasp_analyzer/stdio_server.py` — deterministic JSON-lines request loop.
- `src/vasp_analyzer/handoff.py` — authenticated extension-socket client.
- `src/vasp_analyzer/cli.py` — Typer commands and UI selection.
- `src/vasp_analyzer/web.py` — optional loopback-only browser fallback and static asset serving.
- `src/vasp_analyzer/volumetric.py` — deferred-module request/cache contracts without first-release CHGCAR UI.

### VS Code extension and Webview

- `vscode/package.json` — extension contributions, commands, menus, build scripts, and runtime placement.
- `vscode/src/extension.ts` — activation, command registration, context-menu handler, and panel lifecycle.
- `vscode/src/controlEndpoint.ts` — authenticated Unix socket/Windows named-pipe terminal handoff server.
- `vscode/src/analyzerProcess.ts` — stdio subprocess and typed request correlation.
- `vscode/src/webviewHtml.ts` — CSP-restricted bundled Webview HTML.
- `vscode/webview/src/contracts.ts` — generated/checked TypeScript mirrors of Python JSON models.
- `vscode/webview/src/host.ts` — VS Code and HTTP host adapters.
- `vscode/webview/src/store.ts` — selected step/site and visibility state.
- `vscode/webview/src/App.tsx` — upper viewer/lower analysis layout and future tab shell.
- `vscode/webview/src/renderers/CrystalRenderer.ts` — renderer interface.
- `vscode/webview/src/renderers/ThreeDmolRenderer.ts` — atoms, bonds, cell, axes, supercell, force, SD, click, and camera behavior.
- `vscode/webview/src/components/CrystalPanel.tsx` — crystal controls and renderer lifecycle.
- `vscode/webview/src/components/AtomDetail.tsx` — selected-site exact data.
- `vscode/webview/src/components/ConvergencePanel.tsx` — energy/force plots and selected-step values.
- `vscode/webview/src/components/DataTableFallback.tsx` — non-WebGL fallback.
- `vscode/webview/src/styles.css` — VS Code-theme-aware responsive layout.

### Tests and automation

- `tests/fixtures/` — compact synthetic POSCAR and OUTCAR fixtures.
- `tests/unit/` — Python parser, metric, model, protocol, and handoff tests.
- `tests/integration/` — dataset, stdio, CLI, and web-fallback tests.
- `vscode/src/test/` — extension process/control-endpoint tests.
- `vscode/webview/src/**/*.test.ts(x)` — Vitest component, store, renderer-adapter, and chart tests.
- `.github/workflows/ci.yml` — Python and frontend validation on Linux and Windows.
- `README.md` — installation, VS Code setup, CLI usage, privacy, and troubleshooting.

---

### Task 1: Bootstrap the Python Package and Stable Models

**Files:**
- Create: `pyproject.toml`
- Create: `src/vasp_analyzer/__init__.py`
- Create: `src/vasp_analyzer/models.py`
- Create: `src/vasp_analyzer/errors.py`
- Create: `tests/unit/test_models.py`

**Interfaces:**
- Consumes: none.
- Produces: `SelectiveMask`, `Site`, `ForceComponent`, `IonicStep`, `CalculationDataset`, `Capability`, and `AnalyzerError` used by every later Python task and mirrored in TypeScript.

- [ ] **Step 1: Add the package metadata and test dependencies**

```toml
[build-system]
requires = ["hatchling>=1.27"]
build-backend = "hatchling.build"

[project]
name = "vasp-analyzer"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "numpy>=2.2",
  "pydantic>=2.13,<3",
  "pymatgen>=2026.5.4",
  "typer>=0.16",
  "fastapi>=0.116",
  "uvicorn>=0.35",
]

[project.optional-dependencies]
dev = ["build>=1.3", "httpx>=0.28", "pytest>=8.4", "pytest-cov>=6.2", "ruff>=0.12"]

[project.scripts]
analyzer = "vasp_analyzer.cli:app"

[tool.hatch.build.targets.wheel]
packages = ["src/vasp_analyzer"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers"

[tool.ruff]
target-version = "py311"
line-length = 100
```

- [ ] **Step 2: Write failing model tests**

```python
from vasp_analyzer.models import ForceComponent, SelectiveMask


def test_selective_mask_preserves_unknown_state() -> None:
    mask = SelectiveMask(x=True, y=False, z=None)
    assert mask.as_tuple() == (True, False, None)


def test_force_component_retains_signed_value() -> None:
    component = ForceComponent(site_index=4, axis="z", value=-0.61)
    assert component.magnitude == 0.61
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `python -m pytest tests/unit/test_models.py -v`

Expected: FAIL during import because `vasp_analyzer.models` does not exist.

- [ ] **Step 4: Implement the immutable versioned models**

```python
from typing import Literal

from pydantic import BaseModel, ConfigDict, computed_field

Vec3 = tuple[float, float, float]
Mat3 = tuple[Vec3, Vec3, Vec3]


def to_camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


class FrozenModel(BaseModel):
    model_config = ConfigDict(
        frozen=True,
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class SelectiveMask(FrozenModel):
    x: bool | None
    y: bool | None
    z: bool | None

    def as_tuple(self) -> tuple[bool | None, bool | None, bool | None]:
        return self.x, self.y, self.z


class Site(FrozenModel):
    site_index: int
    element: str
    selective_dynamics: SelectiveMask


class ForceComponent(FrozenModel):
    site_index: int
    axis: Literal["x", "y", "z"]
    value: float

    @computed_field
    @property
    def magnitude(self) -> float:
        return abs(self.value)


class IonicStep(FrozenModel):
    index: int
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    free_forces: tuple[Vec3, ...] | None
    total_energy: float
    delta_energy: float | None
    scf_iterations: int
    electronic_converged: bool | None
    ionic_converged: bool | None
    strongest_free_component: ForceComponent | None
    rms_free_force: float | None


class Capability(FrozenModel):
    name: Literal["structure", "convergence", "dos", "band", "charge"]
    available: bool
    reason: str | None = None


class CalculationDataset(FrozenModel):
    schema_version: Literal[1] = 1
    root: str
    source_files: dict[str, str]
    sites: tuple[Site, ...]
    ionic_steps: tuple[IonicStep, ...]
    capabilities: tuple[Capability, ...]
    warnings: tuple[str, ...] = ()
```

Add the explicit error hierarchy in `errors.py` so UI-facing failures have stable codes:

```python
class AnalyzerError(RuntimeError):
    code = "analyzer_error"


class PoscarFormatError(AnalyzerError):
    code = "poscar_format"


class OutcarFormatError(AnalyzerError):
    code = "outcar_format"


class IncompleteIonicStep(OutcarFormatError):
    code = "incomplete_ionic_step"


class StructureMismatchError(AnalyzerError):
    code = "structure_mismatch"


class VolumetricAlignmentError(AnalyzerError):
    code = "volumetric_alignment"


class UnknownMethodError(AnalyzerError):
    code = "unknown_method"

    def __init__(self, method: str) -> None:
        super().__init__(f"Unknown method: {method}")
```

- [ ] **Step 5: Run tests and static checks**

Run: `python -m pytest tests/unit/test_models.py -v && python -m ruff check src tests`

Expected: model tests PASS and Ruff reports no errors.

- [ ] **Step 6: Commit the model boundary**

```bash
git add pyproject.toml src/vasp_analyzer tests/unit/test_models.py
git commit -m "feat: add analyzer domain models"
```

### Task 2: Discover Calculation Inputs Safely

**Files:**
- Create: `src/vasp_analyzer/discovery.py`
- Create: `tests/unit/test_discovery.py`

**Interfaces:**
- Consumes: `AnalyzerError` from Task 1.
- Produces: `CalculationFiles` and `discover_calculation(path: Path) -> CalculationFiles` for dataset assembly and CLI.

- [ ] **Step 1: Write failing discovery tests**

```python
from pathlib import Path

import pytest

from vasp_analyzer.discovery import discover_calculation
from vasp_analyzer.errors import AnalyzerError


def test_outcar_path_resolves_parent(tmp_path: Path) -> None:
    outcar = tmp_path / "OUTCAR"
    outcar.write_text("fixture", encoding="utf-8")
    found = discover_calculation(outcar)
    assert found.root == tmp_path.resolve()
    assert found.outcar == outcar.resolve()


def test_missing_outcar_is_actionable(tmp_path: Path) -> None:
    with pytest.raises(AnalyzerError, match="OUTCAR"):
        discover_calculation(tmp_path)
```

- [ ] **Step 2: Verify the tests fail**

Run: `python -m pytest tests/unit/test_discovery.py -v`

Expected: FAIL because `discovery.py` is absent.

- [ ] **Step 3: Implement canonical discovery without recursive guessing**

```python
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
        "vasprun.xml", "DOSCAR", "EIGENVAL", "PROCAR", "CHGCAR",
        "ELFCAR", "LOCPOT",
    )
    return CalculationFiles(
        root=root,
        outcar=outcar,
        poscar=(root / "POSCAR") if (root / "POSCAR").is_file() else None,
        contcar=(root / "CONTCAR") if (root / "CONTCAR").is_file() else None,
        optional={name: root / name for name in optional_names if (root / name).is_file()},
    )
```

- [ ] **Step 4: Run the discovery tests**

Run: `python -m pytest tests/unit/test_discovery.py -v`

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/discovery.py src/vasp_analyzer/errors.py tests/unit/test_discovery.py
git commit -m "feat: discover VASP calculation files"
```

### Task 3: Parse Standard and Home-VASP POSCAR Files

**Files:**
- Create: `src/vasp_analyzer/parsers/__init__.py`
- Create: `src/vasp_analyzer/parsers/poscar.py`
- Create: `tests/fixtures/POSCAR.standard`
- Create: `tests/fixtures/POSCAR.home-zero`
- Create: `tests/unit/test_poscar_parser.py`

**Interfaces:**
- Consumes: `Site`, `SelectiveMask`, and `Mat3` from Task 1.
- Produces: `ParsedPoscar` and `parse_poscar(path: Path) -> ParsedPoscar`.

- [ ] **Step 1: Add two minimal fixtures**

```text
Y O fixture
1.0
2 0 0
0 2 0
0 0 2
Y O
1 1
Selective dynamics
0
Direct
0 0 0 T F T
0.5 0.5 0.5 F F T
```

Create the standard fixture with the same content except remove the standalone `0` line.

- [ ] **Step 2: Write failing compatibility and strictness tests**

```python
from pathlib import Path

import pytest

from vasp_analyzer.errors import PoscarFormatError
from vasp_analyzer.parsers.poscar import parse_poscar_text


FIXTURES = Path(__file__).parents[1] / "fixtures"


def test_home_zero_line_matches_standard_poscar() -> None:
    standard = parse_poscar_text((FIXTURES / "POSCAR.standard").read_text())
    home = parse_poscar_text((FIXTURES / "POSCAR.home-zero").read_text())
    assert home.sites == standard.sites
    assert home.fractional_positions == standard.fractional_positions
    assert home.compatibility_metadata == "0"


def test_unknown_line_is_not_silently_skipped() -> None:
    text = (FIXTURES / "POSCAR.home-zero").read_text().replace("\n0\n", "\ncustom\n")
    with pytest.raises(PoscarFormatError, match="line 9"):
        parse_poscar_text(text)
```

- [ ] **Step 3: Verify the tests fail**

Run: `python -m pytest tests/unit/test_poscar_parser.py -v`

Expected: FAIL because the parser is missing.

- [ ] **Step 4: Implement narrow normalization and pymatgen conversion**

```python
from dataclasses import dataclass
from pathlib import Path

from pymatgen.io.vasp import Poscar

from vasp_analyzer.errors import PoscarFormatError
from vasp_analyzer.models import Mat3, SelectiveMask, Site, Vec3


@dataclass(frozen=True)
class ParsedPoscar:
    lattice: Mat3
    sites: tuple[Site, ...]
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    compatibility_metadata: str | None


def _normalize_home_variant(text: str) -> tuple[str, str | None]:
    lines = text.splitlines()
    if len(lines) < 7:
        raise PoscarFormatError("POSCAR is too short to contain lattice, species, and coordinates")
    line_six_is_counts = all(token.lstrip("+-").isdigit() for token in lines[5].split())
    count_index = 5 if line_six_is_counts else 6
    selective_index = count_index + 1
    if selective_index >= len(lines) or not lines[selective_index].strip().lower().startswith("s"):
        return text, None
    mode_index = selective_index + 1
    candidate = lines[mode_index].strip()
    metadata = None
    if candidate.lstrip("+-").isdigit():
        metadata = candidate
        del lines[mode_index]
        candidate = lines[mode_index].strip()
    if not candidate.lower().startswith(("d", "c", "k")):
        raise PoscarFormatError(
            f"line {mode_index + 1}: expected Direct/Cartesian after Selective dynamics, got {candidate!r}"
        )
    return "\n".join(lines) + "\n", metadata


def parse_poscar_text(text: str) -> ParsedPoscar:
    normalized, metadata = _normalize_home_variant(text)
    poscar = Poscar.from_str(normalized)
    structure = poscar.structure
    raw_masks = structure.site_properties.get("selective_dynamics")
    masks = raw_masks or [[True, True, True] for _ in structure]
    sites = tuple(
        Site(
            site_index=index,
            element=site.specie.symbol,
            selective_dynamics=SelectiveMask(x=mask[0], y=mask[1], z=mask[2]),
        )
        for index, (site, mask) in enumerate(zip(structure, masks, strict=True))
    )
    return ParsedPoscar(
        lattice=tuple(tuple(float(v) for v in row) for row in structure.lattice.matrix),
        sites=sites,
        fractional_positions=tuple(tuple(float(v) for v in site.frac_coords) for site in structure),
        cartesian_positions=tuple(tuple(float(v) for v in site.coords) for site in structure),
        compatibility_metadata=metadata,
    )


def parse_poscar(path: Path) -> ParsedPoscar:
    return parse_poscar_text(path.read_text(encoding="utf-8", errors="strict"))
```

- [ ] **Step 5: Run the parser tests and full model tests**

Run: `python -m pytest tests/unit/test_poscar_parser.py tests/unit/test_models.py -v`

Expected: all tests PASS, including exact metadata preservation and rejection of `custom`.

- [ ] **Step 6: Commit**

```bash
git add src/vasp_analyzer/parsers tests/fixtures/POSCAR.* tests/unit/test_poscar_parser.py
git commit -m "feat: parse home VASP POSCAR variant"
```

### Task 4: Stream Complete Ionic Steps from OUTCAR

**Files:**
- Create: `src/vasp_analyzer/parsers/outcar.py`
- Create: `tests/fixtures/OUTCAR.two-steps`
- Create: `tests/fixtures/OUTCAR.truncated`
- Create: `tests/unit/test_outcar_parser.py`

**Interfaces:**
- Consumes: `Mat3` and `Vec3` aliases from Task 1.
- Produces: `ParsedOutcar`, `RawIonicStep`, and `parse_outcar(path: Path, atom_count: int | None) -> ParsedOutcar`.

- [ ] **Step 1: Create compact realistic OUTCAR fixtures**

The complete fixture must contain `VRHFIN`, `ions per type`, two `direct lattice vectors` blocks, two `POSITION TOTAL-FORCE` tables, `Iteration` lines, and one `free energy TOTEN` line after each force table. The truncated fixture is the same file cut after one row of the second force table.

```text
 VRHFIN =Y: s2p6d1
 VRHFIN =O: s2p4
 ions per type = 1 1
 direct lattice vectors                 reciprocal lattice vectors
  2.0 0.0 0.0   0.5 0.0 0.0
  0.0 2.0 0.0   0.0 0.5 0.0
  0.0 0.0 2.0   0.0 0.0 0.5
 Iteration    1(   1)
 aborting loop because EDIFF is reached
 POSITION                                       TOTAL-FORCE (eV/Angst)
 -----------------------------------------------------------------------------------
  0.0 0.0 0.0   0.10 0.20 0.30
  1.0 1.0 1.0  -0.10 -0.20 -0.30
 -----------------------------------------------------------------------------------
 free  energy   TOTEN  =       -10.000000 eV
```

End the second complete step with `reached required accuracy - stopping structural energy minimisation` so ionic convergence is independently testable.

- [ ] **Step 2: Write failing complete/truncated-step tests**

```python
from pathlib import Path

from vasp_analyzer.parsers.outcar import parse_outcar


FIXTURES = Path(__file__).parents[1] / "fixtures"


def test_two_complete_steps_are_emitted() -> None:
    parsed = parse_outcar(FIXTURES / "OUTCAR.two-steps", atom_count=2)
    assert parsed.elements == ("Y", "O")
    assert len(parsed.steps) == 2
    assert parsed.steps[1].total_energy == -10.25
    assert parsed.steps[1].electronic_converged is True
    assert parsed.ionic_converged is True


def test_trailing_partial_step_is_not_emitted() -> None:
    parsed = parse_outcar(FIXTURES / "OUTCAR.truncated", atom_count=2)
    assert len(parsed.steps) == 1
    assert parsed.incomplete is True
```

- [ ] **Step 3: Verify failure**

Run: `python -m pytest tests/unit/test_outcar_parser.py -v`

Expected: FAIL because `outcar.py` is missing.

- [ ] **Step 4: Implement a line-state parser that finalizes only after TOTEN**

```python
@dataclass(frozen=True)
class RawIonicStep:
    lattice: Mat3
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    total_energy: float
    scf_iterations: int
    electronic_converged: bool | None


@dataclass(frozen=True)
class ParsedOutcar:
    elements: tuple[str, ...]
    steps: tuple[RawIonicStep, ...]
    incomplete: bool
    ionic_converged: bool


def _read_position_force_table(lines: Iterator[tuple[int, str]], atom_count: int) -> tuple[tuple[Vec3, ...], tuple[Vec3, ...]]:
    separator_number, _ = next(lines)
    rows: list[tuple[float, ...]] = []
    for _ in range(atom_count):
        try:
            row_number, row_line = next(lines)
        except StopIteration as error:
            raise IncompleteIonicStep(f"OUTCAR ended after line {separator_number}") from error
        values = row_line.split()
        if len(values) < 6:
            raise IncompleteIonicStep(f"line {row_number}: expected 6 position/force values")
        rows.append(tuple(float(value) for value in values[:6]))
    return (
        tuple(tuple(row[i] for i in range(3)) for row in rows),
        tuple(tuple(row[i] for i in range(3, 6)) for row in rows),
    )


def parse_outcar(path: Path, atom_count: int | None) -> ParsedOutcar:
    elements: list[str] = []
    counts: list[int] = []
    lattice: Mat3 | None = None
    pending_table: tuple[tuple[Vec3, ...], tuple[Vec3, ...]] | None = None
    steps: list[RawIonicStep] = []
    scf_iterations = 0
    electronic_converged: bool | None = None
    ionic_converged = False
    incomplete = False
    lines = iter(enumerate(path.open(encoding="utf-8", errors="replace"), start=1))
    for line_number, line in lines:
        if "VRHFIN" in line:
            elements.append(line.split("=", 1)[1].split(":", 1)[0].strip())
        elif "ions per type" in line:
            counts = [int(value) for value in line.split("=", 1)[1].split()]
            atom_count = atom_count or sum(counts)
        elif "direct lattice vectors" in line:
            rows = [tuple(float(v) for v in next(lines)[1].split()[:3]) for _ in range(3)]
            lattice = tuple(rows)
        elif line.lstrip().startswith("Iteration"):
            scf_iterations += 1
        elif "aborting loop because EDIFF is reached" in line:
            electronic_converged = True
        elif "POSITION" in line and "TOTAL-FORCE" in line:
            try:
                pending_table = _read_position_force_table(lines, atom_count or 0)
            except IncompleteIonicStep:
                incomplete = True
                break
        elif "free  energy   TOTEN" in line and pending_table is not None and lattice is not None:
            energy = float(line.split("=", 1)[1].split()[0])
            steps.append(RawIonicStep(lattice, *pending_table, energy, scf_iterations, electronic_converged))
            pending_table = None
            scf_iterations = 0
            electronic_converged = None
        elif "reached required accuracy - stopping structural energy minimisation" in line:
            ionic_converged = True
    incomplete = incomplete or pending_table is not None
    expanded = tuple(element for element, count in zip(elements, counts) for _ in range(count))
    return ParsedOutcar(
        elements=expanded,
        steps=tuple(steps),
        incomplete=incomplete,
        ionic_converged=ionic_converged,
    )
```

- [ ] **Step 5: Run OUTCAR tests**

Run: `python -m pytest tests/unit/test_outcar_parser.py -v`

Expected: both complete steps parse, and the truncated file exposes only step 0 with `incomplete=True`.

- [ ] **Step 6: Commit**

```bash
git add src/vasp_analyzer/parsers/outcar.py tests/fixtures/OUTCAR.* tests/unit/test_outcar_parser.py
git commit -m "feat: stream ionic steps from OUTCAR"
```

### Task 5: Compute Constraint-Aware Forces and Assemble the Dataset

**Files:**
- Create: `src/vasp_analyzer/analysis/__init__.py`
- Create: `src/vasp_analyzer/analysis/forces.py`
- Create: `src/vasp_analyzer/dataset.py`
- Create: `tests/unit/test_forces.py`
- Create: `tests/integration/test_dataset.py`

**Interfaces:**
- Consumes: `CalculationFiles`, `ParsedPoscar`, `ParsedOutcar`, and Task 1 models.
- Produces: `apply_selective_mask()`, `force_metrics()`, and `load_dataset(path: Path) -> CalculationDataset`.

- [ ] **Step 1: Write a failing fixed-component regression test**

```python
from vasp_analyzer.analysis.forces import force_metrics
from vasp_analyzer.models import SelectiveMask


def test_fixed_largest_component_is_excluded() -> None:
    forces = ((9.0, 0.2, -0.4), (0.5, 0.1, 0.3))
    masks = (
        SelectiveMask(x=False, y=True, z=True),
        SelectiveMask(x=True, y=True, z=True),
    )
    free, strongest, rms = force_metrics(forces, masks)
    assert free[0] == (0.0, 0.2, -0.4)
    assert (strongest.site_index, strongest.axis, strongest.value) == (1, "x", 0.5)
    assert round(rms, 6) == 0.331662


def test_unknown_masks_do_not_produce_constraint_metrics() -> None:
    masks = (SelectiveMask(x=None, y=None, z=None),)
    assert force_metrics(((1.0, 2.0, 3.0),), masks) == (None, None, None)
```

- [ ] **Step 2: Run the force tests and verify failure**

Run: `python -m pytest tests/unit/test_forces.py -v`

Expected: FAIL because `force_metrics` is undefined.

- [ ] **Step 3: Implement the exact metric definition**

```python
from math import sqrt

from vasp_analyzer.models import ForceComponent, SelectiveMask, Vec3


def force_metrics(
    forces: tuple[Vec3, ...], masks: tuple[SelectiveMask, ...]
) -> tuple[tuple[Vec3, ...] | None, ForceComponent | None, float | None]:
    if any(None in mask.as_tuple() for mask in masks):
        return None, None, None
    axes = ("x", "y", "z")
    free = tuple(
        tuple(value if allowed else 0.0 for value, allowed in zip(force, mask.as_tuple(), strict=True))
        for force, mask in zip(forces, masks, strict=True)
    )
    candidates = [
        ForceComponent(site_index=site, axis=axes[axis], value=value)
        for site, (force, mask) in enumerate(zip(forces, masks, strict=True))
        for axis, (value, allowed) in enumerate(zip(force, mask.as_tuple(), strict=True))
        if allowed
    ]
    strongest = max(candidates, key=lambda item: item.magnitude) if candidates else None
    active_values = [
        value
        for force, mask in zip(forces, masks, strict=True)
        for value, allowed in zip(force, mask.as_tuple(), strict=True)
        if allowed
    ]
    rms = sqrt(sum(value * value for value in active_values) / len(active_values))
    return free, strongest, rms
```

- [ ] **Step 4: Write the failing dataset reconciliation test**

```python
def test_dataset_uses_poscar_masks_and_outcar_steps(calculation_dir: Path) -> None:
    dataset = load_dataset(calculation_dir)
    assert dataset.sites[0].selective_dynamics.as_tuple() == (True, False, True)
    assert len(dataset.ionic_steps) == 2
    assert dataset.ionic_steps[1].delta_energy == -0.25
    assert "incomplete" not in " ".join(dataset.warnings).lower()
```

- [ ] **Step 5: Implement `load_dataset` with explicit mismatch errors**

```python
def load_dataset(path: Path) -> CalculationDataset:
    files = discover_calculation(path)
    poscar = parse_poscar(files.poscar) if files.poscar else None
    outcar = parse_outcar(files.outcar, atom_count=len(poscar.sites) if poscar else None)
    if poscar and outcar.elements and tuple(site.element for site in poscar.sites) != outcar.elements:
        raise StructureMismatchError("POSCAR species order does not match OUTCAR")
    sites = poscar.sites if poscar else tuple(
        Site(
            site_index=i,
            element=element,
            selective_dynamics=SelectiveMask(x=None, y=None, z=None),
        )
        for i, element in enumerate(outcar.elements)
    )
    ionic_steps = []
    previous_energy = None
    for index, raw in enumerate(outcar.steps):
        inverse = np.linalg.inv(np.asarray(raw.lattice).T)
        fractional = tuple(tuple(float(v) for v in inverse @ position) for position in raw.cartesian_positions)
        free, strongest, rms = force_metrics(raw.raw_forces, tuple(site.selective_dynamics for site in sites))
        ionic_steps.append(IonicStep(
            index=index,
            lattice=raw.lattice,
            fractional_positions=fractional,
            cartesian_positions=raw.cartesian_positions,
            raw_forces=raw.raw_forces,
            free_forces=free,
            total_energy=raw.total_energy,
            delta_energy=None if previous_energy is None else raw.total_energy - previous_energy,
            scf_iterations=raw.scf_iterations,
            electronic_converged=raw.electronic_converged,
            ionic_converged=outcar.ionic_converged and index == len(outcar.steps) - 1,
            strongest_free_component=strongest,
            rms_free_force=rms,
        ))
        previous_energy = raw.total_energy
    warnings = ("OUTCAR ends with an incomplete ionic step",) if outcar.incomplete else ()
    return CalculationDataset(
        root=str(files.root),
        source_files={"OUTCAR": str(files.outcar), **({"POSCAR": str(files.poscar)} if files.poscar else {})},
        sites=sites,
        ionic_steps=tuple(ionic_steps),
        capabilities=build_capabilities(files),
        warnings=warnings,
    )


def build_capabilities(files: CalculationFiles) -> tuple[Capability, ...]:
    detected = set(files.optional)
    return (
        Capability(name="structure", available=True),
        Capability(name="convergence", available=True),
        Capability(name="dos", available=False,
                   reason="Deferred in 0.1.0; source detected" if detected & {"vasprun.xml", "DOSCAR"} else "Deferred in 0.1.0; source not detected"),
        Capability(name="band", available=False,
                   reason="Deferred in 0.1.0; source detected" if detected & {"vasprun.xml", "EIGENVAL"} else "Deferred in 0.1.0; source not detected"),
        Capability(name="charge", available=False,
                   reason="Deferred in 0.1.0; source detected" if "CHGCAR" in detected else "Deferred in 0.1.0; source not detected"),
    )
```

- [ ] **Step 6: Run unit and integration tests**

Run: `python -m pytest tests/unit/test_forces.py tests/integration/test_dataset.py -v`

Expected: force masking, energy delta, mismatch handling, and unknown-mask behavior PASS.

- [ ] **Step 7: Commit**

```bash
git add src/vasp_analyzer/analysis src/vasp_analyzer/dataset.py tests/unit/test_forces.py tests/integration/test_dataset.py
git commit -m "feat: assemble constraint aware datasets"
```

### Task 6: Add the JSON Protocol, Stdio Server, and CLI

**Files:**
- Create: `src/vasp_analyzer/protocol.py`
- Create: `src/vasp_analyzer/stdio_server.py`
- Create: `src/vasp_analyzer/handoff.py`
- Create: `src/vasp_analyzer/cli.py`
- Create: `tests/unit/test_protocol.py`
- Create: `tests/unit/test_handoff.py`
- Create: `tests/integration/test_stdio_server.py`
- Create: `tests/integration/test_cli.py`

**Interfaces:**
- Consumes: `load_dataset()` and `CalculationDataset`.
- Produces: request methods `getDataset` and `getStep`, response envelopes `{id,result}` and `{id,error}`, `serve_stdio(path)`, `send_handoff(path, endpoint, token) -> bool`, and Typer `app`.

- [ ] **Step 1: Write failing request-correlation and error tests**

```python
def test_get_dataset_round_trip(two_step_calculation: Path) -> None:
    stdin = io.StringIO('{"id":"1","method":"getDataset","params":{}}\n')
    stdout = io.StringIO()
    serve_stdio(two_step_calculation, stdin=stdin, stdout=stdout)
    response = json.loads(stdout.getvalue())
    assert response["id"] == "1"
    assert response["result"]["schemaVersion"] == 1


def test_invalid_method_is_a_correlated_failure(two_step_calculation: Path) -> None:
    stdin = io.StringIO('{"id":"bad","method":"unknown","params":{}}\n')
    stdout = io.StringIO()
    serve_stdio(two_step_calculation, stdin=stdin, stdout=stdout)
    response = json.loads(stdout.getvalue())
    assert response == {"id": "bad", "error": {"code": "unknown_method", "message": "Unknown method: unknown"}}
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest tests/unit/test_protocol.py tests/integration/test_stdio_server.py -v`

Expected: FAIL because protocol and server modules do not exist.

- [ ] **Step 3: Implement discriminated messages and one-line responses**

```python
class Request(BaseModel):
    id: str
    method: Literal["getDataset", "getStep"]
    params: dict[str, object]


def dispatch(request: Request, dataset: CalculationDataset) -> dict[str, object]:
    if request.method == "getDataset":
        return dataset.model_dump(mode="json", by_alias=True)
    if request.method == "getStep":
        index = int(request.params["index"])
        return dataset.ionic_steps[index].model_dump(mode="json", by_alias=True)
    raise UnknownMethodError(request.method)


def serve_stdio(path: Path, stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> None:
    dataset = load_dataset(path)
    for line in stdin:
        raw = json.loads(line)
        request_id = str(raw.get("id", ""))
        try:
            request = Request.model_validate(raw)
            result = dispatch(request, dataset)
            payload = {"id": request.id, "result": result}
        except ValidationError:
            method = raw.get("method")
            payload = {"id": request_id, "error": {"code": "unknown_method", "message": f"Unknown method: {method}"}}
        stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
        stdout.flush()
```

- [ ] **Step 4: Write failing handoff fallback tests**

```python
def test_missing_endpoint_returns_false(tmp_path: Path) -> None:
    assert send_handoff(tmp_path, endpoint=str(tmp_path / "missing.sock"), token="secret") is False


def test_cli_uses_web_fallback_when_handoff_is_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VASP_ANALYZER_ENDPOINT", raising=False)
    result = CliRunner().invoke(app, ["--no-open", str(FIXTURE_CALC)])
    assert result.exit_code == 0
    assert "http://127.0.0.1:" in result.stdout
```

- [ ] **Step 5: Implement endpoint detection and Typer routing**

```python
@app.command()
def main(
    path: Path = typer.Argument(Path.cwd()),
    web: bool = typer.Option(False, "--web"),
    no_open: bool = typer.Option(False, "--no-open"),
    port: int = typer.Option(0, "--port", min=0, max=65535),
) -> None:
    calculation = discover_calculation(path)
    endpoint = os.getenv("VASP_ANALYZER_ENDPOINT")
    token = os.getenv("VASP_ANALYZER_TOKEN")
    if not web and endpoint and token and send_handoff(calculation.root, endpoint, token):
        return
    run_web(calculation.root, port=port, open_browser=not no_open)
```

Implement the handoff client with the same newline framing as the Node endpoint:

```python
def send_handoff(path: Path, endpoint: str, token: str) -> bool:
    payload = json.dumps({"token": token, "path": str(path.resolve())}).encode("utf-8") + b"\n"
    try:
        if os.name == "nt":
            with open(endpoint, "r+b", buffering=0) as pipe:
                pipe.write(payload)
                reply = pipe.readline()
        else:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2.0)
                client.connect(endpoint)
                client.sendall(payload)
                reply = client.makefile("rb").readline()
        return json.loads(reply).get("ok") is True
    except (OSError, TimeoutError, json.JSONDecodeError):
        return False
```

Keep `serve --stdio` as a hidden Typer subcommand invoked only by the extension. Unix socket operations use the explicit two-second timeout; a missing Windows named pipe fails on open. Return `False` only for stale, missing, or malformed endpoints.

- [ ] **Step 6: Run protocol, handoff, and CLI tests**

Run: `python -m pytest tests/unit/test_protocol.py tests/unit/test_handoff.py tests/integration/test_stdio_server.py tests/integration/test_cli.py -v`

Expected: JSON responses remain one line, IDs correlate, and stale handoff falls back cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/vasp_analyzer/protocol.py src/vasp_analyzer/stdio_server.py src/vasp_analyzer/handoff.py src/vasp_analyzer/cli.py tests
git commit -m "feat: add analyzer CLI and stdio protocol"
```

### Task 7: Scaffold and Test the Remote VS Code Extension

**Files:**
- Create: `vscode/package.json`
- Create: `vscode/tsconfig.json`
- Create: `vscode/esbuild.mjs`
- Create: `vscode/src/extension.ts`
- Create: `vscode/src/controlEndpoint.ts`
- Create: `vscode/src/analyzerProcess.ts`
- Create: `vscode/src/webviewHtml.ts`
- Create: `vscode/src/test/controlEndpoint.test.ts`
- Create: `vscode/src/test/analyzerProcess.test.ts`

**Interfaces:**
- Consumes: Python `analyzer serve --stdio` and Task 6 JSON messages.
- Produces: `openAnalyzer(path: vscode.Uri)`, `AnalyzerProcess.request<T>()`, and authenticated terminal handoff.

- [ ] **Step 1: Add extension metadata and remote placement**

```json
{
  "name": "vasp-analyzer",
  "displayName": "VASP Analyzer",
  "version": "0.1.0",
  "engines": {"vscode": "^1.99.0"},
  "extensionKind": ["workspace"],
  "main": "./dist/extension.js",
  "activationEvents": ["onCommand:vaspAnalyzer.open"],
  "contributes": {
    "commands": [{"command": "vaspAnalyzer.open", "title": "VASP Analyzer: Open"}],
    "menus": {
      "explorer/context": [{"command": "vaspAnalyzer.open", "when": "resourceFilename == OUTCAR || explorerResourceIsFolder"}]
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/vscode": "^1.99.0",
    "@vscode/vsce": "latest",
    "esbuild": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Write failing control-endpoint tests**

```typescript
async function sendLine(endpoint: string, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const client = net.createConnection(endpoint, () => client.end(line + "\n"));
    client.on("data", () => undefined);
    client.on("close", resolve);
    client.on("error", reject);
  });
}

it("rejects an incorrect token", async () => {
  const opened: string[] = [];
  const endpoint = await startControlEndpoint("right", path => opened.push(path));
  await sendLine(endpoint.path, JSON.stringify({token: "wrong", path: "/calc"}));
  expect(opened).toEqual([]);
  await endpoint.dispose();
});

it("opens a canonical readable path for the correct token", async () => {
  const opened: string[] = [];
  const endpoint = await startControlEndpoint("right", path => opened.push(path), async () => true);
  await sendLine(endpoint.path, JSON.stringify({token: "right", path: "/calc"}));
  expect(opened).toEqual(["/calc"]);
  await endpoint.dispose();
});
```

- [ ] **Step 3: Verify extension tests fail**

Run: `cd vscode && pnpm install && pnpm test`

Expected: FAIL because endpoint and process implementations are missing. Commit `pnpm-lock.yaml` after install.

- [ ] **Step 4: Implement socket lifecycle and terminal variables**

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const endpoint = await startControlEndpoint(token, path => openAnalyzer(vscode.Uri.file(path)));
  context.environmentVariableCollection.replace("VASP_ANALYZER_ENDPOINT", endpoint.path);
  context.environmentVariableCollection.replace("VASP_ANALYZER_TOKEN", token);
  context.environmentVariableCollection.description = "Routes analyzer commands to the VASP Analyzer Webview";
  context.subscriptions.push(endpoint, vscode.commands.registerCommand("vaspAnalyzer.open", openAnalyzer));
}
```

Implement the endpoint with bounded input and constant-time token comparison:

```typescript
export async function startControlEndpoint(
  token: string,
  onOpen: (path: string) => void | Promise<void>,
  readable: (path: string) => Promise<void> = path => fs.access(path, fsConstants.R_OK),
): Promise<{path: string; dispose(): Promise<void>}> {
  const endpointPath = process.platform === "win32"
    ? `\\\\.\\pipe\\vasp-analyzer-${randomUUID()}`
    : join(await fs.mkdtemp(join(tmpdir(), "vasp-analyzer-")), "control.sock");
  const server = net.createServer(socket => {
    let input = Buffer.alloc(0);
    socket.on("data", chunk => {
      input = Buffer.concat([input, chunk]);
      if (input.length > 8192) socket.destroy(new Error("handoff message exceeds 8 KiB"));
      if (!input.includes(10)) return;
      void (async () => {
        try {
          const message = JSON.parse(input.subarray(0, input.indexOf(10)).toString("utf8"));
          const supplied = Buffer.from(String(message.token));
          const expected = Buffer.from(token);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("invalid token");
          const canonical = await fs.realpath(String(message.path));
          await readable(canonical);
          await onOpen(canonical);
          socket.end('{"ok":true}\n');
        } catch (error) {
          socket.end('{"ok":false}\n');
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => server.listen(endpointPath, resolve).once("error", reject));
  return {path: endpointPath, dispose: () => new Promise(resolve => server.close(() => resolve()))};
}
```

Create the Unix endpoint directory with mode `0700` and remove it on dispose. The Windows endpoint uses a random name under `\\.\pipe\`.

- [ ] **Step 5: Implement correlated stdio requests**

```typescript
export class AnalyzerProcess implements vscode.Disposable {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, {resolve(value: unknown): void; reject(error: Error): void}>();

  constructor(path: string) {
    this.child = spawn("analyzer", ["serve", "--stdio", path], {stdio: "pipe"});
    createInterface({input: this.child.stdout}).on("line", line => this.handleLine(line));
  }

  request<T>(method: "getDataset" | "getStep", params: object = {}): Promise<T> {
    const id = randomUUID();
    this.child.stdin.write(JSON.stringify({id, method, params}) + "\n");
    return new Promise<T>((resolve, reject) => this.pending.set(id, {resolve, reject}));
  }

  private handleLine(line: string): void {
    const message = JSON.parse(line) as {id: string; result?: unknown; error?: {message: string}};
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  dispose(): void {
    this.child.kill();
    for (const pending of this.pending.values()) pending.reject(new Error("Analyzer process stopped"));
    this.pending.clear();
  }
}
```

Reject all pending requests if the process exits, route stderr to a named VS Code output channel, and never render stderr as HTML.

- [ ] **Step 6: Create a CSP-restricted Webview panel**

```typescript
const panel = vscode.window.createWebviewPanel(
  "vaspAnalyzer",
  `VASP Analyzer: ${path.basename(uri.fsPath)}`,
  vscode.ViewColumn.One,
  {enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot]},
);
panel.webview.html = webviewHtml(panel.webview, mediaRoot, nonce);
panel.webview.onDidReceiveMessage(message => bridgeWebviewMessage(message, analyzer, panel.webview));
```

The CSP must use `default-src 'none'`, allow scripts only with the generated nonce, allow styles and images only from the Webview source, and contain no `http:` or `https:` origins.

- [ ] **Step 7: Run extension tests and type checking**

Run: `cd vscode && pnpm test && pnpm typecheck && pnpm build`

Expected: endpoint authentication, subprocess correlation, CSP generation, type checking, and bundling PASS.

- [ ] **Step 8: Commit**

```bash
git add vscode/package.json vscode/pnpm-lock.yaml vscode/tsconfig.json vscode/esbuild.mjs vscode/src
git commit -m "feat: add remote VS Code analyzer shell"
```

### Task 8: Build the Webview Host, State Store, and Split Layout

**Files:**
- Create: `vscode/webview/index.html`
- Create: `vscode/webview/src/main.tsx`
- Create: `vscode/webview/src/contracts.ts`
- Create: `vscode/webview/src/host.ts`
- Create: `vscode/webview/src/store.ts`
- Create: `vscode/webview/src/App.tsx`
- Create: `vscode/webview/src/styles.css`
- Create: `vscode/webview/src/store.test.ts`
- Modify: `vscode/package.json`
- Modify: `vscode/esbuild.mjs`

**Interfaces:**
- Consumes: Task 7 message bridge and Task 1 JSON schema.
- Produces: `AnalyzerHost`, `AnalyzerState`, `useAnalyzerStore`, and the upper/lower analysis shell used by renderer and charts.

- [ ] **Step 1: Add React, Vite, 3Dmol.js, and chart dependencies**

Run: `cd vscode && pnpm add react react-dom 3dmol uplot zustand && pnpm add -D @types/react @types/react-dom @vitejs/plugin-react vite jsdom @testing-library/react`

Expected: `package.json` and `pnpm-lock.yaml` update; no runtime network loads are added to source.

- [ ] **Step 2: Write failing synchronized-state tests**

```typescript
it("clamps step selection and preserves selected site", () => {
  const store = createAnalyzerStore(datasetWithTwoSteps);
  store.getState().selectSite(7);
  store.getState().selectStep(99);
  expect(store.getState().selectedStep).toBe(1);
  expect(store.getState().selectedSite).toBe(7);
});

it("uses free force vectors by default", () => {
  const store = createAnalyzerStore(datasetWithTwoSteps);
  expect(store.getState().forceMode).toBe("free");
  expect(store.getState().forceScale).toBe(1);
});
```

- [ ] **Step 3: Verify failure**

Run: `cd vscode && pnpm test -- store.test.ts`

Expected: FAIL because the store is missing.

- [ ] **Step 4: Implement host and state contracts**

```typescript
import {createStore} from "zustand/vanilla";

export interface AnalyzerHost {
  request<T>(method: "getDataset" | "getStep", params?: Record<string, unknown>): Promise<T>;
  saveState(state: PersistedState): void;
  restoreState(): PersistedState | undefined;
}

export type AnalyzerState = {
  dataset: CalculationDataset;
  selectedStep: number;
  selectedSite: number | null;
  forceMode: "free" | "raw";
  forceScale: number;
  supercell: [number, number, number];
  layers: {cell: boolean; bonds: boolean; forces: boolean; selective: boolean; volumetric: boolean};
  selectStep(step: number): void;
  selectSite(site: number | null): void;
};

export function createAnalyzerStore(dataset: CalculationDataset) {
  return createStore<AnalyzerState>()((set) => ({
    dataset,
    selectedStep: 0,
    selectedSite: null,
    forceMode: "free",
    forceScale: 1,
    supercell: [1, 1, 1],
    layers: {cell: true, bonds: true, forces: true, selective: true, volumetric: false},
    selectStep: step => set({selectedStep: Math.max(0, Math.min(step, dataset.ionicSteps.length - 1))}),
    selectSite: site => set({selectedSite: site}),
  }));
}
```

Generate `contracts.ts` from committed JSON schema during development, then check the generated file into the extension so runtime Python is not needed to load the Webview.

- [ ] **Step 5: Implement the approved split layout**

```tsx
export function App(): JSX.Element {
  return (
    <main className="analysis-shell">
      <section className="structure-region" aria-label="Crystal structure">
        <div id="crystal-host" role="img" aria-label="Crystal renderer host" />
      </section>
      <section className="analysis-region" aria-label="Analysis details">
        <nav className="analysis-tabs" aria-label="Analysis type">
          <button aria-selected="true">Convergence</button>
          <button disabled>DOS/PDOS</button>
          <button disabled>Band</button>
          <button disabled>Charge</button>
        </nav>
        <div id="convergence-host" aria-live="polite">Convergence data loaded</div>
      </section>
    </main>
  );
}
```

Task 9 replaces `crystal-host` with `CrystalPanel`; Task 10 replaces `convergence-host` with `ConvergencePanel`. Task 8's shell is a compilable checkpoint for host messaging, persistence, and responsive layout.

Use only VS Code theme variables, keep the structure region at least 55% of available height, stack the plots below 820 px editor width, and restore step/site/camera state through `vscode.setState`.

- [ ] **Step 6: Run Webview tests and production build**

Run: `cd vscode && pnpm test && pnpm typecheck && pnpm build`

Expected: store and layout tests PASS; production bundle contains local hashed assets only.

- [ ] **Step 7: Commit**

```bash
git add vscode/package.json vscode/pnpm-lock.yaml vscode/esbuild.mjs vscode/webview
git commit -m "feat: add analyzer Webview workspace"
```

### Task 9: Implement the Crystallographic 3D Renderer

**Files:**
- Create: `vscode/webview/src/renderers/CrystalRenderer.ts`
- Create: `vscode/webview/src/renderers/ThreeDmolRenderer.ts`
- Create: `vscode/webview/src/renderers/geometry.ts`
- Create: `vscode/webview/src/renderers/geometry.test.ts`
- Create: `vscode/webview/src/components/CrystalPanel.tsx`
- Create: `vscode/webview/src/components/AtomDetail.tsx`
- Create: `vscode/webview/src/components/CrystalPanel.test.tsx`

**Interfaces:**
- Consumes: current `IonicStep`, `Site[]`, and Webview store from Task 8.
- Produces: `CrystalRenderer.setFrame()`, `setSupercell()`, `setForceScale()`, `setLayers()`, `setViewDirection()`, `setVolumetricLayer()`, and `dispose()`.

- [ ] **Step 1: Write failing lattice-direction and image-identity tests**

```typescript
it("maps a direct-lattice [uvw] direction into Cartesian space", () => {
  const lattice = [[2, 0, 0], [0.5, 3, 0], [0, 0, 4]] as Mat3;
  const direction = normalizedDirectDirection([1, 1, 0], lattice);
  expect(direction[0]).toBeCloseTo(2.5 / 3.9051, 4);
  expect(direction[1]).toBeCloseTo(3 / 3.9051, 4);
  expect(direction[2]).toBeCloseTo(0, 4);
});

it("retains original site identity in a 2x1x1 supercell", () => {
  const images = replicateSites([{siteIndex: 3, fractional: [0, 0, 0]}], [2, 1, 1]);
  expect(images.map(image => [image.siteIndex, image.image])).toEqual([[3, [0, 0, 0]], [3, [1, 0, 0]]]);
});
```

- [ ] **Step 2: Verify geometry tests fail**

Run: `cd vscode && pnpm test -- geometry.test.ts`

Expected: FAIL because geometry helpers are missing.

- [ ] **Step 3: Implement the renderer interface before 3Dmol details**

```typescript
export type VolumetricLayer = {
  id: string;
  lattice: Mat3;
  dimensions: [number, number, number];
  values?: Float32Array;
  mesh?: {positions: Float32Array; normals: Float32Array; indices: Uint32Array};
  positiveIso: number;
  negativeIso: number | null;
  opacity: number;
};

export interface CrystalRenderer {
  setFrame(sites: Site[], step: IonicStep): void;
  setSupercell(repeat: [number, number, number]): void;
  setForceScale(scale: number, mode: "free" | "raw"): void;
  setLayers(layers: AnalyzerState["layers"]): void;
  setViewDirection(direction: [number, number, number]): void;
  selectSite(siteIndex: number | null): void;
  setVolumetricLayer(layer: VolumetricLayer | null): void;
  dispose(): void;
}
```

Implement the tested geometry helpers in `geometry.ts`:

```typescript
export function normalizedDirectDirection(uvw: Vec3, lattice: Mat3): Vec3 {
  const cartesian: Vec3 = [
    uvw[0] * lattice[0][0] + uvw[1] * lattice[1][0] + uvw[2] * lattice[2][0],
    uvw[0] * lattice[0][1] + uvw[1] * lattice[1][1] + uvw[2] * lattice[2][1],
    uvw[0] * lattice[0][2] + uvw[1] * lattice[1][2] + uvw[2] * lattice[2][2],
  ];
  const length = Math.hypot(...cartesian);
  if (length === 0) throw new Error("View direction cannot be [0 0 0]");
  return cartesian.map(value => value / length) as Vec3;
}

export function replicateSites(sites: ImageSite[], repeat: [number, number, number]): ImageSite[] {
  return sites.flatMap(site =>
    Array.from({length: repeat[0]}, (_, a) =>
      Array.from({length: repeat[1]}, (_, b) =>
        Array.from({length: repeat[2]}, (_, c) => ({...site, image: [a, b, c] as Vec3})),
      ).flat(),
    ).flat(),
  );
}

export const add = (left: Vec3, right: Vec3): Vec3 => left.map((v, i) => v + right[i]) as Vec3;
export const scale = (vector: Vec3, factor: number): Vec3 => vector.map(v => v * factor) as Vec3;
export const xyz = ([x, y, z]: Vec3) => ({x, y, z});
```

- [ ] **Step 4: Implement 3Dmol atoms, periodic cell, supercell, and selection**

Create one model with atom properties `siteIndex`, `imageA`, `imageB`, and `imageC`. Add the unit cell from the frame lattice, call `replicateUnitCell(a, b, c, model, true)`, and call `setClickable` for all atoms. The callback sends the original `siteIndex` to the store. Rebuild the model only when the ionic frame or supercell changes; camera-only and force-scale changes update scene objects in place.

```typescript
this.viewer.setClickable({}, true, atom => {
  this.onSelect(Number(atom.properties?.siteIndex));
});
this.viewer.addUnitCell(model, {box: {color: "#808080"}});
this.viewer.replicateUnitCell(a, b, c, model, true);
```

Do not hardcode atom colors in React. Use a renderer-owned element palette and expose the same palette to the legend.

- [ ] **Step 5: Add force arrows and Selective Dynamics glyphs**

```typescript
for (const [index, position] of step.cartesianPositions.entries()) {
  const vector = forceMode === "free" ? step.freeForces?.[index] : step.rawForces[index];
  if (vector && layers.forces) {
    this.viewer.addArrow({
      start: xyz(position),
      end: xyz(add(position, scale(vector, forceScale))),
      radius: 0.06,
      color: strongestSite === index ? "orange" : "crimson",
    });
  }
}
```

For the selected or hovered atom, draw three short local Cartesian cylinders. Use a solid arrow for `T`, a capped/crossed glyph for `F`, and a neutral dotted glyph for unknown. Global Selective Dynamics mode marks only sites containing at least one `F` component to prevent clutter.

- [ ] **Step 6: Add unit-cell axes and crystallographic view controls**

Use a small renderer overlay for `a`, `b`, and `c`. Label direct-lattice view input as `[u v w]`; accept the legacy UI label `[h k l]` only as an alias with an explanatory tooltip because plane normals and direct directions differ in non-cubic cells. Normalize `u*a + v*b + w*c` before setting the camera quaternion.

- [ ] **Step 7: Render the selected atom details**

```tsx
function VectorRow({label, value}: {label: string; value: Vec3 | null}): JSX.Element {
  return <><dt>{label}</dt><dd>{value ? value.map(v => v.toFixed(6)).join(", ") : "Unavailable"}</dd></>;
}


function SelectiveRow({value}: {value: SelectiveMask}): JSX.Element {
  const format = (flag: boolean | null) => flag === null ? "?" : flag ? "T" : "F";
  return <><dt>Selective Dynamics</dt><dd>{[value.x, value.y, value.z].map(format).join(" · ")}</dd></>;
}


export function AtomDetail({site, step}: Props): JSX.Element {
  const raw = step.rawForces[site.siteIndex];
  const free = step.freeForces?.[site.siteIndex] ?? null;
  return <aside aria-label={`Atom ${site.siteIndex + 1} details`}><dl>
    <h3>{site.element} {site.siteIndex + 1}</h3>
    <VectorRow label="Fractional" value={step.fractionalPositions[site.siteIndex]} />
    <VectorRow label="Cartesian (Å)" value={step.cartesianPositions[site.siteIndex]} />
    <VectorRow label="Raw force (eV/Å)" value={raw} />
    <VectorRow label="Free force (eV/Å)" value={free} />
    <SelectiveRow value={site.selectiveDynamics} />
  </dl></aside>;
}
```

- [ ] **Step 8: Run renderer helper, component, and offline bundle tests**

Run: `cd vscode && pnpm test && pnpm typecheck && pnpm build && rg -n "(src|href)=[\"']https?://|fetch\([\"']https?://" dist/webview`

Expected: tests/build PASS; `rg` finds no runtime URL in emitted Webview assets.

- [ ] **Step 9: Commit**

```bash
git add vscode/webview/src/renderers vscode/webview/src/components/CrystalPanel* vscode/webview/src/components/AtomDetail*
git commit -m "feat: add crystallographic structure viewer"
```

### Task 10: Synchronize Convergence Charts and Ionic Steps

**Files:**
- Create: `vscode/webview/src/components/ConvergencePanel.tsx`
- Create: `vscode/webview/src/components/ConvergencePanel.test.tsx`
- Create: `vscode/webview/src/components/IonicStepControl.tsx`
- Create: `vscode/webview/src/components/IonicStepControl.test.tsx`
- Create: `vscode/webview/src/components/UPlotChart.tsx`
- Create: `vscode/webview/src/analysisSeries.ts`
- Modify: `vscode/webview/src/App.tsx`

**Interfaces:**
- Consumes: `CalculationDataset` and `selectStep()` from Task 8.
- Produces: click/slider synchronization for energy, delta energy, strongest free component, RMS force, SCF count, and exact step values.

- [ ] **Step 1: Write failing synchronization tests**

```tsx
it("selecting a force point moves the shared ionic step", async () => {
  render(<ConvergencePanel />, {wrapper: StoreWithTwoSteps});
  await user.click(screen.getByLabelText("Force at ionic step 2"));
  expect(screen.getByLabelText("Ionic step")).toHaveValue("1");
  expect(screen.getByText("−10.250000 eV")).toBeVisible();
});

it("reports unavailable free-force metrics when masks are unknown", () => {
  render(<ConvergencePanel />, {wrapper: StoreWithUnknownMasks});
  expect(screen.getByText("Selective Dynamics unavailable")).toBeVisible();
});
```

- [ ] **Step 2: Verify failure**

Run: `cd vscode && pnpm test -- ConvergencePanel.test.tsx IonicStepControl.test.tsx`

Expected: FAIL because the components are absent.

- [ ] **Step 3: Implement directly labeled uPlot series and exact values**

```tsx
const format = (value: number): string => value.toFixed(6).replace("-", "−");
const formatOptional = (value: number | null, unit: string): string =>
  value === null ? "Unavailable" : `${format(value)} ${unit}`;
const formatComponent = (value: ForceComponent | null): string =>
  value === null ? "Selective Dynamics unavailable" :
    `${value.siteIndex + 1} · F${value.axis} ${format(value.value)} eV/Å`;

function Metric({label, value}: {label: string; value: string}): JSX.Element {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}

const step = dataset.ionicSteps[selectedStep];
return <>
  <IonicStepControl value={selectedStep} max={dataset.ionicSteps.length - 1} onChange={selectStep} />
  <div className="convergence-plots">
    <UPlotChart ariaLabel="Energy convergence" series={energySeries(dataset)} onPoint={selectStep} />
    <UPlotChart ariaLabel="Force convergence" series={forceSeries(dataset)} onPoint={selectStep} />
  </div>
  <dl className="step-values">
    <Metric label="TOTEN" value={`${format(step.totalEnergy)} eV`} />
    <Metric label="ΔE" value={formatOptional(step.deltaEnergy, "eV")} />
    <Metric label="Max free component" value={formatComponent(step.strongestFreeComponent)} />
    <Metric label="RMS free force" value={formatOptional(step.rmsFreeForce, "eV/Å")} />
    <Metric label="SCF iterations" value={String(step.scfIterations)} />
  </dl>
</>;
```

Define chart inputs in `analysisSeries.ts` and keep missing free-force values as gaps rather than zero:

```typescript
export type PlotPoint = {step: number; value: number | null; ariaLabel: string};

export const energySeries = (dataset: CalculationDataset): PlotPoint[] =>
  dataset.ionicSteps.map(step => ({
    step: step.index,
    value: step.totalEnergy,
    ariaLabel: `Energy at ionic step ${step.index + 1}: ${step.totalEnergy} eV`,
  }));

export const forceSeries = (dataset: CalculationDataset): PlotPoint[] =>
  dataset.ionicSteps.map(step => ({
    step: step.index,
    value: step.strongestFreeComponent?.magnitude ?? null,
    ariaLabel: step.strongestFreeComponent
      ? `Force at ionic step ${step.index + 1}: ${step.strongestFreeComponent.magnitude} eV per angstrom`
      : `Force at ionic step ${step.index + 1}: unavailable`,
  }));
```

`UPlotChart` owns the uPlot instance and exposes every point as a keyboard-accessible button over the plot. Clicking a canvas point or its button calls the same callback:

```tsx
export function UPlotChart({ariaLabel, series, onPoint}: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const valid = series.filter(point => point.value !== null);
    const styles = getComputedStyle(document.documentElement);
    const plot = new uPlot({
      width: Math.max(host.current.clientWidth, 320),
      height: 180,
      title: ariaLabel,
      axes: [{label: "Ionic step"}, {label: ariaLabel.includes("Energy") ? "eV" : "eV/Å"}],
      series: [{}, {stroke: styles.getPropertyValue("--vscode-charts-blue").trim()}],
    }, [
      valid.map(point => point.step),
      valid.map(point => point.value as number),
    ], host.current);
    const click = () => {
      if (plot.cursor.idx !== null && plot.cursor.idx !== undefined) onPoint(valid[plot.cursor.idx].step);
    };
    host.current.addEventListener("click", click);
    const resize = new ResizeObserver(entries => plot.setSize({width: Math.max(entries[0].contentRect.width, 320), height: 180}));
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      host.current?.removeEventListener("click", click);
      plot.destroy();
    };
  }, [ariaLabel, series, onPoint]);
  return <div className="plot" aria-label={ariaLabel}>
    <div ref={host} />
    <div className="sr-only">
      {series.map(point => <button key={point.step} aria-label={point.ariaLabel} onClick={() => onPoint(point.step)} />)}
    </div>
  </div>;
}
```

Use one selected-step source in the store. Do not maintain a separate chart cursor state. Plot point keyboard buttons must expose exact step/value labels.

- [ ] **Step 4: Add reduced-motion frame interpolation**

Interpolate coordinates and arrows for 150 ms only when `prefers-reduced-motion` is false. The store changes immediately; animation is renderer presentation state and cannot delay exact values.

- [ ] **Step 5: Run Webview tests**

Run: `cd vscode && pnpm test && pnpm typecheck && pnpm build`

Expected: chart click, slider movement, exact values, unknown masks, and reduced-motion branches PASS.

- [ ] **Step 6: Commit**

```bash
git add vscode/webview/src/components/ConvergencePanel* vscode/webview/src/components/IonicStepControl* vscode/webview/src/App.tsx
git commit -m "feat: synchronize ionic convergence views"
```

### Task 11: Add Volumetric Contracts, Error Isolation, and Table Fallback

**Files:**
- Create: `src/vasp_analyzer/volumetric.py`
- Create: `tests/unit/test_volumetric.py`
- Create: `vscode/webview/src/components/DataTableFallback.tsx`
- Create: `vscode/webview/src/components/DataTableFallback.test.tsx`
- Modify: `src/vasp_analyzer/protocol.py`
- Modify: `src/vasp_analyzer/stdio_server.py`
- Modify: `vscode/webview/src/App.tsx`

**Interfaces:**
- Consumes: lattice/site contracts and renderer `VolumetricLayer` hook.
- Produces: `VolumetricDescriptor`, `VolumetricRequest`, cache-key validation, capability-scoped failures, and WebGL fallback tables.

- [ ] **Step 1: Write failing lattice compatibility and cache-key tests**

```python
def test_volumetric_grid_rejects_mismatched_lattice() -> None:
    descriptor = VolumetricDescriptor(source="CHGCAR", lattice=IDENTITY, dimensions=(8, 8, 8), kind="charge")
    with pytest.raises(VolumetricAlignmentError):
        descriptor.require_compatible_structure(((2.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))


def test_mesh_cache_key_includes_isovalue_and_downsample() -> None:
    first = mesh_cache_key(FINGERPRINT, isovalue=0.02, downsample=2, repeat=(1, 1, 1))
    second = mesh_cache_key(FINGERPRINT, isovalue=0.03, downsample=2, repeat=(1, 1, 1))
    assert first != second
```

- [ ] **Step 2: Implement descriptor/request contracts without CHGCAR parsing**

```python
class VolumetricDescriptor(FrozenModel):
    source: str
    lattice: Mat3
    dimensions: tuple[int, int, int]
    kind: Literal["charge", "charge_difference", "elf", "potential"]
    units: str
    value_range: tuple[float, float]

    def require_compatible_structure(self, lattice: Mat3, atol: float = 1e-6) -> None:
        if not np.allclose(self.lattice, lattice, atol=atol, rtol=0.0):
            raise VolumetricAlignmentError(f"{self.source} lattice does not match selected structure")


class VolumetricRequest(FrozenModel):
    source: str
    mode: Literal["isosurface", "slice"]
    isovalue: float | None = None
    axis: Literal["a", "b", "c"] | None = None
    fraction: float | None = None
    downsample: int = 1
    repeat: tuple[int, int, int] = (1, 1, 1)
```

Add the protocol method now but return a typed `capability_unavailable` response until a future charge-analysis task provides a reader. This locks the message and renderer boundaries without pretending the feature is implemented.

- [ ] **Step 3: Write and implement WebGL failure fallback tests**

```tsx
it("shows coordinates, forces, and steps when WebGL fails", () => {
  render(<App rendererFactory={() => { throw new Error("WebGL unavailable"); }} />, {wrapper: StoreWithTwoSteps});
  expect(screen.getByRole("table", {name: "Atomic positions and forces"})).toBeVisible();
  expect(screen.getByText("WebGL unavailable")).toBeVisible();
  expect(screen.getByLabelText("Ionic step")).toBeEnabled();
});
```

`DataTableFallback` must show site index, element, fractional and Cartesian positions, raw/free forces, and `T/F/?` flags for the selected step. Parser warnings and optional-module failures render as dismissible messages without removing structure/convergence state.

- [ ] **Step 4: Run Python and Webview tests**

Run: `python -m pytest tests/unit/test_volumetric.py -v && cd vscode && pnpm test && pnpm build`

Expected: volumetric contracts PASS and forced WebGL failure leaves the data table and step controls usable.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/volumetric.py src/vasp_analyzer/protocol.py src/vasp_analyzer/stdio_server.py tests/unit/test_volumetric.py vscode/webview/src/components/DataTableFallback* vscode/webview/src/App.tsx
git commit -m "feat: add volumetric contracts and safe fallback"
```

### Task 12: Package the Web Fallback, CI, Documentation, and End-to-End Acceptance

**Files:**
- Create: `src/vasp_analyzer/web.py`
- Create: `tests/integration/test_web.py`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `vscode/README.md`
- Modify: `pyproject.toml`
- Modify: `vscode/esbuild.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: built Webview assets, `load_dataset`, and all prior tests.
- Produces: loopback-only `analyzer --web`, distributable wheel/VSIX, CI gates, and user installation instructions.

- [ ] **Step 1: Write failing loopback and offline-asset tests**

```python
def test_web_server_binds_loopback_and_serves_dataset(two_step_calculation: Path) -> None:
    app = create_web_app(two_step_calculation)
    client = TestClient(app)
    assert client.get("/api/dataset").json()["schemaVersion"] == 1
    html = client.get("/").text
    assert "https://" not in html
    assert "http://" not in html


def test_static_path_cannot_escape_asset_root(two_step_calculation: Path) -> None:
    client = TestClient(create_web_app(two_step_calculation))
    assert client.get("/assets/../../POSCAR").status_code in {404, 400}
```

- [ ] **Step 2: Implement the HTTP host adapter and loopback server**

```python
import socket
import webbrowser
from importlib.resources import files


def asset_root() -> Path:
    return Path(str(files("vasp_analyzer") / "web_assets"))


def create_web_app(path: Path) -> FastAPI:
    dataset = load_dataset(path)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/api/dataset")
    def get_dataset() -> dict[str, object]:
        return dataset.model_dump(mode="json", by_alias=True)

    app.mount("/assets", StaticFiles(directory=asset_root()), name="assets")

    @app.get("/", response_class=FileResponse)
    def index() -> Path:
        return asset_root() / "index.html"

    return app


def run_web(path: Path, port: int, open_browser: bool) -> None:
    selected_port = port
    if selected_port == 0:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            selected_port = int(probe.getsockname()[1])
    url = f"http://127.0.0.1:{selected_port}"
    typer.echo(url)
    if open_browser and not os.getenv("SSH_CONNECTION"):
        webbrowser.open(url)
    uvicorn.run(create_web_app(path), host="127.0.0.1", port=selected_port, log_level="warning")
```

`run_web()` binds only `127.0.0.1`, selects an available port when `0`, prints one clickable URL, and calls `webbrowser.open` only outside Remote SSH unless the user explicitly passed `--web` without `--no-open`. The Webview bundle chooses `HttpHost` when `acquireVsCodeApi` is absent.

Package the already-built Webview output into the wheel without requiring Node.js at runtime:

```toml
[tool.hatch.build.targets.wheel.force-include]
"vscode/dist/webview" = "vasp_analyzer/web_assets"

[tool.hatch.build.targets.sdist]
include = ["src", "vscode/dist/webview", "README.md", "pyproject.toml"]
```

- [ ] **Step 3: Add Linux/Windows CI**

```yaml
name: ci
on: [push, pull_request]
jobs:
  python:
    strategy:
      matrix: {os: [ubuntu-latest, windows-latest], python: ["3.11", "3.13"]}
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: "${{ matrix.python }}"}
      - run: python -m pip install -e .[dev]
      - run: python -m ruff check src tests
      - run: python -m pytest --cov=vasp_analyzer --cov-report=term-missing
  webview:
    strategy:
      matrix: {os: [ubuntu-latest, windows-latest]}
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: {node-version: 24, cache: pnpm, cache-dependency-path: vscode/pnpm-lock.yaml}
      - uses: actions/setup-python@v5
        with: {python-version: "3.13"}
      - run: pnpm install --frozen-lockfile
        working-directory: vscode
      - run: pnpm test
        working-directory: vscode
      - run: pnpm typecheck
        working-directory: vscode
      - run: pnpm build
        working-directory: vscode
      - if: matrix.os == 'ubuntu-latest'
        run: python -m pip install build && python -m build
      - if: matrix.os == 'ubuntu-latest'
        run: pnpm exec vsce package --no-dependencies
        working-directory: vscode
```

- [ ] **Step 4: Document exact install and use paths**

README must contain:

```text
pipx install vasp-analyzer
code --install-extension vasp-analyzer-0.1.0.vsix

cd /path/to/calculation
analyzer
analyzer OUTCAR
analyzer /path/to/calculation
analyzer --web --no-open
```

Also document that existing terminals must be restarted once after extension installation so endpoint variables are injected; OUTCAR-only runs cannot provide constraint-aware metrics when Selective Dynamics is absent; root VASP outputs are ignored for privacy and size; and charge, DOS, and band tabs are reserved but disabled in 0.1.0.

- [ ] **Step 5: Run the full acceptance suite**

Run:

```bash
cd vscode
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm exec vsce package --no-dependencies
cd ..
python -m pytest -v
python -m ruff check src tests
python -m build
```

Expected: all Python/TypeScript tests PASS; wheel/sdist and `vasp-analyzer-0.1.0.vsix` are created; production Webview assets contain no external runtime URLs.

- [ ] **Step 6: Perform a manual Remote SSH smoke test**

On a disposable remote calculation fixture:

1. Install the built wheel with `pipx install dist/vasp_analyzer-0.1.0-py3-none-any.whl`.
2. Install the VSIX locally and reload the Remote SSH window.
3. Open a new integrated terminal in the fixture directory and run `analyzer`.
4. Verify a VS Code tab opens with no forwarded port.
5. Select the second ionic step and confirm atoms, forces, energy point, force point, and exact values all change together.
6. Click both original and replicated supercell atoms and confirm they select the same original site.
7. Confirm the fixed `9.0 eV/Å` test component is not reported as the strongest free component.
8. Disconnect network access, reload the Webview, and confirm it still renders.
9. Force WebGL initialization failure and confirm the table fallback remains usable.

- [ ] **Step 7: Commit the releasable first version**

```bash
git add pyproject.toml src/vasp_analyzer/web.py tests/integration/test_web.py .github/workflows/ci.yml README.md vscode/README.md vscode/esbuild.mjs .gitignore
git commit -m "docs: add packaging and acceptance workflow"
```

---

## Final Verification Checklist

- [ ] Every design acceptance criterion maps to at least one automated or manual test above.
- [ ] A scan for unfinished-marker words returns no matches in this plan.
- [ ] Python model names match TypeScript contract names after generation.
- [ ] All JSON method names match exactly: `getDataset`, `getStep`, and reserved `getVolumetric`.
- [ ] Real root-level VASP outputs remain ignored and no fixture contains proprietary calculation data.
- [ ] `git status --short` is clean before the branch-completion workflow.
