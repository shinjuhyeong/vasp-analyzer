# Initial Structure and Ionic Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly assign OUTCAR details to VASP ionic iterations, expose a true POSCAR-backed Initial frame, and compare Initial with ionic step N using drift-corrected atomic displacement and lattice-vector changes.

**Architecture:** The compatibility profile declares bounded text markers while the recovery scanner owns iteration state and validates structural section boundaries. The versioned dataset transports an optional immutable initial structure. The Webview uses a discriminated frame selection and a pure comparison-math layer, then passes an explicit comparison scene to the existing 3Dmol renderer.

**Tech Stack:** Python 3.11+, Pydantic, pytest, Ruff, TypeScript, React 19, Vitest, 3Dmol.js, pnpm, Hatch, VSCE

## Global Constraints

- `Iteration N(M)` is the primary ionic-detail owner; lattice, stress, volume, and force markers remain fail-closed validators.
- Only a real POSCAR may be labeled Initial. CONTCAR and the first OUTCAR force frame must never be substituted.
- Existing persisted `selectedStep: n` always migrates to ionic step `n`, never Initial.
- Compare is available only on Initial, hides force vectors, and draws displacement vectors only for primary-cell atoms.
- Every displacement vector starts at the initial atom center. At 1x its endpoint equals the drift-aligned target atom.
- Common drift is an arithmetic-mean Cartesian vector; target atoms are translated by its negative. Cell vectors are not drift corrected.
- Displacement scale is independently persisted and uses the existing logarithmic 1x–1000x behavior.
- Comparison failures are bounded and fall back to the data table without crashing the Webview.
- Follow test-driven development: add and run the focused failing test before each production change.

---

### Task 1: Add Declarative Iteration and Geometry-Section Markers

**Files:**
- Modify: `src/vasp_analyzer/parsing/profiles/models.py`
- Modify: `src/vasp_analyzer/parsing/dialects/standard.py`
- Modify: `src/vasp_analyzer/parsing/dialects/home_barrier.py`
- Test: `tests/unit/parsing/profiles/test_loader.py`
- Test: `tests/unit/parsing/dialects/test_registry.py`

**Interfaces:**
- Add a bounded `iteration` pattern with named decimal groups `ionic` and `electronic`.
- Add a literal `volume_basis_section` marker for `VOLUME and BASIS-vectors are now`.
- Profiles remain data-only; custom profiles cannot execute Python or provide an unbounded arbitrary regex.

- [ ] **Step 1: Write failing profile tests**

```python
def test_standard_profile_declares_iteration_and_volume_basis_markers() -> None:
    rule = STANDARD_DIALECT.profile.outcar
    assert rule.details.iteration.parse(b"---------------- Iteration    2( 17) ----------------") == (2, 17)
    assert rule.details.volume_basis_section == (b"VOLUME and BASIS-vectors are now",)

def test_iteration_pattern_requires_both_positive_decimal_groups() -> None:
    with pytest.raises(ValidationError):
        IterationPattern(prefix="Iteration", ionic_group=".*", electronic_group="\\d+")
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/dialects/test_registry.py -q`

Expected: imports or assertions fail because iteration and volume/basis contracts do not exist.

- [ ] **Step 3: Implement the minimal immutable profile contract**

Add an immutable marker object that recognizes whitespace-tolerant `Iteration <positive-int>(<positive-int>)` without accepting trailing malformed counters. Validate nonempty/unique literal geometry markers with the existing marker validators. Populate both built-in profiles explicitly so home-version changes remain declarative.

- [ ] **Step 4: Verify focused profile behavior**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/dialects/test_registry.py -q`

Expected: all profile tests pass, including malformed/zero/missing-parenthesis cases.

- [ ] **Step 5: Commit the profile grammar**

```text
git add src/vasp_analyzer/parsing/profiles/models.py src/vasp_analyzer/parsing/dialects/standard.py src/vasp_analyzer/parsing/dialects/home_barrier.py tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/dialects/test_registry.py
git commit -m "feat: declare OUTCAR ionic iteration markers"
```

### Task 2: Make Iteration Evidence Own Recovery-Scanner Details

**Files:**
- Modify: `src/vasp_analyzer/parsing/recovery/scanner.py`
- Modify: `src/vasp_analyzer/parsing/recovery/checkpoint.py`
- Add: `tests/fixtures/outcar/iteration-volume-basis-two-step.OUTCAR`
- Test: `tests/unit/parsing/recovery/test_scanner.py`
- Test: `tests/unit/parsing/recovery/test_checkpoint.py`

**Interfaces:**
- Scanner state tracks current one-based ionic iteration and maximum observed electronic iteration.
- Completed VASP iteration `N` produces analyzer step index `N - 1` and `scf_iterations=max(M)`.
- Header lattice may initialize geometry, but header volume is not consumed by step 1.
- `VOLUME and BASIS-vectors are now` opens one bounded active-iteration geometry section.

- [ ] **Step 1: Add the exact reported sequence as a failing fixture test**

```python
def test_iteration_owns_stress_volume_lattice_and_force_without_header_conflict(tmp_path: Path) -> None:
    result = scan_fixture(tmp_path, "iteration-volume-basis-two-step.OUTCAR")
    assert [(step.index, step.scf_iterations, step.cell_volume) for step in result.steps] == [
        (0, 17, 351.73),
        (1, 9, 352.11),
    ]
    assert result.steps[0].external_pressure_kb == pytest.approx(-6.40)
```

The fixture must include initial volume/lattice, repeated `Iteration 1(M)`, stress, external pressure, the volume/basis banner, step volume/lattice, force block, then iteration 2.

- [ ] **Step 2: Add failing negative and resume tests**

Cover decreasing ionic numbers, a skipped completed iteration, decreasing/zero electronic counters, duplicate volume in one geometry section, marker-free ambiguous lattice crossings, incomplete final iteration, and append/resume from a checkpoint saved inside iteration 1.

- [ ] **Step 3: Run scanner tests and verify RED**

Run: `python -m pytest tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py -q`

Expected: the reported sequence raises the current ambiguous-volume error and SCF assertions observe `None`.

- [ ] **Step 4: Implement iteration-owned state transitions**

Introduce explicit scanner state equivalent to:

```python
current_ionic_iteration: int | None
max_electronic_iteration: int | None
geometry_section_open: bool
header_volume: float | None
```

On an iteration banner, validate monotonicity within the file and update the SCF maximum without creating a record. Route stress, pressure, active-section volume, and lattice to the active iteration. On a complete force block, require contiguous `N == next_step_id + 1`, emit `scf_iterations`, close the geometry section, and clear per-iteration state. Preserve the existing incomplete-tail policy.

- [ ] **Step 5: Persist sufficient checkpoint state**

Extend `ParserCheckpoint` with the active iteration, electronic maximum, and geometry-section status required for deterministic append/resume. Reject incompatible old checkpoint payloads through the existing cache/checkpoint version boundary instead of guessing ownership.

- [ ] **Step 6: Verify focused recovery and adapter suites**

Run:

```text
python -m pytest tests/unit/parsing/recovery tests/unit/parsing/adapters/test_outcar_ase.py -q
python -m ruff check src/vasp_analyzer/parsing tests/unit/parsing
```

Expected: all tests pass; ambiguous unowned crossings still raise `OutcarFormatError`.

- [ ] **Step 7: Commit scanner ownership**

```text
git add src/vasp_analyzer/parsing/recovery tests/fixtures/outcar/iteration-volume-basis-two-step.OUTCAR tests/unit/parsing/recovery
git commit -m "fix: assign OUTCAR details by ionic iteration"
```

### Task 3: Add the Optional POSCAR-Backed Initial Structure Contract

**Files:**
- Modify: `src/vasp_analyzer/core/models.py`
- Modify: `src/vasp_analyzer/calculation/dataset.py`
- Modify: `src/vasp_analyzer/calculation/cache.py`
- Test: `tests/unit/test_models.py`
- Test: `tests/integration/test_dataset.py`
- Test: `tests/unit/calculation/test_cache_security.py`

**Interfaces:**

```python
class InitialStructure(FrozenModel):
    source: Literal["POSCAR"] = "POSCAR"
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]

class CalculationDataset(FrozenModel):
    schema_version: Literal[3] = 3
    initial_structure: InitialStructure | None
```

- [ ] **Step 1: Write failing model and dataset tests**

Assert schema 3 camelCase serialization, coordinate-length validation, POSCAR-backed availability, POSCAR absence yielding `None`, and CONTCAR-only input yielding `None`. Also assert existing sites/selective masks still come from the best available structure source needed for ionic visualization.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `python -m pytest tests/unit/test_models.py tests/integration/test_dataset.py tests/unit/calculation/test_cache_security.py -q`

Expected: schema and `initialStructure` assertions fail.

- [ ] **Step 3: Implement and assemble the initial structure**

Construct `InitialStructure` only from the parsed `poscar` object. Do not use `selected = poscar or contcar` for this field. Validate that its coordinate counts equal `sites`; fail with a bounded calculation-data error on mismatch.

- [ ] **Step 4: Bump cache identity**

Increase `_CACHE_SCHEMA_VERSION` so schema-2 datasets and old checkpoint ownership cannot be reused. Update the cache-security assertions to the new exact version.

- [ ] **Step 5: Verify dataset behavior**

Run:

```text
python -m pytest tests/unit/test_models.py tests/integration/test_dataset.py tests/unit/calculation -q
python -m ruff check src tests
```

Expected: all pass; CONTCAR-only is explicitly not Initial.

- [ ] **Step 6: Commit the Python dataset contract**

```text
git add src/vasp_analyzer/core/models.py src/vasp_analyzer/calculation/dataset.py src/vasp_analyzer/calculation/cache.py tests/unit/test_models.py tests/integration/test_dataset.py tests/unit/calculation/test_cache_security.py
git commit -m "feat: expose POSCAR initial structure"
```

### Task 4: Propagate Schema 3 Through Transport and Release Contracts

**Files:**
- Modify: `tests/unit/transport/test_protocol.py`
- Modify: `tests/integration/test_stdio.py`
- Modify: `tests/integration/test_web.py`
- Modify: `tests/integration/test_cli.py`
- Modify: `tests/integration/test_cli_module.py`
- Modify: `tests/unit/test_installed_wheel_smoke.py`
- Modify: `tests/unit/test_release_artifacts.py`
- Modify: `vscode/src/webview/core/contracts.ts`
- Modify: `vscode/src/webview/core/schema.test.ts`
- Modify: `vscode/src/webview/core/host.ts`
- Modify: `vscode/src/webview/core/host.test.ts`
- Modify: `vscode/src/webview/test/fixtures.ts`

**Interfaces:**
- `DATASET_SCHEMA_VERSION` becomes `3`.
- `CalculationDataset.initialStructure` is nullable and strictly validated when present.
- Stdio, HTTP, packaged `contract.json`, wheel assets, and VSIX assets bind the same schema.

- [ ] **Step 1: Change tests to require schema 3 and strict initialStructure validation**

Add host-validation cases for valid Initial, missing/nullable Initial, mismatched coordinate lengths, non-finite vectors, unknown source values, and schema 2 rejection.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```text
python -m pytest tests/unit/transport tests/integration/test_stdio.py tests/integration/test_web.py tests/integration/test_cli.py tests/integration/test_cli_module.py tests/unit/test_installed_wheel_smoke.py tests/unit/test_release_artifacts.py -q
pnpm --dir vscode test -- core/schema.test.ts core/host.test.ts
```

Expected: old schema-2 constants and manifests fail.

- [ ] **Step 3: Update the TypeScript and packaged contract surfaces together**

Define `InitialStructure`, add `initialStructure: InitialStructure | null`, validate all required dataset keys in `isCalculationDataset`, and change all exact schema checks to 3. Do not accept a schema-2 dataset through partial structural compatibility.

- [ ] **Step 4: Verify all contract surfaces**

Run the commands from Step 2 again.

Expected: Python transport and Webview host contract tests pass.

- [ ] **Step 5: Commit the wire schema bump**

```text
git add src tests vscode/src/webview/core vscode/src/webview/test/fixtures.ts
git commit -m "feat: publish initial structure schema"
```

### Task 5: Replace Numeric Step State With a Discriminated Frame Selection

**Files:**
- Modify: `vscode/src/webview/core/contracts.ts`
- Modify: `vscode/src/webview/core/store.ts`
- Modify: `vscode/src/webview/core/host.ts`
- Modify: `vscode/src/webview/core/runtimeHost.ts`
- Test: `vscode/src/webview/core/store.test.ts`
- Test: `vscode/src/webview/core/host.test.ts`
- Test: `vscode/src/webview/core/runtimeHost.test.ts`

**Interfaces:**

```ts
type FrameSelection =
  | Readonly<{ kind: "initial" }>
  | Readonly<{ kind: "ionic"; index: number }>;

interface PersistedAnalysisStateV4 {
  readonly version: 4;
  readonly selectedFrame: FrameSelection;
  readonly comparisonTarget: number;
  readonly displacementScale: number;
}
```

- [ ] **Step 1: Add failing migration and reducer tests**

Assert that legacy `{version: 3, selectedStep: 1}` becomes ionic index 1, Initial is selected only when explicitly requested and available, missing POSCAR clamps Initial to ionic 0, target clamps to existing ionic steps, leaving Initial disables Compare, and displacement scale clamps to 1–1000 independently of force scale.

- [ ] **Step 2: Run focused state tests and verify RED**

Run: `pnpm --dir vscode test -- core/store.test.ts core/host.test.ts core/runtimeHost.test.ts`

Expected: the new selection and persisted fields are absent.

- [ ] **Step 3: Implement v4 normalization and reducer actions**

Keep migration in the host boundary, not inside components. Add actions for `selectFrame`, `setCompareEnabled`, `setComparisonTarget`, and `setDisplacementScale`. State normalization must be a pure function of persisted input plus the loaded dataset.

- [ ] **Step 4: Verify focused state tests and typecheck**

Run:

```text
pnpm --dir vscode test -- core/store.test.ts core/host.test.ts core/runtimeHost.test.ts
pnpm --dir vscode typecheck
```

- [ ] **Step 5: Commit frame state and migration**

```text
git add vscode/src/webview/core
git commit -m "feat: persist initial and ionic frame selection"
```

### Task 6: Implement Pure Periodic Comparison Mathematics

**Files:**
- Add: `vscode/src/webview/features/structure/comparison.ts`
- Add: `vscode/src/webview/features/structure/comparison.test.ts`

**Interfaces:**

```ts
interface SiteComparison {
  readonly siteIndex: number;
  readonly imageShift: readonly [number, number, number];
  readonly initialCartesian: Vec3;
  readonly mappedTargetCartesian: Vec3;
  readonly alignedTargetCartesian: Vec3;
  readonly rawDisplacement: Vec3;
  readonly displacement: Vec3;
  readonly rank: number;
}

interface StructureComparison {
  readonly sites: readonly SiteComparison[];
  readonly removedDrift: Vec3;
  readonly cellDeltas: readonly [Vec3, Vec3, Vec3];
  readonly summary: ComparisonSummary;
}
```

- [ ] **Step 1: Write failing math tests**

Cover orthogonal boundary crossing, skewed cells requiring deterministic image search, arithmetic-mean drift removal, zero-mean displayed displacement, 1x endpoint equality, stable rank tie-breaking by site index, lattice delta components, length/angle/volume changes, mismatched site counts, non-finite input, and singular lattices.

- [ ] **Step 2: Run comparison tests and verify RED**

Run: `pnpm --dir vscode test -- features/structure/comparison.test.ts`

Expected: module not found.

- [ ] **Step 3: Implement deterministic nearest-image mapping**

Search a bounded integer neighborhood around the fractional image implied by the two lattices, compare Cartesian squared distances, and break equal-distance ties lexicographically by image shift. Validate finite coordinates and determinant magnitude before calculation.

- [ ] **Step 4: Implement drift, rank, and cell summaries**

Compute `removedDrift = mean(rawDisplacement)`, `alignedTarget = mappedTarget - removedDrift`, and `displacement = rawDisplacement - removedDrift`. Rank descending by norm then ascending site index. Return deeply readonly values.

- [ ] **Step 5: Verify focused math and typecheck**

Run:

```text
pnpm --dir vscode test -- features/structure/comparison.test.ts
pnpm --dir vscode typecheck
```

- [ ] **Step 6: Commit the pure comparison layer**

```text
git add vscode/src/webview/features/structure/comparison.ts vscode/src/webview/features/structure/comparison.test.ts
git commit -m "feat: compute periodic structure displacement"
```

### Task 7: Extend the Renderer With an Explicit Comparison Scene

**Files:**
- Modify: `vscode/src/webview/renderers/CrystalRenderer.ts`
- Modify: `vscode/src/webview/renderers/ThreeDmolRenderer.ts`
- Modify: `vscode/src/webview/renderers/ThreeDmolRenderer.test.ts`
- Modify: `vscode/src/webview/features/structure/scene.ts`
- Modify: `vscode/src/webview/features/structure/scene.test.ts`

**Interfaces:**

```ts
interface ComparisonScene {
  readonly initialFrame: CrystalFrame;
  readonly targetFrame: CrystalFrame;
  readonly displacements: readonly VectorGlyph[];
  readonly displacementScale: number;
  readonly cellDeltas: readonly CellAxis[];
}

interface CrystalScene {
  readonly comparison: ComparisonScene | null;
}
```

- [ ] **Step 1: Write failing scene and renderer tests**

Assert muted initial/solid target atoms, dashed initial/solid target cages, cyan displacement arrows originating at initial atoms, orange delta-a/b/c arrows at the shared origin, no force glyphs in comparison, primary-cell-only displacement count under a 2×2×1 supercell, stable selection for either overlay, and removal of obsolete shapes/models when comparison is toggled off.

- [ ] **Step 2: Run focused renderer tests and verify RED**

Run: `pnpm --dir vscode test -- features/structure/scene.test.ts renderers/ThreeDmolRenderer.test.ts`

- [ ] **Step 3: Add comparison scene types and scene construction**

Build both frames through existing crystal-aware supercell/bond logic. Generate displacement glyphs only from primary initial sites. Keep displacement scaling in the renderer so changing scale does not move target atoms.

- [ ] **Step 4: Render comparison in isolated object groups**

Track initial atoms/cage, target atoms/cage, displacements, and cell deltas as separate disposable groups. Apply opacity/dash/color styling, attach both atom overlays to the same site-index callback, and preserve rotation, zoom, orthographic projection, resize, and reset behavior.

- [ ] **Step 5: Verify renderer cleanup and production type safety**

Run:

```text
pnpm --dir vscode test -- features/structure/scene.test.ts renderers/ThreeDmolRenderer.test.ts
pnpm --dir vscode typecheck
```

- [ ] **Step 6: Commit renderer support**

```text
git add vscode/src/webview/renderers vscode/src/webview/features/structure/scene.ts vscode/src/webview/features/structure/scene.test.ts
git commit -m "feat: render initial structure comparison"
```

### Task 8: Wire Initial, Compare Controls, Inspector, and Convergence Empty State

**Files:**
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/webview/App.test.tsx`
- Modify: `vscode/src/webview/features/convergence/IonicStepControl.tsx`
- Modify: `vscode/src/webview/features/convergence/IonicStepControl.test.tsx`
- Modify: `vscode/src/webview/features/convergence/ConvergenceWorkspace.tsx`
- Modify: `vscode/src/webview/features/convergence/ConvergenceWorkspace.test.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.test.tsx`
- Modify: `vscode/src/webview/features/structure/AtomDetail.tsx`
- Add: `vscode/src/webview/features/structure/ComparisonInspector.tsx`
- Add: `vscode/src/webview/features/structure/ComparisonInspector.test.tsx`
- Modify: `vscode/src/webview/features/layout/CompactToolbar.tsx`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Frame input accepts 0 for Initial and 1..N for ionic steps.
- Compare toggle and target control exist only while Initial is selected and ionic steps exist.
- Convergence graphs remain visible on Initial but show no selected marker and an explicit initial-state message.

- [ ] **Step 1: Add failing user-flow tests**

Test Initial/total labels, slider and number synchronization, legacy ionic selection preservation, Compare lifecycle, target selection, independent logarithmic displacement slider/number, force controls hidden during comparison, atom click selection across overlays, and missing-POSCAR behavior.

- [ ] **Step 2: Add failing detail/summary tests**

Require element/site, initial and target fractional positions, initial and aligned Cartesian positions, raw/display displacement and norms, removed drift vector and norm, periodic image shift, rank, multiplier, max/mean displacement, and cell vector/length/angle/volume changes.

- [ ] **Step 3: Add failing convergence Initial tests**

Assert full Energy/Force/Cell & Stress graph data remains rendered, selected-value cards say `Initial structure has no ionic convergence values`, and no selected-step marker/table row is invented.

- [ ] **Step 4: Run UI tests and verify RED**

Run:

```text
pnpm --dir vscode test -- App.test.tsx features/convergence/IonicStepControl.test.tsx features/convergence/ConvergenceWorkspace.test.tsx features/structure/CrystalPanel.test.tsx features/structure/ComparisonInspector.test.tsx
```

- [ ] **Step 5: Implement frame-aware App wiring**

Resolve the selected display frame from `selectedFrame`; pass an optional ionic selection to convergence; construct comparison only for Initial+Compare; catch comparison construction errors at the structure boundary and invoke the existing fallback surface.

- [ ] **Step 6: Implement controls and inspector**

Reuse the existing accessible range+number pattern and force-scale logarithmic conversion helpers. Display the removed drift explicitly as `[dx, dy, dz] Å; |t| = … Å`. Ensure the displacement arrow multiplier label always reports the clamped current value.

- [ ] **Step 7: Verify UI, accessibility, and typecheck**

Run:

```text
pnpm --dir vscode test -- App.test.tsx features/convergence features/structure
pnpm --dir vscode typecheck
```

- [ ] **Step 8: Commit the complete interaction**

```text
git add vscode/src/webview
git commit -m "feat: compare initial and ionic structures"
```

### Task 9: Full Verification, Real OUTCAR Check, and Release Artifacts

**Files:**
- Modify if required by documentation: `README.md`
- Generate but do not commit: `vscode/dist/webview/*`, `vscode/vasp-analyzer-0.1.0.vsix`, `dist/*`
- Verify: wheel, sdist, VSIX, packaged Webview contract

- [ ] **Step 1: Run the complete source test suites**

```text
python -m pytest -q
python -m ruff check src tests
pnpm --dir vscode test
pnpm --dir vscode typecheck
```

Expected: every test passes, skips are only the documented environment-dependent cases, and Ruff/typecheck report no errors.

- [ ] **Step 2: Build production Webview and extension**

```text
pnpm --dir vscode build
pnpm --dir vscode package
```

Expected: production Webview assets and a VSIX are produced with schema 3 contract metadata.

- [ ] **Step 3: Build and inspect Python artifacts**

```text
python -m build
python -m pytest tests/unit/test_release_artifacts.py tests/unit/test_installed_wheel_smoke.py -q
python scripts/verify_release_artifacts.py --wheel dist/*.whl --sdist dist/*.tar.gz --vsix vscode/vasp-analyzer-0.1.0.vsix
```

Expected: wheel and sdist include the exact built Webview and `contract.json`; artifact verification passes.

- [ ] **Step 4: Perform a clean installed-wheel stdio smoke test**

Install the new wheel into a temporary virtual environment and run:

```text
printf '{"id":1,"method":"getDataset","params":{}}\n' | analyzer serve --stdio /path/to/OUTCAR
```

Expected: one JSON response with `schemaVersion: 3`, no `outcar_format` error, populated step-1 `scfIterations`, and `initialStructure` present only when POSCAR is beside OUTCAR.

- [ ] **Step 5: Validate the reported YBCO calculation on Remote SSH**

Against `/home/emsl_intern/VASP/YBCO6.5/03_Shift0.1/01_StructureOptimization/01_RelaxationResult/OUTCAR`, confirm:

```python
assert result["schemaVersion"] == 3
assert result["ionicSteps"][0]["cellVolume"] == 351.73
assert result["ionicSteps"][0]["externalPressureKb"] == -6.40
assert result["ionicSteps"][0]["scfIterations"] is not None
```

Open through the Remote-SSH VS Code command and visually check Initial, Compare→step N, 1x arrow endpoints, removed drift, delta-a/b/c, supercell primary-only arrows, rotation/zoom, atom inspection, and convergence Initial state.

- [ ] **Step 6: Review the diff and commit documentation only if it changed**

```text
git status --short
git diff --check
git diff -- README.md
```

`dist/`, `vscode/dist/`, and `vscode/*.vsix` are intentionally ignored release outputs. Do not force-add them. If usage documentation changed, stage only `README.md` and commit it as `docs: explain initial structure comparison`; otherwise create no empty commit.

- [ ] **Step 7: Push and update the draft PR**

```text
git push origin agent/vasp-analyzer-v1
```

Record exact Python/Webview test totals, artifact hashes, installed-wheel result, and Remote-SSH YBCO result in the PR description or release notes.
