# OUTCAR Block Boundary Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the supplied standard and home-version OUTCAR files end-to-end by bounding energy blocks correctly and permitting repeated pre-iteration header geometry without weakening malformed-data validation.

**Architecture:** Add declarative optimizer-diagnostic prefixes to the compatibility profile, replace the scanner's unbounded energy Boolean with an explicit separator-driven phase, and treat every complete pre-iteration volume/lattice pair as replaceable header geometry. Ionic detail ownership remains driven by `Iteration N(M)` and explicit `VOLUME and BASIS-vectors are now` sections.

**Tech Stack:** Python 3.11+, Pydantic, byte-oriented streaming parser, pytest, Ruff, Hatch

## Global Constraints

- `d Force / d Energy / d Ewald` is present in both supplied standard and home-version files; it is not a home-only exception.
- Optimizer diagnostics are validated and omitted from `energy_terms`; they do not become new wire/UI fields.
- The energy closing separator ends energy parsing before `forcemax`, optimizer, and timing assignments.
- Unknown valid single energy contributions remain preserved; malformed energy assignments inside the bounded body remain errors.
- Multiple complete volume/lattice blocks before the first `Iteration N(M)` are header geometry and never ionic-step details.
- Once an ionic iteration is active, volume/lattice ownership still requires the explicit geometry section and duplicate/conflict checks.
- Profiles remain declarative, bounded, ASCII, immutable, and non-executable.
- Supplied full OUTCAR files remain local audit inputs and are never committed.

---

### Task 1: Declare Optimizer Diagnostic Prefixes

**Files:**
- Modify: `src/vasp_analyzer/parsing/profiles/models.py`
- Modify: `src/vasp_analyzer/parsing/dialects/standard.py`
- Modify: `src/vasp_analyzer/parsing/dialects/home_barrier.py`
- Test: `tests/unit/parsing/profiles/test_loader.py`
- Test: `tests/unit/parsing/dialects/test_registry.py`

**Interfaces:**
- Add `DetailMarkers.optimizer_diagnostics: tuple[str, ...] = ("d Force",)`.
- Marker validation uses the existing bounded, ASCII, nonempty, case-insensitively unique literal-marker contract.
- Scanner Task 2 consumes these prefixes only while the energy phase is `body`.

- [ ] **Step 1: Write failing profile tests**

```python
def test_built_in_profiles_declare_force_optimizer_diagnostic() -> None:
    assert STANDARD.profile.outcar.details.optimizer_diagnostics == ("d Force",)
    assert HOME_BARRIER.profile.outcar.details.optimizer_diagnostics == ("d Force",)

@pytest.mark.parametrize("marker", ["", "Δ Force"])
def test_optimizer_diagnostic_marker_must_be_nonempty_ascii(marker: str) -> None:
    with pytest.raises(ValidationError):
        DetailMarkers(optimizer_diagnostics=(marker,))
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/dialects/test_registry.py -q`

Expected: attribute/constructor assertions fail because the marker collection does not exist.

- [ ] **Step 3: Implement the immutable marker field**

Add the field to `DetailMarkers` and include it in the same marker-tuple validator used by `energy_section`, `stress_section`, and `volume_basis_section`. Explicitly declare the value in both built-in dialect definitions even though the model has a default, so dialect behavior is inspectable.

- [ ] **Step 4: Verify GREEN and commit**

```text
python -m pytest tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/dialects/test_registry.py -q
python -m ruff check src/vasp_analyzer/parsing/profiles src/vasp_analyzer/parsing/dialects tests/unit/parsing/profiles tests/unit/parsing/dialects
git add src/vasp_analyzer/parsing/profiles/models.py src/vasp_analyzer/parsing/dialects/standard.py src/vasp_analyzer/parsing/dialects/home_barrier.py tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/dialects/test_registry.py
git commit -m "feat: declare OUTCAR optimizer diagnostics"
```

Expected: tests pass and Ruff is clean.

### Task 2: Bound Energy Parsing by Opening and Closing Separators

**Files:**
- Modify: `src/vasp_analyzer/parsing/recovery/scanner.py`
- Test: `tests/unit/parsing/recovery/test_scanner.py`

**Interfaces:**

```python
class _EnergyPhase(Enum):
    CLOSED = "closed"
    AWAITING_SEPARATOR = "awaiting_separator"
    BODY = "body"
```

- Energy marker sets `AWAITING_SEPARATOR`.
- First hyphen-only separator sets `BODY`.
- Next hyphen-only separator sets `CLOSED`.
- Prefix-matched optimizer rows in `BODY` are validated by analyzer-owned numeric grammar and omitted.

- [ ] **Step 1: Replace the two narrow regression cases with a failing format matrix**

```python
@pytest.mark.parametrize(
    "diagnostic",
    [
        b" d Force = 0.359E-03[ 0.351E-03, 0.368E-03]  d Energy = 0.358E-03 0.939E-06\n",
        b" d Force = 0.359E-03[ 0.351E-03, 0.368E-03]  d Energy = 0.358E-03-0.939E-06\n",
        b" d Force =-0.850E+00[-0.852E+00,-0.849E+00]  d Ewald  = 0.116E+02-0.125E+02\n",
        b" d Force =-0.850E+00[-0.852E+00,-0.849E+00]  d Ewald  =-0.116E+02 0.125E+02\n",
    ],
)
def test_optimizer_diagnostic_variants_are_omitted(diagnostic: bytes, tmp_path: Path) -> None:
    path = write_energy_fixture(tmp_path, body=diagnostic)
    assert scan_outcar(path, HOME_BARRIER).steps[0].energy_terms == ()
```

- [ ] **Step 2: Add failing boundary and strictness tests**

Add tests proving:

```python
def test_closing_energy_separator_prevents_forcemax_from_becoming_energy(...): ...
def test_malformed_single_energy_assignment_inside_body_still_fails(...): ...
def test_malformed_optimizer_diagnostic_inside_body_fails(...): ...
def test_unknown_valid_single_energy_assignment_is_preserved(...): ...
def test_incomplete_energy_block_rewinds_for_append_resume(...): ...
```

The `forcemax` case must use the exact supplied line after the closing separator.

- [ ] **Step 3: Verify RED**

Run: `python -m pytest tests/unit/parsing/recovery/test_scanner.py -k "energy or optimizer or forcemax" -q`

Expected: diagnostic variants and closing-boundary behavior fail under the current Boolean state.

- [ ] **Step 4: Implement the minimal phase state machine**

Replace `energy_section_active` with `_EnergyPhase`. Add a pure hyphen-separator predicate requiring at least ten hyphens after surrounding whitespace is stripped. Reset phase when the pending record finalizes, a stress/parameter section begins, or a bounded closing separator is consumed.

Within `BODY`, check `optimizer_diagnostics` before `_ENERGY_ASSIGNMENT_LINE`. Validate the entire row with one analyzer-owned grammar that accepts `d Energy` or `d Ewald`, signed scientific values, bracket bounds, and separated or concatenated final delta. Do not store a term.

- [ ] **Step 5: Remove obsolete hard-coded exceptions**

Delete `_IONIC_CONVERGENCE_DIAGNOSTIC`, `_FORCE_ENERGY_CONVERGENCE_DIAGNOSTIC`, and the prior exact exception helper once the profile-driven body logic covers them. Confirm `forcemax` needs no marker because it is outside the closed energy block.

- [ ] **Step 6: Verify GREEN and commit**

```text
python -m pytest tests/unit/parsing/recovery/test_scanner.py -q
python -m ruff check src/vasp_analyzer/parsing/recovery tests/unit/parsing/recovery
git add src/vasp_analyzer/parsing/recovery/scanner.py tests/unit/parsing/recovery/test_scanner.py
git commit -m "fix: bound OUTCAR energy blocks"
```

Expected: recovery tests pass; malformed energy and malformed optimizer rows remain rejected.

### Task 3: Permit Repeated Pre-Iteration Header Geometry

**Files:**
- Modify: `src/vasp_analyzer/parsing/recovery/scanner.py`
- Modify if checkpoint state changes: `src/vasp_analyzer/parsing/recovery/checkpoint.py`
- Test: `tests/unit/parsing/recovery/test_scanner.py`
- Test: `tests/unit/parsing/recovery/test_checkpoint.py`

**Interfaces:**
- Before `current_ionic_iteration` exists, a new volume after a complete header lattice commits/replaces header geometry instead of conflicting with the previous header volume.
- `lattice` retains the latest complete header lattice.
- `next_details` is empty when the first iteration begins; header volume never reaches a `StepRecord`.

- [ ] **Step 1: Write the failing two-header regression**

```python
def test_two_complete_header_geometries_select_latest_lattice_without_step_volume(tmp_path: Path) -> None:
    path = write_two_header_fixture(tmp_path, first_volume=280.6311, second_volume=280.63)
    scan = scan_outcar(path, STANDARD)
    assert scan.steps[0].lattice == SECOND_HEADER_LATTICE
    assert scan.steps[0].cell_volume == pytest.approx(280.63)  # ionic geometry-section volume
```

The fixture must contain an additional ionic `VOLUME and BASIS-vectors are now` section so the assertion distinguishes header and ionic volume ownership.

- [ ] **Step 2: Add failing header ownership/resume tests**

Assert that neither header volume is emitted when the ionic geometry section has no volume, incomplete second header lattice errors, duplicate volume without an intervening complete lattice errors, and append/resume cuts after each complete header lattice equal a fresh scan.

- [ ] **Step 3: Verify RED**

Run: `python -m pytest tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py -k "header or primitive or pre_iteration" -q`

Expected: current scanner raises `ambiguous with an unconsumed volume` on the second header volume.

- [ ] **Step 4: Implement replaceable header ownership**

Before routing a volume, if there is no active ionic iteration or pending record and the previous `next_details` contains only a volume that crossed a complete lattice, move it to `header_volume`, clear `next_details`, clear its start/crossed flags, then parse the new header block. Do not apply this rule after iteration ownership begins.

At the first iteration, flush any final complete header-only volume exactly once and enter iteration state with no pending ionic details.

- [ ] **Step 5: Verify GREEN and commit**

```text
python -m pytest tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py -q
python -m ruff check src/vasp_analyzer/parsing/recovery tests/unit/parsing/recovery
git add src/vasp_analyzer/parsing/recovery/scanner.py src/vasp_analyzer/parsing/recovery/checkpoint.py tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py
git commit -m "fix: accept repeated OUTCAR header geometry"
```

Stage `checkpoint.py` only if it actually changed.

### Task 4: Full-File Audit Acceptance and Installed-Wheel Verification

**Files:**
- Add: `scripts/audit_outcar.py`
- Add: `tests/unit/test_audit_outcar.py`
- Modify: `scripts/verify_installed_wheel.py`
- Test: `tests/unit/test_installed_wheel_smoke.py`
- Local-only inputs: `C:/Users/tlswn/Documents/YBCO6.5/audit-input/OUTCAR_homever`
- Local-only inputs: `C:/Users/tlswn/Documents/YBCO6.5/audit-input/OUTCAR_official`

**Interfaces:**
- `audit_outcar.py PATH` reports dialect, byte size, iterations, force blocks, energy blocks, parsed steps, SCF range, and warnings.
- Exit 0 requires full parser success and matching iteration/force/energy/step counts.

- [ ] **Step 1: Write failing audit-script tests**

Use small committed fixtures to assert JSON output and nonzero exit on count mismatch or parser error. The script must call production dialect detection and `scan_outcar`, not duplicate parser logic.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/test_audit_outcar.py -q`

Expected: module/script is absent.

- [ ] **Step 3: Implement the read-only audit command**

The command reads only the requested OUTCAR and emits deterministic JSON. It never modifies a calculation directory or stores raw proprietary lines in the repository.

- [ ] **Step 4: Run both supplied full files**

```text
python scripts/audit_outcar.py C:/Users/tlswn/Documents/YBCO6.5/audit-input/OUTCAR_homever
python scripts/audit_outcar.py C:/Users/tlswn/Documents/YBCO6.5/audit-input/OUTCAR_official
```

Expected:

```text
home: dialect=home_barrier, iterations=35, forceBlocks=35, energyBlocks=35, parsedSteps=35
official: dialect=standard, iterations=200, forceBlocks=200, energyBlocks=200, parsedSteps=200
```

Both outputs must report non-null `scfIterations` for every step. Any unrecognized assignment inside a bounded energy body remains a parser error and therefore makes the audit exit nonzero.

- [ ] **Step 5: Verify fresh versus append/resume on selected real boundaries**

Run the audit script's resume mode at: after the first header lattice, after the second official header lattice, after a complete ionic geometry lattice, after an energy body, and after a completed force record. Expected: resumed final records equal fresh records for all selected cuts.

- [ ] **Step 6: Run complete source gates**

```text
python -m pytest -q
python -m ruff check src tests scripts
```

Expected: all non-environment-dependent tests pass; only documented corpus/symlink skips and the existing external dependency warning may remain.

- [ ] **Step 7: Build and test the installed wheel against both real files**

```text
pnpm --dir vscode build
python -m build
python scripts/verify_release_artifacts.py --wheel dist/vasp_analyzer-0.1.0-py3-none-any.whl --sdist dist/vasp_analyzer-0.1.0.tar.gz --vsix vscode/vasp-analyzer-0.1.0.vsix
```

Install the exact wheel in a temporary venv, invoke its installed `analyzer` console entrypoint for both local audit inputs, and assert schema 3, no error envelope, 35/200 steps, and non-null SCF counts. Do not import source checkout modules.

- [ ] **Step 8: Commit audit tooling and report evidence**

```text
git add scripts/audit_outcar.py tests/unit/test_audit_outcar.py scripts/verify_installed_wheel.py tests/unit/test_installed_wheel_smoke.py
git commit -m "test: audit complete OUTCAR files"
```

Record commands, totals, artifact SHA-256 values, and both real-file summaries in the task report. Do not commit the supplied OUTCAR files or generated artifacts.
