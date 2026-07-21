# SIESTA Optimization Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three standalone SIESTA utilities on the SSH host for k-point scans, independent energy-parameter scans, and slab/bulk EOS fitting.

**Architecture:** Each Python script is self-contained and operates on a base calculation containing `in/*.fdf`. It clones inputs into isolated cases, writes a SLURM/local runner, records JSON metadata, parses SIESTA output, and writes CSV/PNG results; EOS additionally scales structures and writes a fitted structure. Tests import each script directly from `/home/emsl_intern/SIESTA` and use temporary fixtures without submitting jobs.

**Tech Stack:** Python 3, argparse, pathlib, json, csv, shutil, subprocess, re; NumPy, SciPy, Matplotlib; pytest; SIESTA 5.4.2; SLURM.

## Global Constraints

- Create `/home/emsl_intern/SIESTA/kpoints_opt.py`, `/home/emsl_intern/SIESTA/energy_opt.py`, and `/home/emsl_intern/SIESTA/eos_fitting.py`; do not create a shared project module.
- Keep every utility usable through `pyutility <script-name>` from descendant calculation directories.
- Support `-h`, `--help`, `-help`, and no-argument top-level help.
- Never modify the source `in/` directory.
- Default execution is `slurm`, with `local` and `prepare` alternatives and 16 MPI tasks by default.
- K-point and energy scans produce data and plots but never select an optimum.
- EOS creates a fitted structure only when the fitted equilibrium is positive and inside the sampled interval.
- Cleanup can remove only the selected generated scan root and must require confirmation unless `--yes` is passed.
- Tests and final smoke checks must not submit a real calculation.

---

### Task 1: K-point scan utility

**Files:**
- Create: `/home/emsl_intern/SIESTA/kpoints_opt.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_kpoints_opt.py`

**Interfaces:**
- Consumes: a base directory with `in/RUN.fdf`, `in/STRUCT.fdf`, `in/KPT.fdf`, and `in/BASIS.fdf`.
- Produces: `parse_integer_range(text: str) -> list[int]`, `grid_for(system: str, n: int, vacuum_axis: str) -> tuple[int, int, int]`, `replace_kgrid(text: str, grid: tuple[int, int, int]) -> str`, `parse_siesta_output(path: Path) -> tuple[str, float | None]`, and CLI `main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: Write failing unit tests for ranges, slab/bulk grids, block replacement, and output status**

```python
# /home/emsl_intern/SIESTA/tests/test_kpoints_opt.py
from pathlib import Path
import importlib.util

MODULE_PATH = Path("/home/emsl_intern/SIESTA/kpoints_opt.py")
spec = importlib.util.spec_from_file_location("kpoints_opt", MODULE_PATH)
kpoints_opt = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(kpoints_opt)


def test_integer_range_is_inclusive():
    assert kpoints_opt.parse_integer_range("3:2:9") == [3, 5, 7, 9]


def test_grid_for_bulk_and_each_slab_axis():
    assert kpoints_opt.grid_for("bulk", 7, "c") == (7, 7, 7)
    assert kpoints_opt.grid_for("slab", 7, "a") == (1, 7, 7)
    assert kpoints_opt.grid_for("slab", 7, "b") == (7, 1, 7)
    assert kpoints_opt.grid_for("slab", 7, "c") == (7, 7, 1)


def test_replace_kgrid_preserves_unrelated_text():
    source = """header
%block kgrid.Monkhorst_Pack
  9 0 0 0.0
  0 9 0 0.0
  0 0 1 0.0
%endblock kgrid.Monkhorst_Pack
footer
"""
    result = kpoints_opt.replace_kgrid(source, (5, 5, 1))
    assert result.startswith("header\n")
    assert "   5   0   0   0.0" in result
    assert "   0   0   1   0.0" in result
    assert result.endswith("footer\n")


def test_parse_output_requires_energy_and_normal_end(tmp_path):
    output = tmp_path / "stdout.txt"
    output.write_text("siesta: E_KS(eV) = -12.345\nJob completed\n", encoding="utf-8")
    status, energy = kpoints_opt.parse_siesta_output(output)
    assert status == "complete"
    assert energy == -12.345
```

- [ ] **Step 2: Run the focused tests and confirm they fail because the module does not exist**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_kpoints_opt.py -q'
```

Expected: FAIL during collection with `FileNotFoundError` for `kpoints_opt.py`.

- [ ] **Step 3: Implement the self-contained k-point utility**

Implement these exact behaviors in `/home/emsl_intern/SIESTA/kpoints_opt.py`:

```python
ENERGY_PATTERNS = (
    re.compile(r"E_KS\(eV\)\s*=\s*([-+0-9.Ee]+)"),
    re.compile(r"Total\s*=\s*([-+0-9.Ee]+)"),
)
NORMAL_END_PATTERNS = ("Job completed", "End of run", "siesta: Final energy")


def parse_integer_range(text: str) -> list[int]:
    parts = text.split(":")
    if len(parts) != 3:
        raise ValueError("range must be START:STEP:END")
    start, step, end = map(int, parts)
    if step <= 0 or start <= 0 or end < start:
        raise ValueError("range requires 0 < START <= END and STEP > 0")
    return list(range(start, end + 1, step))


def grid_for(system: str, n: int, vacuum_axis: str) -> tuple[int, int, int]:
    if system == "bulk":
        return (n, n, n)
    axes = {"a": 0, "b": 1, "c": 2}
    grid = [n, n, n]
    grid[axes[vacuum_axis]] = 1
    return tuple(grid)
```

Use a case-insensitive regular expression to locate exactly one active `%block kgrid.Monkhorst_Pack` through its matching `%endblock` and replace it with three diagonal rows and zero shifts. Validate the four required FDF files before creating `kpoints_opt/`. Copy the entire base `in/` directory into each `kpoints_<n>/in/`. Generate `run_siesta.sh`, `out/`, and `scan_metadata.json`. Prepare all cases before any `sbatch` call. Implement `--analyze`, CSV status rows, PNG generation with a non-interactive Matplotlib backend, and guarded `--clean`.

The parser must accept these options:

```text
--system {slab,bulk}
--range START:STEP:END
--vacuum-axis {a,b,c} (default c)
--mode {slurm,local,prepare} (default slurm)
--ntasks INT (default 16)
--partition NAME
--path DIRECTORY
--overwrite
--analyze
--clean
--yes
-h / --help / -help
```

- [ ] **Step 4: Run k-point tests and help smoke tests**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_kpoints_opt.py -q && python kpoints_opt.py --help >/dev/null && python kpoints_opt.py -help >/dev/null && python kpoints_opt.py >/dev/null'
```

Expected: all tests PASS and every help command exits 0.

- [ ] **Step 5: Commit the k-point utility from the repository that owns `/home/emsl_intern/SIESTA`, if it is a Git worktree**

```bash
cd /home/emsl_intern/SIESTA
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add kpoints_opt.py tests/test_kpoints_opt.py
  git commit -m "feat: add SIESTA k-point scan utility"
fi
```

Expected: a commit is created when the directory is version-controlled; otherwise the files remain uncommitted and the implementation continues.

---

### Task 2: Independent energy-parameter utility and complete top-level help

**Files:**
- Create: `/home/emsl_intern/SIESTA/energy_opt.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_energy_opt.py`

**Interfaces:**
- Consumes: the same base input contract as Task 1.
- Produces: `parse_numeric_range(text: str) -> list[Decimal]`, `replace_scalar(text: str, keyword: str, value: Decimal, unit: str) -> str`, and CLI `main(argv: list[str] | None = None) -> int` with `energy-shift` and `mesh-cutoff` commands.

- [ ] **Step 1: Write failing tests for scalar replacement and top-level help**

```python
# /home/emsl_intern/SIESTA/tests/test_energy_opt.py
from decimal import Decimal
from pathlib import Path
import importlib.util
import subprocess
import sys

MODULE_PATH = Path("/home/emsl_intern/SIESTA/energy_opt.py")
spec = importlib.util.spec_from_file_location("energy_opt", MODULE_PATH)
energy_opt = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(energy_opt)


def test_numeric_range_is_decimal_and_inclusive():
    assert energy_opt.parse_numeric_range("0.02:0.02:0.06") == [
        Decimal("0.02"), Decimal("0.04"), Decimal("0.06")
    ]


def test_replace_energy_shift_preserves_comment():
    source = "PAO.EnergyShift   100 meV   # basis confinement\n"
    assert energy_opt.replace_scalar(
        source, "PAO.EnergyShift", Decimal("50"), "meV"
    ) == "PAO.EnergyShift   50 meV   # basis confinement\n"


def test_duplicate_active_definition_is_rejected():
    source = "Mesh.Cutoff 300 Ry\nmesh.cutoff 400 Ry\n"
    try:
        energy_opt.replace_scalar(source, "Mesh.Cutoff", Decimal("500"), "Ry")
    except ValueError as exc:
        assert "exactly one" in str(exc)
    else:
        raise AssertionError("duplicate keyword was accepted")


def test_no_argument_help_mentions_both_scan_types():
    result = subprocess.run(
        [sys.executable, str(MODULE_PATH)], text=True, capture_output=True, check=False
    )
    assert result.returncode == 0
    assert "energy-shift" in result.stdout
    assert "mesh-cutoff" in result.stdout
    assert "PAO.EnergyShift" in result.stdout
    assert "Mesh.Cutoff" in result.stdout
```

- [ ] **Step 2: Run the focused tests and confirm the missing-module failure**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_energy_opt.py -q'
```

Expected: FAIL during collection with `FileNotFoundError` for `energy_opt.py`.

- [ ] **Step 3: Implement both mutually independent scan commands**

Use `Decimal` arithmetic so directory names and inclusive endpoints remain stable:

```python
def parse_numeric_range(text: str) -> list[Decimal]:
    parts = text.split(":")
    if len(parts) != 3:
        raise ValueError("range must be START:STEP:END")
    start, step, end = map(Decimal, parts)
    if start <= 0 or step <= 0 or end < start:
        raise ValueError("range requires 0 < START <= END and STEP > 0")
    values: list[Decimal] = []
    current = start
    while current <= end:
        values.append(current)
        current += step
    return values
```

`replace_scalar` must ignore blank and comment-only lines, match the keyword case-insensitively at the start of an active line, require exactly one active match, replace only the value and unit, and retain an inline `#` comment. `energy-shift` edits `in/BASIS.fdf`; `mesh-cutoff` edits `in/RUN.fdf`. Reuse the execution, metadata, output parsing, CSV, plotting, overwrite, and cleanup behavior inside this standalone file rather than importing Task 1.

The top-level parser description and epilog must show these exact examples:

```text
pyutility energy_opt energy-shift --range 20:20:200
pyutility energy_opt mesh-cutoff --range 200:50:600
pyutility energy_opt --analyze energy-shift
pyutility energy_opt --analyze mesh-cutoff
pyutility energy_opt --clean energy-shift
```

When no arguments are supplied, call `parser.print_help()` and return 0. Normalize `-help` to `--help` before parsing. Store the two scan families separately beneath `energy_opt/energy_shift/` and `energy_opt/mesh_cutoff/` so analysis and cleanup cannot mix them.

- [ ] **Step 4: Run the energy utility tests and inspect all help entry points**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_energy_opt.py -q && python energy_opt.py --help | grep -E "PAO.EnergyShift|Mesh.Cutoff|energy-shift|mesh-cutoff" && python energy_opt.py energy-shift --help >/dev/null && python energy_opt.py mesh-cutoff --help >/dev/null'
```

Expected: tests PASS; the grep output contains both parameters and both command names.

- [ ] **Step 5: Commit the energy utility when Git is available**

```bash
cd /home/emsl_intern/SIESTA
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add energy_opt.py tests/test_energy_opt.py
  git commit -m "feat: add SIESTA energy parameter scans"
fi
```

---

### Task 3: Bulk and slab EOS utility

**Files:**
- Create: `/home/emsl_intern/SIESTA/eos_fitting.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_eos_fitting.py`

**Interfaces:**
- Consumes: base `in/` files and complete SIESTA outputs from scale cases.
- Produces: `parse_structure(text: str) -> StructureData`, `scale_structure(data: StructureData, scale: float, system: str, vacuum_axis: str) -> StructureData`, `birch_murnaghan(volume, e0, v0, b0, b1)`, `fit_bulk(volumes, energies) -> FitResult`, `fit_slab(areas, energies) -> FitResult`, and CLI `main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: Write failing structure-scaling and fit tests**

```python
# /home/emsl_intern/SIESTA/tests/test_eos_fitting.py
from pathlib import Path
import importlib.util
import numpy as np

MODULE_PATH = Path("/home/emsl_intern/SIESTA/eos_fitting.py")
spec = importlib.util.spec_from_file_location("eos_fitting", MODULE_PATH)
eos = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(eos)

STRUCTURE = """LatticeConstant 1.0 Ang
%block LatticeVectors
  2.0 0.0 0.0
  0.0 3.0 0.0
  0.0 0.0 15.0
%endblock LatticeVectors
AtomicCoordinatesFormat Fractional
%block AtomicCoordinatesAndAtomicSpecies
  0.25 0.50 0.50 1 1
%endblock AtomicCoordinatesAndAtomicSpecies
"""


def test_slab_scaling_preserves_vacuum_vector_and_fractional_coordinates():
    data = eos.parse_structure(STRUCTURE)
    scaled = eos.scale_structure(data, 1.1, "slab", "c")
    assert np.allclose(scaled.lattice[0], [2.2, 0.0, 0.0])
    assert np.allclose(scaled.lattice[1], [0.0, 3.3, 0.0])
    assert np.allclose(scaled.lattice[2], [0.0, 0.0, 15.0])
    assert np.allclose(scaled.coordinates[0][:3], [0.25, 0.50, 0.50])


def test_bulk_birch_murnaghan_recovers_equilibrium():
    volumes = np.linspace(90.0, 110.0, 9)
    energies = eos.birch_murnaghan(volumes, -10.0, 100.0, 0.6, 4.0)
    fit = eos.fit_bulk(volumes, energies)
    assert abs(fit.equilibrium_x - 100.0) < 1e-3
    assert abs(fit.minimum_energy + 10.0) < 1e-6


def test_slab_quadratic_recovers_area_minimum():
    areas = np.linspace(18.0, 22.0, 7)
    energies = -5.0 + 0.25 * (areas - 20.0) ** 2
    fit = eos.fit_slab(areas, energies)
    assert abs(fit.equilibrium_x - 20.0) < 1e-9
    assert abs(fit.minimum_energy + 5.0) < 1e-9
```

- [ ] **Step 2: Run the EOS tests and confirm the missing-module failure**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_eos_fitting.py -q'
```

Expected: FAIL during collection with `FileNotFoundError` for `eos_fitting.py`.

- [ ] **Step 3: Implement FDF structure parsing and safe scaling**

Define focused dataclasses:

```python
@dataclass
class StructureData:
    original_lines: list[str]
    lattice: np.ndarray
    coordinates: list[list[float | str]]
    coordinate_format: str
    lattice_constant: float
    lattice_unit: str


@dataclass
class FitResult:
    equilibrium_x: float
    minimum_energy: float
    coefficients: tuple[float, ...]
```

Require one active `LatticeConstant`, one `LatticeVectors` block, one `AtomicCoordinatesFormat`, and one `AtomicCoordinatesAndAtomicSpecies` block. Support Ang, Bohr, Fractional, ScaledByLatticeVectors, and Cartesian forms documented in SIESTA 5.4.2. Preserve species indices, atom indices, and trailing columns. For Cartesian data, compute fractional positions from the original lattice, scale the selected lattice vectors, then map the fractions to the new lattice. Render by replacing only lattice-vector rows and the first three coordinate fields.

- [ ] **Step 4: Implement scan creation, bulk/slab fitting, plots, and fitted structure output**

Use the third-order Birch-Murnaghan form:

```python
def birch_murnaghan(volume, e0, v0, b0, b1):
    eta = (v0 / volume) ** (2.0 / 3.0)
    return e0 + (9.0 * v0 * b0 / 16.0) * (
        (eta - 1.0) ** 3 * b1 + (eta - 1.0) ** 2 * (6.0 - 4.0 * eta)
    )
```

Generate scale factors with `np.linspace(minimum, maximum, samples)` and store four-decimal case names. Require at least five complete bulk points and three complete slab points. Compute bulk volumes with `abs(det(lattice))`; compute slab areas with the norm of the cross product of the two non-vacuum lattice vectors. Use `scipy.optimize.curve_fit` for bulk and `np.polyfit(..., 2)` for slab. Convert bulk modulus from eV/Angstrom cubed to GPa with `160.21766208`.

Write `results.csv` and a labeled plot of raw points plus fitted curve. Only when the fitted equilibrium is positive and inside the sampled volume/area interval, derive the equilibrium linear scale from `V0 / V_reference` to the one-third power for bulk or `A0 / A_reference` to the one-half power for slab, render the scaled original structure, and write `STRUCT_eos_optimized.fdf`.

Reuse the complete standalone execution, metadata, status, help, overwrite, and cleanup implementation inside this file. Do not import either earlier utility.

- [ ] **Step 5: Run EOS tests and CLI help checks**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_eos_fitting.py -q && python eos_fitting.py --help >/dev/null && python eos_fitting.py -help >/dev/null && python eos_fitting.py >/dev/null'
```

Expected: all tests PASS and all help entry points exit 0.

- [ ] **Step 6: Commit the EOS utility when Git is available**

```bash
cd /home/emsl_intern/SIESTA
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add eos_fitting.py tests/test_eos_fitting.py
  git commit -m "feat: add SIESTA slab and bulk EOS fitting"
fi
```

---

### Task 4: Cross-utility fixture, prepare-mode smoke tests, and safety verification

**Files:**
- Create: `/home/emsl_intern/SIESTA/tests/fixtures/basic/in/RUN.fdf`
- Create: `/home/emsl_intern/SIESTA/tests/fixtures/basic/in/STRUCT.fdf`
- Create: `/home/emsl_intern/SIESTA/tests/fixtures/basic/in/KPT.fdf`
- Create: `/home/emsl_intern/SIESTA/tests/fixtures/basic/in/BASIS.fdf`
- Create: `/home/emsl_intern/SIESTA/tests/test_prepare_integration.py`

**Interfaces:**
- Consumes: all three completed CLIs.
- Produces: evidence that preparation is isolated, metadata is readable, runners contain the correct commands, and no scheduler is invoked.

- [ ] **Step 1: Add a minimal complete SIESTA fixture and prepare-mode integration test**

```python
# /home/emsl_intern/SIESTA/tests/test_prepare_integration.py
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path("/home/emsl_intern/SIESTA")
FIXTURE = ROOT / "tests/fixtures/basic"


def run_prepare(script: str, args: list[str], tmp_path: Path):
    base = tmp_path / script
    shutil.copytree(FIXTURE, base)
    before = {p.relative_to(base): p.read_bytes() for p in (base / "in").iterdir()}
    result = subprocess.run(
        [sys.executable, str(ROOT / script), "--path", str(base), *args],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    after = {p.relative_to(base): p.read_bytes() for p in (base / "in").iterdir()}
    assert after == before
    return base


def test_all_utilities_prepare_without_submission(tmp_path):
    kbase = run_prepare(
        "kpoints_opt.py", ["--system", "slab", "--range", "3:2:5", "--mode", "prepare"], tmp_path
    )
    assert (kbase / "kpoints_opt/kpoints_3/in/KPT.fdf").is_file()

    ebase = run_prepare(
        "energy_opt.py", ["energy-shift", "--range", "50:50:100", "--mode", "prepare"], tmp_path
    )
    assert (ebase / "energy_opt/energy_shift/energy_shift_50meV/in/BASIS.fdf").is_file()

    obase = run_prepare(
        "eos_fitting.py", ["--system", "bulk", "--range", "0.98:1.02", "--samples", "3", "--mode", "prepare"], tmp_path
    )
    assert (obase / "eos_fitting/scale_1.0000/in/STRUCT.fdf").is_file()
```

The fixture files must use the four input files from `01_MoS2/01_ConvergenceTest`, with `STRUCT.fdf` corrected so `ChemicalSpeciesLabel` and atom coordinates describe the same species. Do not copy pseudopotential binaries into the test tree.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests -q'
```

Expected: all tests PASS with no `sbatch`, `mpirun`, or `siesta` process launched.

- [ ] **Step 3: Run help and prepare smoke tests through the actual `pyutility` shell function**

Run:

```bash
ssh -tt 147.46.142.250 'bash -lic '\''cd /home/emsl_intern/SIESTA/tests/fixtures/basic && pyutility kpoints_opt --help >/dev/null && pyutility energy_opt --help >/dev/null && pyutility eos_fitting --help >/dev/null && pyutility kpoints_opt --system slab --range 3:2:5 --mode prepare --path "$PWD" --overwrite && pyutility energy_opt mesh-cutoff --range 300:100:500 --mode prepare --path "$PWD" --overwrite && pyutility eos_fitting --system slab --range 0.98:1.02 --samples 3 --mode prepare --path "$PWD" --overwrite'\'''
```

Expected: every command exits 0, creates the expected scan cases, and prints no scheduler job identifier.

- [ ] **Step 4: Verify source preservation, generated metadata, and cleanup boundaries**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA/tests/fixtures/basic && sha256sum in/*.fdf && python -m json.tool kpoints_opt/scan_metadata.json >/dev/null && python -m json.tool energy_opt/mesh_cutoff/scan_metadata.json >/dev/null && python -m json.tool eos_fitting/scan_metadata.json >/dev/null && test -f in/RUN.fdf && test -f in/STRUCT.fdf'
```

Expected: hashes are printed for all four source files, all JSON files validate, and both final `test` commands succeed.

- [ ] **Step 5: Commit integration fixtures and tests when Git is available**

```bash
cd /home/emsl_intern/SIESTA
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add tests/fixtures/basic tests/test_prepare_integration.py
  git commit -m "test: verify SIESTA utility preparation workflow"
fi
```

---

### Task 5: Final verification against the approved design

**Files:**
- Verify: `/home/emsl_intern/SIESTA/kpoints_opt.py`
- Verify: `/home/emsl_intern/SIESTA/energy_opt.py`
- Verify: `/home/emsl_intern/SIESTA/eos_fitting.py`
- Verify: `/home/emsl_intern/SIESTA/tests/`

**Interfaces:**
- Consumes: the complete implementation and test suite.
- Produces: a concise handoff with exact test results, created remote paths, supported commands, and any environment dependency limitation.

- [ ] **Step 1: Run syntax compilation and the full test suite from a clean shell**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m py_compile kpoints_opt.py energy_opt.py eos_fitting.py && python -m pytest tests -q'
```

Expected: compilation exits 0 and all tests PASS.

- [ ] **Step 2: Confirm numerical dependencies without changing the environment**

```bash
ssh 147.46.142.250 'python -c "import numpy, scipy, matplotlib; print(numpy.__version__, scipy.__version__, matplotlib.__version__)"'
```

Expected: versions are printed. If an import fails, report the missing package and leave code and prepare-mode functionality intact; do not install packages without user authorization.

- [ ] **Step 3: Inspect generated scripts for prohibited automatic optimum selection**

```bash
ssh 147.46.142.250 'grep -RniE "recommended k|optimal k|recommended.*energy.?shift|optimal.*mesh" /home/emsl_intern/SIESTA/kpoints_opt.py /home/emsl_intern/SIESTA/energy_opt.py || true'
```

Expected: no automatic recommendation message is found in the k-point or energy utilities.

- [ ] **Step 4: Record final repository state without staging unrelated files**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git status --short; else printf "not a git worktree\n"; fi'
```

Expected: only intentional utility/test changes appear, or the directory reports that it is not a Git worktree.
