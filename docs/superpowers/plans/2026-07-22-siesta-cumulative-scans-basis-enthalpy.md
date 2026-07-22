# SIESTA Cumulative Scans and Basis Enthalpy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all three SIESTA scan utilities accumulate compatible calculation ranges and extend EnergyShift analysis with SIESTA basis enthalpy and orbital-volume data.

**Architecture:** Each standalone script owns an identical local implementation of schema-v2 manifest loading, atomic JSON writes, scan-specific input fingerprints, migration, and case merging. Analyze commands iterate manifest cases rather than the most recent range. `energy_opt.py` additionally parses labeled `<SystemLabel>.BASIS_ENTHALPY` output and atomically writes a two-energy plot and expanded CSV.

**Tech Stack:** Python 3.13, argparse, pathlib, hashlib, json, tempfile, shutil, csv, Decimal, NumPy, SciPy, Matplotlib, pytest; SIESTA 5.4.2.

## Global Constraints

- Modify only `/home/emsl_intern/SIESTA/kpoints_opt.py`, `/home/emsl_intern/SIESTA/energy_opt.py`, `/home/emsl_intern/SIESTA/eos_fitting.py`, and their tests/fixtures.
- Keep the three utilities standalone; do not add a shared project module.
- Preserve `--mode local` direct `siesta` execution and `--mode slurm` MPI execution.
- Never rewrite existing case directories without `--overwrite` for the requested values.
- Never combine incompatible physical inputs, units, system types, or vacuum axes.
- Normalize only the parameter controlled by the active scan when computing fingerprints.
- Write metadata and analysis artifacts atomically.
- Do not stage or commit files in the remote `/home/emsl_intern` Git repository.
- Do not run SIESTA, MPI, or SLURM during tests or smoke verification.
- Use the approved design at `docs/superpowers/specs/2026-07-22-siesta-cumulative-scans-basis-enthalpy-design.md` as the behavioral authority.

---

### Task 1: Schema-v2 manifest primitives and input fingerprints

**Files:**
- Modify: `/home/emsl_intern/SIESTA/kpoints_opt.py`
- Modify: `/home/emsl_intern/SIESTA/energy_opt.py`
- Modify: `/home/emsl_intern/SIESTA/eos_fitting.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_scan_manifest.py`

**Interfaces:**
- Each script produces `atomic_write_json(path: Path, data: dict) -> None`.
- Each script produces `input_snapshot(input_dir: Path, scan_kind: str) -> dict[str, str]`.
- Each script produces `combined_fingerprint(file_hashes: dict[str, str]) -> str`.
- K-point normalization consumes `replace_kgrid(text, (1, 1, 1))` output.
- Energy normalization consumes `replace_scalar` with a fixed sentinel value and canonical unit.
- EOS snapshots exact input bytes without normalizing `STRUCT.fdf`.

- [ ] **Step 1: Write failing tests for normalized fingerprints and atomic JSON writes**

```python
# /home/emsl_intern/SIESTA/tests/test_scan_manifest.py
from pathlib import Path
import importlib.util
import json
import sys

ROOT = Path("/home/emsl_intern/SIESTA")


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def write_inputs(root: Path):
    root.mkdir(parents=True)
    (root / "RUN.fdf").write_text("SystemLabel MoS2\nMesh.Cutoff 300 Ry\n")
    (root / "STRUCT.fdf").write_text("structure\n")
    (root / "KPT.fdf").write_text(
        "%block kgrid.Monkhorst_Pack\n3 0 0 0\n0 3 0 0\n0 0 1 0\n%endblock\n"
    )
    (root / "BASIS.fdf").write_text("PAO.EnergyShift 50 meV\n")
    (root / "Mo.psml").write_bytes(b"pseudo")


def test_scan_parameter_is_normalized_but_other_inputs_are_not(tmp_path):
    write_inputs(tmp_path / "a")
    write_inputs(tmp_path / "b")
    (tmp_path / "b/KPT.fdf").write_text(
        "%block kgrid.Monkhorst_Pack\n9 0 0 0\n0 9 0 0\n0 0 1 0\n%endblock\n"
    )
    kpt = load("kpoints_opt")
    assert kpt.input_snapshot(tmp_path / "a", "kpoints") == kpt.input_snapshot(
        tmp_path / "b", "kpoints"
    )
    (tmp_path / "b/RUN.fdf").write_text("SystemLabel MoS2\nMesh.Cutoff 500 Ry\n")
    assert kpt.input_snapshot(tmp_path / "a", "kpoints") != kpt.input_snapshot(
        tmp_path / "b", "kpoints"
    )


def test_atomic_json_write_leaves_valid_complete_file(tmp_path):
    module = load("energy_opt")
    target = tmp_path / "scan_metadata.json"
    module.atomic_write_json(target, {"schema_version": 2, "cases": [1, 2]})
    assert json.loads(target.read_text()) == {"schema_version": 2, "cases": [1, 2]}
    assert not list(tmp_path.glob(".scan_metadata.json.*"))
```

- [ ] **Step 2: Run the focused tests and confirm missing-function failures**

Run:

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_scan_manifest.py -q'
```

Expected: FAIL because `input_snapshot` and `atomic_write_json` are undefined.

- [ ] **Step 3: Implement identical atomic-write and hashing primitives in each standalone script**

Use this atomic-write contract in every script:

```python
def atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
```

For regular files, hash bytes with SHA-256. For symlinks, resolve the target and hash its bytes under the symlink's relative path. Sort relative POSIX paths before producing `combined_fingerprint`. For the scan-controlled text file, normalize only the target block or scalar to a fixed canonical value before hashing; all other bytes remain significant.

- [ ] **Step 4: Run manifest primitive tests and the existing suite**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_scan_manifest.py -q && python -m pytest tests -q'
```

Expected: focused tests PASS and all existing tests remain green.

---

### Task 2: Cumulative K-point manifests and schema-v1 migration

**Files:**
- Modify: `/home/emsl_intern/SIESTA/kpoints_opt.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_kpoints_cumulative.py`

**Interfaces:**
- Produces `load_or_migrate_manifest(root: Path, input_dir: Path, compatibility: dict) -> dict`.
- Produces `merge_cases(manifest: dict, requested: list[int], overwrite: bool, mode: str) -> tuple[dict, list[int], list[int]]` returning updated manifest, values to prepare, and skipped values.
- `analyze(base)` consumes `manifest["cases"]` sorted by integer `value`.

- [ ] **Step 1: Write failing cumulative and migration tests**

```python
# /home/emsl_intern/SIESTA/tests/test_kpoints_cumulative.py
from pathlib import Path
import json
import subprocess
import sys

ROOT = Path("/home/emsl_intern/SIESTA")
FIXTURE = ROOT / "tests/fixtures/basic"


def run(base: Path, *args: str):
    return subprocess.run(
        [sys.executable, str(ROOT / "kpoints_opt.py"), "--path", str(base), *args],
        text=True, capture_output=True, check=False
    )


def test_two_ranges_accumulate_and_overlap_is_skipped(tmp_path):
    base = tmp_path / "calc"
    __import__("shutil").copytree(FIXTURE, base)
    assert run(base, "--system", "slab", "--range", "3:3:9", "--mode", "prepare").returncode == 0
    marker = base / "kpoints_opt/kpoints_6/keep.txt"
    marker.write_text("preserve")
    result = run(base, "--system", "slab", "--range", "6:3:15", "--mode", "prepare")
    assert result.returncode == 0, result.stderr
    metadata = json.loads((base / "kpoints_opt/scan_metadata.json").read_text())
    assert [case["value"] for case in metadata["cases"]] == [3, 6, 9, 12, 15]
    assert marker.read_text() == "preserve"
    assert "Skipped existing case: kpoints_6" in result.stdout


def test_incompatible_input_change_refuses_extension(tmp_path):
    base = tmp_path / "calc"
    __import__("shutil").copytree(FIXTURE, base)
    assert run(base, "--system", "slab", "--range", "3:3:9", "--mode", "prepare").returncode == 0
    (base / "in/RUN.fdf").write_text((base / "in/RUN.fdf").read_text() + "XC.functional LDA\n")
    result = run(base, "--system", "slab", "--range", "12:3:15", "--mode", "prepare")
    assert result.returncode == 2
    assert "RUN.fdf" in result.stderr
```

- [ ] **Step 2: Run focused tests and observe metadata overwrite failure**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_kpoints_cumulative.py -q'
```

Expected: FAIL because the second preparation overwrites `values` instead of producing schema-v2 `cases`.

- [ ] **Step 3: Implement K-point manifest creation, merging, compatibility validation, and v1 migration**

New case records contain integer `value`, stable `case_name`, `created_at`, `last_prepared_at`, `mode`, and `execution_status`. Preserve `created_at` on overwrite. Compare compatibility dictionaries before preparing cases and list differing files from `file_hashes` in the exception.

Migration converts old `values` to cases, validates each case's normalized input snapshot against the base snapshot, writes `scan_metadata.v1.backup.json`, and atomically writes schema v2 without executing cases.

- [ ] **Step 4: Run K-point cumulative tests and relevant regression tests**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_kpoints_cumulative.py tests/test_kpoints_opt.py tests/test_local_runner.py -q'
```

Expected: all selected tests PASS.

---

### Task 3: Cumulative EnergyShift and Mesh.Cutoff manifests

**Files:**
- Modify: `/home/emsl_intern/SIESTA/energy_opt.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_energy_cumulative.py`

**Interfaces:**
- Energy cases store decimal value strings and stable case names.
- EnergyShift and Mesh.Cutoff use separate schema-v2 manifests under their existing scan roots.
- Unit is part of compatibility and must match exactly.

- [ ] **Step 1: Write failing tests for both energy scan families**

```python
# /home/emsl_intern/SIESTA/tests/test_energy_cumulative.py
from pathlib import Path
import json
import shutil
import subprocess
import sys

ROOT = Path("/home/emsl_intern/SIESTA")
FIXTURE = ROOT / "tests/fixtures/basic"


def invoke(base: Path, *args: str):
    return subprocess.run(
        [sys.executable, str(ROOT / "energy_opt.py"), "--path", str(base), *args],
        text=True, capture_output=True, check=False
    )


def test_energy_shift_ranges_accumulate_numerically(tmp_path):
    base = tmp_path / "calc"
    shutil.copytree(FIXTURE, base)
    assert invoke(base, "energy-shift", "--range", "20:20:60", "--mode", "prepare").returncode == 0
    assert invoke(base, "energy-shift", "--range", "80:20:120", "--mode", "prepare").returncode == 0
    data = json.loads((base / "energy_opt/energy_shift/scan_metadata.json").read_text())
    assert [case["value"] for case in data["cases"]] == ["20", "40", "60", "80", "100", "120"]


def test_mesh_cutoff_change_is_normalized_but_unit_change_is_rejected(tmp_path):
    base = tmp_path / "calc"
    shutil.copytree(FIXTURE, base)
    assert invoke(base, "mesh-cutoff", "--range", "300:100:500", "--mode", "prepare").returncode == 0
    result = invoke(base, "mesh-cutoff", "--range", "600:100:700", "--unit", "eV", "--mode", "prepare")
    assert result.returncode == 2
    assert "unit" in result.stderr.lower()
```

- [ ] **Step 2: Run tests and verify schema-v2 expectations fail**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_energy_cumulative.py -q'
```

Expected: FAIL because current preparation overwrites metadata.

- [ ] **Step 3: Implement decimal case merging, compatibility checks, overwrite behavior, and migration**

Reuse the Task 2 behavior locally inside `energy_opt.py`, using `Decimal(case["value"])` for sorting and comparison. Normalize EnergyShift to `PAO.EnergyShift 1 meV` for hashing and Mesh.Cutoff to `Mesh.Cutoff 1 Ry`; retain the user's exact scan unit in compatibility and case names.

- [ ] **Step 4: Run energy cumulative and existing energy tests**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_energy_cumulative.py tests/test_energy_opt.py tests/test_prepare_integration.py -q'
```

Expected: all selected tests PASS.

---

### Task 4: Parse SIESTA basis enthalpy output and expand EnergyShift analysis

**Files:**
- Modify: `/home/emsl_intern/SIESTA/energy_opt.py`
- Create: `/home/emsl_intern/SIESTA/tests/fixtures/MoS2.BASIS_ENTHALPY`
- Create: `/home/emsl_intern/SIESTA/tests/test_basis_enthalpy.py`

**Interfaces:**
- Produces `parse_system_label(run_fdf: Path) -> str`.
- Produces `parse_basis_enthalpy(path: Path) -> dict[str, float]`.
- `analyze(base, "energy-shift")` writes expanded CSV columns and two energy curves.

- [ ] **Step 1: Add the exact official labeled fixture and failing parser tests**

```text
Basis enthalpy [eV] : -99.7500000000
Basis Harris enthalpy [eV] : -99.6000000000
Free energy [eV] : -100.0000000000
Harris energy [eV] : -99.8500000000
Orbital volume [Ang**3] : 200.0000000000
Average basis pressure [eV/Ang**3] : 0.0012483018
Average basis pressure [GPa] : 0.2000000000
```

```python
# /home/emsl_intern/SIESTA/tests/test_basis_enthalpy.py
from pathlib import Path
import importlib.util
import sys

ROOT = Path("/home/emsl_intern/SIESTA")
spec = importlib.util.spec_from_file_location("energy_opt", ROOT / "energy_opt.py")
energy_opt = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = energy_opt
assert spec.loader is not None
spec.loader.exec_module(energy_opt)


def test_parse_official_basis_enthalpy_format():
    values = energy_opt.parse_basis_enthalpy(ROOT / "tests/fixtures/MoS2.BASIS_ENTHALPY")
    assert values["basis_enthalpy_eV"] == -99.75
    assert values["free_energy_eV"] == -100.0
    assert values["orbital_volume_A3"] == 200.0
    assert values["basis_pressure_GPa"] == 0.2


def test_system_label_is_case_insensitive(tmp_path):
    path = tmp_path / "RUN.fdf"
    path.write_text("systemlabel   MyScan # output prefix\n")
    assert energy_opt.parse_system_label(path) == "MyScan"
```

- [ ] **Step 2: Run parser tests and verify missing-function failures**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_basis_enthalpy.py -q'
```

Expected: FAIL because both parser functions are undefined.

- [ ] **Step 3: Implement strict labeled-field parsing and EnergyShift analysis rows**

Match complete lines case-insensitively, require each approved field exactly once, and reject non-finite values. Discover `<SystemLabel>.BASIS_ENTHALPY` from each case's `in/RUN.fdf`. Rename the existing `energy_eV` output column to `total_energy_eV` for EnergyShift only; Mesh.Cutoff retains its existing energy column contract.

Write EnergyShift columns in the approved order and compare all valid `basis_pressure_GPa` values with absolute tolerance `1e-9`. Build the total-energy series from all complete stdout cases and the basis-enthalpy series only from valid basis files. Plot both on one axes with distinct markers and a legend.

- [ ] **Step 4: Add an end-to-end analysis test for complete and missing basis data**

Create a temporary EnergyShift manifest with three cases, synthetic normal stdout for all three, valid basis files for two, and no basis file for one. Assert all three total-energy points are represented, only two basis values are nonempty, the missing row has `basis-data-missing`, orbital-volume CSV values are present, and the PNG is nonempty.

- [ ] **Step 5: Run basis analysis and energy regressions**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_basis_enthalpy.py tests/test_energy_opt.py tests/test_energy_cumulative.py -q'
```

Expected: all selected tests PASS.

---

### Task 5: Cumulative EOS manifests and whole-manifest analysis

**Files:**
- Modify: `/home/emsl_intern/SIESTA/eos_fitting.py`
- Create: `/home/emsl_intern/SIESTA/tests/test_eos_cumulative.py`

**Interfaces:**
- EOS case values are canonical four-decimal strings.
- EOS compatibility includes exact base-input fingerprint, system, and vacuum axis.
- `analyze(base)` consumes all manifest cases and fits the complete cumulative data.

- [ ] **Step 1: Write failing sequential-range and compatibility tests**

Prepare `0.94:1.00` with four samples, then `1.02:1.06` with three samples. Assert the schema-v2 manifest has seven sorted cases and preserves the first range. Change `STRUCT.fdf` and assert extension fails while existing metadata bytes remain unchanged.

- [ ] **Step 2: Run focused tests and observe current overwrite behavior**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_eos_cumulative.py -q'
```

Expected: FAIL because current EOS metadata stores only the most recent `scales` array.

- [ ] **Step 3: Implement EOS merging, exact-structure compatibility, migration, and cumulative analysis**

Use `Decimal(f"{scale:.4f}")` as case identity and numeric sort key. Preserve the existing Birch-Murnaghan and slab quadratic algorithms, but build input arrays from all complete manifest cases. Keep the fitted structure range check against the cumulative sampled minimum and maximum.

- [ ] **Step 4: Run EOS cumulative and fitting regressions**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m pytest tests/test_eos_cumulative.py tests/test_eos_fitting.py -q'
```

Expected: all selected tests PASS.

---

### Task 6: Help text, migration integration, and final verification

**Files:**
- Modify: `/home/emsl_intern/SIESTA/kpoints_opt.py`
- Modify: `/home/emsl_intern/SIESTA/energy_opt.py`
- Modify: `/home/emsl_intern/SIESTA/eos_fitting.py`
- Modify: `/home/emsl_intern/SIESTA/tests/test_prepare_integration.py`

**Interfaces:**
- Consumes all completed utilities.
- Produces verified cumulative prepare/analyze behavior without external calculation launches.

- [ ] **Step 1: Add help assertions for cumulative behavior and EnergyShift outputs**

Assert each top-level help contains `extends an existing compatible scan`. Assert EnergyShift help names `Basis enthalpy`, `Orbital volume`, and `results.csv`.

- [ ] **Step 2: Add schema-v1 integration fixtures and migration tests**

Create one old-format scan for each utility using the current schema-v1 fields. Run a compatible extension and assert the backup file is byte-identical to the original, schema v2 contains old and new cases, and no old result file is removed. Add one inconsistent old case and assert migration refuses without creating a backup or rewriting metadata.

- [ ] **Step 3: Run syntax checks and the complete test suite**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && python -m py_compile kpoints_opt.py energy_opt.py eos_fitting.py && python -m pytest tests -q'
```

Expected: compilation exits 0 and all tests PASS.

- [ ] **Step 4: Run sequential prepare-mode smoke tests through `pyutility` in a temporary descendant directory**

Create `/home/emsl_intern/SIESTA/.smoke.XXXXXX` with `mktemp -d`, copy the basic fixture, and register a trap that validates the resolved path prefix before deletion. Through `bash -lic`, run two compatible ranges for each utility in `prepare` mode. Validate schema version 2, cumulative case counts, input hashes, and unchanged source fixture hashes. Do not call `--mode local` or `--mode slurm`.

- [ ] **Step 5: Generate synthetic cumulative outputs and verify analysis artifacts**

Write normal synthetic stdout for every case and official-format basis files for EnergyShift. Run all analyze commands. Assert cumulative CSV row counts, nonempty PNG files, EnergyShift CSV orbital volumes, two legend labels in the plotted data path, and an EOS fitted structure when the synthetic minimum is inside the cumulative interval.

- [ ] **Step 6: Inspect remote scope and clean only generated caches**

```bash
ssh 147.46.142.250 'cd /home/emsl_intern/SIESTA && git status --short -- kpoints_opt.py energy_opt.py eos_fitting.py tests'
```

Expected: only intended utility/test paths appear. Remove only `/home/emsl_intern/SIESTA/tests/__pycache__` after resolving and validating that exact path. Do not stage or commit remote changes.
