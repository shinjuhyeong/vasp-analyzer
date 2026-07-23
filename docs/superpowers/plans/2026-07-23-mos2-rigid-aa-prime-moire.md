# Rigid AA′ MoS2 Moiré Bilayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate a periodic, rigid, `(m, n) = (6, 5)` AA′ MoS2 moiré bilayer for SIESTA with 546 atoms and a twist angle of approximately 6.009 degrees.

**Architecture:** A dependency-light Python generator will encode the supplied primitive bilayer, derive the commensurate lattice matrices, tile each monolayer independently, rotate the upper monolayer about the selected AA′ origin, and write a SIESTA FDF geometry. A separate validation path in the same module will parse the generated data and report structural invariants in a plain-text artifact. Pytest tests will cover the commensurate mathematics, atom counts, layer geometry, periodic uniqueness, and output format.

**Tech Stack:** Python 3 standard library, pytest

## Global Constraints

- Preserve the supplied lower and upper monolayer coordinates without symmetrization or relaxation.
- Use `(m, n) = (6, 5)`, yielding 91 primitive cells per layer and 546 atoms total.
- Preserve the 29.957801881 Å out-of-plane lattice length.
- Preserve the 5.723560607 Å Mo-to-Mo separation and 2.977905117 Å inner S-to-S gap.
- Keep the lower layer fixed in its supplied orientation and rotate the supplied upper 2H/AA′ layer rigidly.
- Use two-dimensional periodic boundaries without x/y vacuum, passivation, frozen edges, or strain.
- Produce a SIESTA FDF geometry and a validation report only; do not add electronic-structure or relaxation settings.

---

## File Structure

- `tools/generate_mos2_moire.py`: commensurate geometry construction, FDF writing, validation, and command-line entry point.
- `tests/test_generate_mos2_moire.py`: mathematical, structural, periodicity, and serialization tests.
- `generated/MoS2_AAprime_twist_6.009_546.fdf`: generated SIESTA geometry.
- `generated/MoS2_AAprime_twist_6.009_546.validation.txt`: generated validation evidence.

### Task 1: Commensurate Geometry Generator

**Files:**
- Create: `tools/generate_mos2_moire.py`
- Test: `tests/test_generate_mos2_moire.py`

**Interfaces:**
- Produces: `Vec3`, `Atom`, and `Structure` dataclasses.
- Produces: `commensurate_angle(m: int, n: int) -> float`.
- Produces: `build_structure(m: int = 6, n: int = 5) -> Structure`.
- Produces: `fractional_xy(cart_xy, lattice) -> tuple[float, float]`.
- Produces: `minimum_periodic_distance(structure: Structure) -> float`.

- [ ] **Step 1: Write failing commensurate-math tests**

```python
import math

from tools.generate_mos2_moire import build_structure, commensurate_angle


def test_6_5_commensurate_angle_and_population():
    angle = commensurate_angle(6, 5)
    structure = build_structure()
    assert math.isclose(angle, 6.0089831978, abs_tol=1.0e-9)
    assert len(structure.atoms) == 546
    assert sum(a.atomic_number == 42 for a in structure.atoms) == 182
    assert sum(a.atomic_number == 16 for a in structure.atoms) == 364


def test_moire_cell_dimensions():
    structure = build_structure()
    a = math.dist((0.0, 0.0), structure.lattice[0][:2])
    b = math.dist((0.0, 0.0), structure.lattice[1][:2])
    assert math.isclose(a, b, abs_tol=1.0e-9)
    assert math.isclose(a, math.sqrt(91) * 3.132247842309, abs_tol=1.0e-9)
    assert structure.lattice[2] == (0.0, 0.0, 29.957801881)
```

- [ ] **Step 2: Run the tests and verify the expected import failure**

Run: `python -m pytest tests/test_generate_mos2_moire.py -v`

Expected: FAIL during collection with `ModuleNotFoundError: No module named 'tools.generate_mos2_moire'`.

- [ ] **Step 3: Implement immutable data models and commensurate helpers**

Create `tools/generate_mos2_moire.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path


@dataclass(frozen=True)
class Atom:
    atomic_number: int
    species_index: int
    fractional: tuple[float, float, float]
    layer: str


@dataclass(frozen=True)
class Structure:
    lattice: tuple[tuple[float, float, float], ...]
    atoms: tuple[Atom, ...]
    angle_degrees: float
    m: int
    n: int


A1 = (1.566116545, -2.712610461)
A2 = (1.566116545, 2.712610461)
C = 29.957801881
PRIMITIVE = (
    (42, 1, 0.666666140, 0.333333860, 0.341974644, "lower"),
    (42, 1, 0.333333206, 0.666666793, 0.533028735, "upper"),
    (16, 2, 0.333333656, 0.666666344, 0.296126179, "lower"),
    (16, 2, 0.333333878, 0.666666122, 0.387800392, "lower"),
    (16, 2, 0.666665574, 0.333334426, 0.487203717, "upper"),
    (16, 2, 0.666665413, 0.333334587, 0.578877732, "upper"),
)


def commensurate_angle(m: int, n: int) -> float:
    cells = m * m + m * n + n * n
    cosine = (m * m + 4 * m * n + n * n) / (2 * cells)
    return math.degrees(math.acos(cosine))
```

Add small, explicit 2D matrix helpers for multiplication, inversion, and rotation. Construct the lower common-cell matrix from columns
`m*A1 + n*A2` and `-n*A1 + (m+n)*A2`. Construct the upper tiling with integer columns `(n, m)` and `(-m, m+n)`, rotate it by the computed positive angle, and assert that both common-cell matrices agree within `1.0e-8 Å`.

- [ ] **Step 4: Implement primitive-cell enumeration and rigid layer assembly**

Implement a helper:

```python
def enumerate_coset_representatives(
    transform: tuple[tuple[int, int], tuple[int, int]]
) -> tuple[tuple[int, int], ...]:
    ...
```

Enumerate integer translations in a bounded square, transform each translation into common-cell fractional coordinates, wrap into `[0, 1)`, and retain unique representatives using rounded 12-decimal keys. Stop only when exactly `abs(det(transform))` representatives are found; otherwise raise `RuntimeError`.

Implement `build_structure()` so that it:

1. checks `m > n > 0`;
2. builds 91 lower and 91 upper primitive-cell representatives;
3. expands only the three supplied atoms belonging to the corresponding layer;
4. rotates upper-layer Cartesian x/y coordinates about the supplied upper-layer AA′ reference site before converting to the common-cell fractional basis;
5. wraps x/y fractions into `[0, 1)` while retaining every supplied z fraction exactly;
6. sorts atoms by species, layer, z, y, and x for reproducible output;
7. raises if the final count is not `6 * (m*m + m*n + n*n)`.

- [ ] **Step 5: Run the commensurate tests**

Run: `python -m pytest tests/test_generate_mos2_moire.py -v`

Expected: both tests PASS.

- [ ] **Step 6: Add failing geometry-invariant tests**

Append:

```python
def test_original_layer_distances_are_preserved():
    structure = build_structure()
    c = structure.lattice[2][2]
    mo_z = sorted({round(a.fractional[2], 9) for a in structure.atoms
                   if a.atomic_number == 42})
    s_z = sorted({round(a.fractional[2], 9) for a in structure.atoms
                  if a.atomic_number == 16})
    assert math.isclose((mo_z[1] - mo_z[0]) * c, 5.723560607, abs_tol=2e-8)
    assert math.isclose((s_z[2] - s_z[1]) * c, 2.977905117, abs_tol=2e-8)
    assert math.isclose((s_z[1] - s_z[0]) * c, 2.746357911, abs_tol=2e-8)
    assert math.isclose((s_z[3] - s_z[2]) * c, 2.746351979, abs_tol=2e-8)


def test_fractional_sites_are_unique_under_periodic_boundaries():
    structure = build_structure()
    keys = {
        (
            a.atomic_number,
            round(a.fractional[0] % 1.0, 10),
            round(a.fractional[1] % 1.0, 10),
            round(a.fractional[2] % 1.0, 10),
        )
        for a in structure.atoms
    }
    assert len(keys) == 546
```

- [ ] **Step 7: Run all generator tests**

Run: `python -m pytest tests/test_generate_mos2_moire.py -v`

Expected: all four tests PASS.

- [ ] **Step 8: Commit the tested generator**

Run:

```powershell
git add -- tools/generate_mos2_moire.py tests/test_generate_mos2_moire.py
git commit -m "feat: generate commensurate MoS2 moire geometry"
```

Expected: one commit containing only the generator and its tests.

### Task 2: SIESTA Serialization and Validation Report

**Files:**
- Modify: `tools/generate_mos2_moire.py`
- Modify: `tests/test_generate_mos2_moire.py`

**Interfaces:**
- Consumes: `Structure` and `build_structure()` from Task 1.
- Produces: `write_fdf(structure: Structure, path: Path) -> None`.
- Produces: `validate_structure(structure: Structure) -> dict[str, float | int | str]`.
- Produces: `write_validation_report(results, path: Path) -> None`.
- Produces: CLI options `--output` and `--report`.

- [ ] **Step 1: Write failing FDF serialization test**

Append:

```python
from pathlib import Path
from tools.generate_mos2_moire import write_fdf


def test_write_fdf_contains_complete_siesta_geometry(tmp_path: Path):
    output = tmp_path / "moire.fdf"
    write_fdf(build_structure(), output)
    text = output.read_text(encoding="utf-8")
    assert "NumberOfAtoms 546" in text
    assert "NumberOfSpecies 2" in text
    assert "AtomicCoordinatesFormat Fractional" in text
    assert "%block ChemicalSpeciesLabel" in text
    assert "1 42 Mo" in text
    assert "2 16 S" in text
    assert text.count(" # lower") == 273
    assert text.count(" # upper") == 273
```

- [ ] **Step 2: Run the serialization test and verify failure**

Run: `python -m pytest tests/test_generate_mos2_moire.py::test_write_fdf_contains_complete_siesta_geometry -v`

Expected: FAIL during import because `write_fdf` is not defined.

- [ ] **Step 3: Implement deterministic SIESTA FDF output**

Implement `write_fdf()` with this exact block order:

```text
SystemName rigid AA-prime MoS2 moire bilayer
SystemLabel MoS2_AAprime_twist_6.009_546
NumberOfAtoms 546
NumberOfSpecies 2
LatticeConstant 1.0 Ang
%block LatticeVectors
...
%endblock LatticeVectors
%block ChemicalSpeciesLabel
1 42 Mo
2 16 S
%endblock ChemicalSpeciesLabel
AtomicCoordinatesFormat Fractional
%block AtomicCoordinatesAndAtomicSpecies
...
%endblock AtomicCoordinatesAndAtomicSpecies
```

Write lattice and fractional coordinates with 12 digits after the decimal.
Append `# lower` or `# upper` to each atomic-coordinate line.

- [ ] **Step 4: Add failing validation-report test**

Append:

```python
from tools.generate_mos2_moire import validate_structure


def test_validation_results_cover_design_invariants():
    result = validate_structure(build_structure())
    assert result["total_atoms"] == 546
    assert result["mo_atoms"] == 182
    assert result["s_atoms"] == 364
    assert result["periodic_unique_sites"] == 546
    assert math.isclose(result["twist_degrees"], 6.0089831978, abs_tol=1e-9)
    assert math.isclose(result["mo_mo_layer_distance_ang"], 5.723560607, abs_tol=2e-8)
    assert math.isclose(result["inner_s_s_gap_ang"], 2.977905117, abs_tol=2e-8)
    assert result["minimum_periodic_distance_ang"] > 1.9
```

- [ ] **Step 5: Implement validation and CLI**

Implement `minimum_periodic_distance()` using the 27 neighboring fractional
images in x/y and the nearest z image. Implement `validate_structure()` to
return all asserted values plus both in-plane lattice lengths and both
monolayer thicknesses. Implement `write_validation_report()` as sorted
`key = value` lines.

Add `main()` using `argparse`:

```python
parser.add_argument(
    "--output",
    type=Path,
    default=Path("generated/MoS2_AAprime_twist_6.009_546.fdf"),
)
parser.add_argument(
    "--report",
    type=Path,
    default=Path("generated/MoS2_AAprime_twist_6.009_546.validation.txt"),
)
```

Create parent directories, build the structure, validate it, raise on any
failed invariant, write both files, and print both paths.

- [ ] **Step 6: Run the full test suite**

Run: `python -m pytest tests/test_generate_mos2_moire.py -v`

Expected: all six tests PASS.

- [ ] **Step 7: Commit serialization and validation**

Run:

```powershell
git add -- tools/generate_mos2_moire.py tests/test_generate_mos2_moire.py
git commit -m "feat: write and validate SIESTA moire structure"
```

Expected: one commit containing the FDF writer, validator, CLI, and tests.

### Task 3: Generate and Independently Verify Deliverables

**Files:**
- Create: `generated/MoS2_AAprime_twist_6.009_546.fdf`
- Create: `generated/MoS2_AAprime_twist_6.009_546.validation.txt`

**Interfaces:**
- Consumes: the Task 2 command-line interface.
- Produces: final user-facing SIESTA geometry and validation evidence.

- [ ] **Step 1: Generate both artifacts**

Run:

```powershell
python tools/generate_mos2_moire.py
```

Expected: output names both files under `generated/` and exits with code 0.

- [ ] **Step 2: Inspect the validation report**

Run:

```powershell
Get-Content generated/MoS2_AAprime_twist_6.009_546.validation.txt
```

Expected: `total_atoms = 546`, `mo_atoms = 182`, `s_atoms = 364`,
`periodic_unique_sites = 546`, and the preserved layer-distance values.

- [ ] **Step 3: Independently count FDF coordinate rows**

Run:

```powershell
$inside = $false
$count = 0
Get-Content generated/MoS2_AAprime_twist_6.009_546.fdf | ForEach-Object {
    if ($_ -match '^%block AtomicCoordinatesAndAtomicSpecies') {
        $inside = $true
    } elseif ($_ -match '^%endblock AtomicCoordinatesAndAtomicSpecies') {
        $inside = $false
    } elseif ($inside -and $_.Trim()) {
        $count++
    }
}
if ($count -ne 546) { throw "Expected 546 coordinate rows, found $count" }
$count
```

Expected: `546`.

- [ ] **Step 4: Run final automated verification**

Run:

```powershell
python -m pytest tests/test_generate_mos2_moire.py -v
git diff --check
```

Expected: all tests PASS and `git diff --check` prints no errors.

- [ ] **Step 5: Commit generated artifacts**

Run:

```powershell
git add -- generated/MoS2_AAprime_twist_6.009_546.fdf generated/MoS2_AAprime_twist_6.009_546.validation.txt
git commit -m "data: add rigid 6 degree MoS2 moire structure"
```

Expected: one commit containing only the two generated deliverables.
