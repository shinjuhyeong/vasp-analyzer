# Detailed Convergence and OUTCAR Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile-driven OUTCAR energy, pressure, stress, and effective-parameter parsing plus a synchronized, multi-module convergence workspace with detailed selected-step tables.

**Architecture:** Extend the existing byte-oriented recovery scanner so record boundaries, incomplete tails, home-dialect normalization, and append resume remain authoritative. Publish the new details through immutable dataset schema 2 and cache schema 3, then consume them through small React selectors and independent Energy, Force, Cell & Stress, and Parameters components. Persist presentation choices in viewer state version 3 while leaving structure full-screen session-only.

**Tech Stack:** Python 3.11+, Pydantic v2, ASE, pytest, Ruff, TypeScript, React, Vitest, Testing Library, 3Dmol.js, VS Code Webview, pnpm, esbuild, vsce.

## Global Constraints

- Parse OUTCAR in the existing streaming pass; do not add an unconditional second full-file read.
- Preserve exact ionic `step_id` reconciliation, incomplete-tail recovery, and bounded append resume.
- Store energy and stress values only when finite; never substitute zero for missing data.
- Preserve raw labels and raw parameter occurrences even when no canonical interpretation exists.
- Keep compatibility profiles declarative and fail closed; never execute user Python, shell, expressions, or arbitrary code.
- Canonical units are eV, eV/angstrom, angstrom, angstrom^3, and kB; UI may derive GPa using exactly `1 kB = 0.1 GPa`.
- Preserve VASP's reported stress sign convention and label it in the UI.
- Dataset/wire schema becomes 2, application-cache schema becomes 3, and persisted Webview state becomes 3.
- Old application caches rebuild from source; persisted viewer state version 2 migrates without losing its layout, selected step/site, or force settings.
- First normalized convergence-module selection is Energy only; subsequent module, metric, and mode choices persist.
- Full-screen remains session-only and never enters persisted state.
- Rank highlights pair color with visible rank text; color alone is insufficient.
- Read the configured real corpus only through the opt-in corpus tests; never commit or print its private absolute path.
- Generated wheel, sdist, and VSIX files remain uncommitted.

---

## File Structure

### Python domain and parsing

- `src/vasp_analyzer/core/models.py`: immutable dataset schema 2 types for detailed energy, stress, and parameters.
- `src/vasp_analyzer/parsing/profiles/models.py`: validated declarative aliases and recognized-section markers.
- `src/vasp_analyzer/parsing/recovery/details.py`: pure parsers for finite energy terms, pressure/stress/volume, and parameter occurrences.
- `src/vasp_analyzer/parsing/recovery/scanner.py`: associate parsed detail blocks with pending ionic records and collect ordered parameters.
- `src/vasp_analyzer/calculation/dataset.py`: reconcile scanner details with ASE trajectory frames.
- `src/vasp_analyzer/calculation/cache.py`: cache schema 3 invalidation.
- `src/vasp_analyzer/transport/protocol.py`: schema 2 transport coverage.

### Webview contracts and state

- `vscode/src/webview/core/contracts.ts`: schema 2 wire types and persisted-state version 3 types.
- `vscode/src/webview/core/host.ts`: strict deep validation and state migration.
- `vscode/src/webview/core/store.ts`: module preference normalization and reducer actions.
- `vscode/src/webview/features/convergence/detailRows.ts`: pure table-row and deterministic ranking selectors.
- `vscode/src/webview/features/convergence/ConvergenceWorkspace.tsx`: module selection, shared step control, and responsive composition.
- `vscode/src/webview/features/convergence/EnergyModule.tsx`: energy metric, graph, and selected-step table.
- `vscode/src/webview/features/convergence/ForceModule.tsx`: force metric, graph, and selected-step atom table.
- `vscode/src/webview/features/convergence/CellStressModule.tsx`: pressure/volume graphs and stress table.
- `vscode/src/webview/features/parameters/ParametersPanel.tsx`: interpreted/raw/search/category presentation.
- `vscode/src/webview/features/analysis/AnalysisTabs.tsx`: Convergence and Parameters tab selection.
- `vscode/src/webview/features/layout/DraggableCrystalPalette.tsx`: collapsed drag handle and separate expand action.
- `vscode/src/webview/features/structure/CrystalPanel.tsx`: pressure overlay and atom-overlay styling hooks.
- `vscode/src/webview/styles.css`: responsive grid, tables, rank styles, and overlay contrast.
- `vscode/src/webview/App.tsx`: state wiring and selected-site synchronization.

---

### Task 1: Publish dataset schema 2 scientific contracts

**Files:**
- Modify: `src/vasp_analyzer/core/models.py`
- Modify: `src/vasp_analyzer/core/__init__.py`
- Modify: `tests/unit/test_models.py`
- Modify: `tests/unit/core/test_future_contracts.py`

**Interfaces:**
- Produces: `EnergyTerm`, `ParameterOccurrence`, and the new optional `IonicStep` detail fields.
- Produces: `CalculationDataset.schema_version: Literal[2]` and `CalculationDataset.parameters`.
- Consumes: existing `FrozenModel`, `Vec3`, and `Mat3` validation conventions.

- [ ] **Step 1: Write failing immutable-model and validation tests**

```python
def test_dataset_v2_preserves_energy_stress_and_parameter_occurrences() -> None:
    term = EnergyTerm(
        key="ewald",
        raw_label="Ewald energy",
        value=-123.5,
        unit="eV",
        kind="contribution",
    )
    parameter = ParameterOccurrence(
        key="encut",
        raw_key="ENCUT",
        raw_value="520.0",
        value=520.0,
        unit="eV",
        category="electronic",
        description="Plane-wave cutoff",
        ordinal=0,
        line_number=12,
    )
    step = IonicStep(
        index=0,
        lattice=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        fractional_positions=(),
        cartesian_positions=(),
        raw_forces=(),
        free_forces=(),
        free_force_norms=(),
        total_energy=-123.5,
        energy_terms=(term,),
        external_pressure_kb=-3.2,
        pulay_stress_kb=0.4,
        stress_tensor_kb=((1.0, 0.1, 0.2), (0.1, 2.0, 0.3), (0.2, 0.3, 3.0)),
        cell_volume=173.0,
        delta_energy=None,
        scf_iterations=None,
        electronic_converged=None,
        ionic_converged=None,
        strongest_free_component=None,
        rms_free_force=None,
    )
    dataset = CalculationDataset(
        root="/calculation",
        source_files=(),
        sites=(),
        ionic_steps=(step,),
        parameters=(parameter,),
        capabilities=(),
    )
    assert dataset.schema_version == 2
    assert dataset.ionic_steps[0].energy_terms[0].raw_label == "Ewald energy"
    assert dataset.parameters[0].value == 520.0


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_new_scientific_values_reject_non_finite_numbers(value: float) -> None:
    with pytest.raises(ValidationError):
        EnergyTerm(
            key="ewald", raw_label="Ewald", value=value, unit="eV", kind="contribution"
        )
```

- [ ] **Step 2: Run the tests and witness schema-1/type failures**

Run: `python -m pytest tests/unit/test_models.py tests/unit/core/test_future_contracts.py -v`

Expected: FAIL because `ParameterOccurrence` and the new fields do not exist and `schema_version` is still 1.

- [ ] **Step 3: Add strict immutable contracts and finite validators**

```python
class EnergyTerm(FrozenModel):
    key: str
    raw_label: str
    value: float
    unit: Literal["eV"] = "eV"
    kind: Literal["contribution", "aggregate"]

    @field_validator("key", "raw_label")
    @classmethod
    def require_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("energy term text must not be empty")
        return value

    @field_validator("value")
    @classmethod
    def require_finite_value(cls, value: float) -> float:
        if not np.isfinite(value):
            raise ValueError("energy term value must be finite")
        return value


class ParameterOccurrence(FrozenModel):
    key: str
    raw_key: str
    raw_value: str
    value: bool | int | float | str | tuple[float, ...]
    unit: str | None = None
    category: str | None = None
    description: str | None = None
    ordinal: int
    line_number: int | None = None


class CalculationDataset(FrozenModel):
    schema_version: Literal[2] = 2
    root: str
    source_files: tuple[SourceFile, ...]
    sites: tuple[Site, ...]
    ionic_steps: tuple[IonicStep, ...]
    parameters: tuple[ParameterOccurrence, ...] = ()
    capabilities: tuple[Capability, ...]
    warnings: tuple[ParserWarning, ...] = ()
    provenance: ParserProvenance | None = None
```

Add finite validation for every numeric scalar, tuple member, stress matrix member, and cell volume; require positive `cell_volume`, nonnegative ordinals, exact 3x3 tensor shape through `Mat3`, and nonempty keys/raw values.

- [ ] **Step 4: Run focused tests and public-model export checks**

Run: `python -m pytest tests/unit/test_models.py tests/unit/core/test_future_contracts.py -v`

Expected: PASS with schema 2 serialized aliases and immutable tuples.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/core/models.py src/vasp_analyzer/core/__init__.py tests/unit/test_models.py tests/unit/core/test_future_contracts.py
git commit -m "feat: define detailed OUTCAR dataset contracts"
```

### Task 2: Add declarative detail aliases and pure block parsers

**Files:**
- Modify: `src/vasp_analyzer/parsing/profiles/models.py`
- Modify: `src/vasp_analyzer/parsing/profiles/loader.py`
- Create: `src/vasp_analyzer/parsing/recovery/details.py`
- Modify: `src/vasp_analyzer/parsing/recovery/__init__.py`
- Modify: `tests/unit/parsing/profiles/test_loader.py`
- Create: `tests/unit/parsing/recovery/test_details.py`
- Modify: `tests/fixtures/profiles/home-example.toml`

**Interfaces:**
- Produces: `EnergyTermRule`, `DetailMarkers`, `parse_energy_line`, `parse_pressure_line`, `parse_stress_rows`, `parse_volume_line`, and `parse_parameter_assignments`.
- Consumes: Task 1 `EnergyTerm` and `ParameterOccurrence`.
- Keeps: profile `schema_version = 1`; new fields are optional backward-compatible declarative data and participate in the existing cache-key profile hash.

- [ ] **Step 1: Write failing profile-security and parser tests**

```python
def test_profile_accepts_bounded_declarative_energy_aliases(tmp_path: Path) -> None:
    path = tmp_path / "profile.toml"
    path.write_text("""
schema_version = 1
id = "home"
display_name = "Home"
[[outcar.energy_terms]]
key = "ewald"
labels = ["Ewald energy", "EWALD contribution"]
kind = "contribution"
""", encoding="utf-8")
    profile = load_profile(path)
    assert profile.outcar.energy_terms[0].key == "ewald"


@pytest.mark.parametrize("field", ["python", "command", "regex", "expression"])
def test_profile_rejects_executable_detail_rules(tmp_path: Path, field: str) -> None:
    path = tmp_path / f"bad-{field}.toml"
    path.write_text(
        "schema_version = 1\nid = 'x'\ndisplay_name = 'X'\n"
        f"[outcar.details]\n{field} = 'x'\n",
        encoding="utf-8",
    )
    with pytest.raises(ProfileValidationError):
        load_profile(path)


def test_energy_parser_preserves_unknown_finite_labels() -> None:
    rule = CompatibilityProfile(
        schema_version=1, id="standard", display_name="Standard"
    ).outcar
    parsed = parse_energy_line(b"  home correction = -1.2500 eV\n", rule)
    assert parsed == EnergyTerm(
        key="home_correction",
        raw_label="home correction",
        value=-1.25,
        unit="eV",
        kind="contribution",
    )
```

Add exact tests for Ewald, Hartree, XC, PAW double counting, `-TS`, eigenvalues, atomic energy, TOTEN, energy without entropy, sigma-to-zero, `D` exponents, pressure/Pulay values, volume, six-component and 3x3 stress layouts, repeated parameter assignments, boolean/integer/float/tuple/string coercion, and non-finite rejection.

- [ ] **Step 2: Run focused tests and confirm missing profile/detail APIs**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/recovery/test_details.py -v`

Expected: FAIL on missing `EnergyTermRule`, `DetailMarkers`, and detail-parser imports.

- [ ] **Step 3: Implement bounded profile rules and pure parsers**

```python
class EnergyTermRule(FrozenModel):
    key: str
    labels: tuple[str, ...]
    kind: Literal["contribution", "aggregate"]

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        if re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value) is None:
            raise ValueError("energy key must be a bounded snake-case identifier")
        return value


class DetailMarkers(FrozenModel):
    energy_section: tuple[str, ...] = ("FREE ENERGIE OF THE ION-ELECTRON SYSTEM",)
    stress_section: tuple[str, ...] = ("FORCE on cell =-STRESS",)
    external_pressure: tuple[str, ...] = ("external pressure",)
    cell_volume: tuple[str, ...] = ("volume of cell",)
    parameter_sections: tuple[str, ...] = ("INCAR:",)


class OutcarRule(FrozenModel):
    markers: MarkerAliases = MarkerAliases()
    details: DetailMarkers = DetailMarkers()
    energy_terms: tuple[EnergyTermRule, ...] = STANDARD_ENERGY_TERMS
```

In `details.py`, tokenize only recognized sections and exact assignment grammar. Normalize unknown keys with lowercase non-alphanumeric runs converted to `_`, preserve the raw label/value, and reject ambiguous duplicate alias labels case-insensitively during profile validation.

- [ ] **Step 4: Run focused tests and Ruff**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py tests/unit/parsing/recovery/test_details.py -v && python -m ruff check src/vasp_analyzer/parsing tests/unit/parsing`

Expected: PASS; invalid executable/ambiguous rules fail closed.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/parsing/profiles src/vasp_analyzer/parsing/recovery tests/unit/parsing tests/fixtures/profiles/home-example.toml
git commit -m "feat: parse declarative OUTCAR detail blocks"
```

### Task 3: Associate detailed blocks with recoverable ionic records

**Files:**
- Modify: `src/vasp_analyzer/parsing/recovery/scanner.py`
- Modify: `src/vasp_analyzer/parsing/recovery/checkpoint.py`
- Modify: `tests/unit/parsing/recovery/test_scanner.py`
- Create: `tests/unit/parsing/recovery/test_checkpoint.py`
- Create: `tests/fixtures/outcar/detail-complete-two-step.OUTCAR`
- Create: `tests/fixtures/outcar/detail-truncated-tail.OUTCAR`

**Interfaces:**
- Produces: `StepRecord.energy_terms`, `external_pressure_kb`, `pulay_stress_kb`, `stress_tensor_kb`, and `cell_volume`.
- Produces: `ScanResult.parameters: tuple[ParameterOccurrence, ...]`.
- Consumes: Task 2 pure parsers and profile rules.

- [ ] **Step 1: Write failing step-association, tail, and resume tests**

```python
def test_details_attach_to_the_force_record_that_precedes_them(tmp_path: Path) -> None:
    scan = scan_outcar(FIXTURES / "detail-complete-two-step.OUTCAR", HOME_BARRIER)
    assert [step.energy for step in scan.steps] == [-10.0, -11.0]
    assert [step.energy_terms[0].key for step in scan.steps] == ["ewald", "ewald"]
    assert scan.steps[0].external_pressure_kb == pytest.approx(5.0)
    assert scan.steps[1].cell_volume == pytest.approx(180.0)
    assert [item.raw_key for item in scan.parameters].count("ENCUT") == 2


def test_append_resume_replays_only_the_unverified_detailed_tail(tmp_path: Path) -> None:
    truncated = (FIXTURES / "detail-truncated-tail.OUTCAR").read_bytes()
    complete = (FIXTURES / "detail-complete-two-step.OUTCAR").read_bytes()
    assert complete.startswith(truncated)
    path = tmp_path / "OUTCAR"
    path.write_bytes(truncated)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(complete)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)
    assert second.resumed_from == first.checkpoint.last_verified_offset
    assert [step.step_id for step in second.steps] == [1]
    assert second.steps[0].stress_tensor_kb is not None
```

Also test that a complete malformed tensor fails, a physically truncated final tensor warns, and header parameters are not duplicated on resume.

- [ ] **Step 2: Run scanner/checkpoint tests and witness missing fields**

Run: `python -m pytest tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py -v`

Expected: FAIL because records and results do not carry detailed fields.

- [ ] **Step 3: Extend pending-record state without weakening boundaries**

```python
class StepRecord(FrozenModel):
    step_id: int
    block_start: int
    block_end: int
    atom_count: int
    lattice: Mat3
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    energy: float | None
    energy_terms: tuple[EnergyTerm, ...] = ()
    external_pressure_kb: float | None = None
    pulay_stress_kb: float | None = None
    stress_tensor_kb: Mat3 | None = None
    cell_volume: float | None = None
    scf_iterations: int | None = None
    electronic_converged: bool | None = None
    ionic_converged: bool | None = None


class ScanResult(FrozenModel):
    steps: tuple[StepRecord, ...]
    parameters: tuple[ParameterOccurrence, ...] = ()
    warnings: tuple[ParserWarning, ...]
    checkpoint: ParserCheckpoint
    resumed_from: int
    normally_finished: bool
    species: tuple[str, ...] = ()
    force_prefix_columns: int = 0
    position_force_markers: tuple[str, ...] = ("POSITION", "TOTAL-FORCE")
```

Parse detail blocks only while a pending record exists. Keep `last_verified_offset` at the prior stable boundary until the complete record is finalized. On resume, collect parameters only from bytes actually replayed; dataset assembly will retain existing header occurrences.

- [ ] **Step 4: Run scanner, checkpoint, and incomplete-tail suites**

Run: `python -m pytest tests/unit/parsing/recovery -v`

Expected: PASS with exact step IDs, one incomplete-tail warning, and no parameter duplication.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/parsing/recovery tests/unit/parsing/recovery tests/fixtures/outcar/detail-complete-two-step.OUTCAR tests/fixtures/outcar/detail-truncated-tail.OUTCAR
git commit -m "feat: recover detailed ionic records"
```

### Task 4: Reconcile schema 2 datasets, cache 3, and transport

**Files:**
- Modify: `src/vasp_analyzer/calculation/dataset.py`
- Modify: `src/vasp_analyzer/calculation/cache.py`
- Modify: `src/vasp_analyzer/calculation/session.py`
- Modify: `src/vasp_analyzer/transport/protocol.py`
- Modify: `tests/integration/test_dataset.py`
- Modify: `tests/integration/test_stdio.py`
- Modify: `tests/integration/test_web.py`
- Modify: `tests/unit/calculation/test_cache_security.py`
- Modify: `tests/unit/transport/test_protocol.py`

**Interfaces:**
- Produces: schema 2 camel-case JSON consumed by the Webview.
- Produces: application-cache schema 3 with existing-dataset parameter occurrence merge.
- Consumes: Task 1 models and Task 3 `StepRecord`/`ScanResult` fields.

- [ ] **Step 1: Write failing integration/cache/wire tests**

```python
def test_dataset_reconciles_detailed_scanner_values_by_step_id() -> None:
    dataset = load_dataset(FIXTURES / "outcar" / "detail-complete-two-step.OUTCAR")
    assert dataset.schema_version == 2
    assert dataset.ionic_steps[1].energy_terms[0].key == "ewald"
    assert dataset.ionic_steps[1].stress_tensor_kb is not None
    assert dataset.parameters[-1].key == "encut"


def test_cache_schema_3_uses_a_new_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    source = SourceFile(path="/calc", size=10, mtime_ns=20, fingerprint="abc")
    profile = CompatibilityProfile(schema_version=1, id="standard", display_name="Standard")
    monkeypatch.setattr(cache_module, "_CACHE_SCHEMA_VERSION", 2)
    legacy = cache_key(source, "standard", profile)
    monkeypatch.setattr(cache_module, "_CACHE_SCHEMA_VERSION", 3)
    current = cache_key(source, "standard", profile)
    assert current != legacy
```

Update protocol assertions to require `schemaVersion == 2`, raw labels, stress tensor aliases, and ordered parameters.

- [ ] **Step 2: Run focused integration tests and observe schema/cache failures**

Run: `python -m pytest tests/integration/test_dataset.py tests/integration/test_stdio.py tests/integration/test_web.py tests/unit/calculation/test_cache_security.py tests/unit/transport/test_protocol.py -v`

Expected: FAIL because dataset assembly drops scanner details and cache/protocol still expect schema 1/cache 2.

- [ ] **Step 3: Reconcile and version the full path**

```python
steps[step_id] = IonicStep(
    index=step_id,
    lattice=frame.lattice,
    fractional_positions=frame.fractional_positions,
    cartesian_positions=frame.cartesian_positions,
    raw_forces=frame.raw_forces,
    free_forces=metrics.free_forces,
    free_force_norms=metrics.free_force_norms,
    total_energy=frame.total_energy if frame.total_energy is not None else record.energy,
    energy_terms=record.energy_terms,
    external_pressure_kb=record.external_pressure_kb,
    pulay_stress_kb=record.pulay_stress_kb,
    stress_tensor_kb=record.stress_tensor_kb,
    cell_volume=record.cell_volume,
    delta_energy=None,
    scf_iterations=record.scf_iterations,
    electronic_converged=record.electronic_converged,
    ionic_converged=record.ionic_converged,
    strongest_free_component=metrics.strongest,
    rms_free_force=metrics.rms,
)
```

Set `_CACHE_SCHEMA_VERSION = 3`. Merge parameters as existing ordered occurrences followed by genuinely new occurrences, deduplicated only by complete immutable occurrence identity. Do not derive energy details from ASE strings.

- [ ] **Step 4: Run focused tests, complete non-corpus Python tests, and Ruff**

Run: `python -m pytest -m "not corpus" && python -m ruff check src tests`

Expected: PASS with only the existing platform-specific symlink skip.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/calculation src/vasp_analyzer/transport tests/integration tests/unit/calculation tests/unit/transport
git commit -m "feat: publish detailed calculation datasets"
```

### Task 5: Migrate Webview contracts and persisted module preferences

**Files:**
- Modify: `vscode/src/webview/core/contracts.ts`
- Modify: `vscode/src/webview/core/host.ts`
- Modify: `vscode/src/webview/core/store.ts`
- Modify: `vscode/src/webview/core/host.test.ts`
- Modify: `vscode/src/webview/core/runtimeHost.test.ts`
- Modify: `vscode/src/webview/core/store.test.ts`
- Modify: `vscode/src/webview/test/fixtures.ts`
- Modify: `vscode/src/test/analyzerProcess.test.ts`

**Interfaces:**
- Produces: strict schema 2 TypeScript contracts.
- Produces: `AnalysisModuleId`, `ConvergencePreferences`, persisted state version 3, and reducer actions `setModules`, `setModuleMetric`, and `setModuleMode`.
- Consumes: Task 4 schema 2 JSON aliases.

- [ ] **Step 1: Write failing deep-validation and migration tests**

```ts
it("migrates version 2 preferences to Energy-only convergence defaults", async () => {
  const host = new VsCodeHost({
    postMessage: vi.fn(),
    getState: () => ({
      version: 2,
      selectedStep: 1,
      selectedSite: 0,
      forceMode: "free",
      forceScale: 10,
      layout: DEFAULT_LAYOUT,
    }),
    setState: vi.fn(),
  }, window);
  expect(host.getState()).toEqual(expect.objectContaining({
    version: 3,
    convergence: {
      selectedModules: ["energy"],
      metrics: { energy: "totalEnergy", force: "strongestFreeComponent", cellStress: "externalPressure" },
      modes: { energy: "graph", force: "graph", cellStress: "graph" },
    },
  }));
});

it("rejects non-finite nested stress and malformed parameter occurrences", async () => {
  await expect(requestDataset(datasetWith({ stressTensorKb: [[1, 0, 0], [0, NaN, 0], [0, 0, 1]] })))
    .rejects.toThrow("invalid analyzer result");
});
```

Add reducer tests for empty/duplicate/unknown module lists, invalid metric/mode values, Energy-only defaults, state restoration, and session-only full-screen absence.

- [ ] **Step 2: Run focused tests and witness schema/state-version failures**

Run: `pnpm exec vitest run src/webview/core/host.test.ts src/webview/core/runtimeHost.test.ts src/webview/core/store.test.ts src/test/analyzerProcess.test.ts`

Expected: FAIL because schema 2 and state version 3 are not accepted.

- [ ] **Step 3: Add strict contracts and normalization**

```ts
export type AnalysisModuleId = "energy" | "force" | "cellStress";
export type ModuleMode = "graph" | "table";

export interface ConvergencePreferences {
  readonly selectedModules: readonly AnalysisModuleId[];
  readonly metrics: Readonly<{
    energy: "totalEnergy" | "deltaEnergy";
    force: "strongestFreeComponent" | "rmsFreeForce";
    cellStress: "externalPressure" | "cellVolume";
  }>;
  readonly modes: Readonly<Record<AnalysisModuleId, ModuleMode>>;
}

export interface PersistedAnalysisState {
  readonly version: 3;
  readonly selectedStep: number;
  readonly selectedSite: number | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly layout: LayoutPreferences;
  readonly convergence: ConvergencePreferences;
}
```

Normalize selected modules in canonical order, remove duplicates, reject unknown values, and replace an empty result with `['energy']`. Validate all nested dataset values with finite-number checks.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run src/webview/core/host.test.ts src/webview/core/runtimeHost.test.ts src/webview/core/store.test.ts src/test/analyzerProcess.test.ts && pnpm typecheck`

Expected: PASS with version 2 migration and strict schema 2 validation.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/core vscode/src/webview/test/fixtures.ts vscode/src/test/analyzerProcess.test.ts
git commit -m "feat: persist convergence module preferences"
```

### Task 6: Repair collapsed palette dragging and overlay contrast

**Files:**
- Modify: `vscode/src/webview/features/layout/DraggableCrystalPalette.tsx`
- Modify: `vscode/src/webview/features/layout/DraggableCrystalPalette.test.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.test.tsx`
- Modify: `vscode/src/webview/renderers/CrystalRenderer.ts`
- Modify: `vscode/src/webview/renderers/ThreeDmolRenderer.ts`
- Modify: `vscode/src/webview/renderers/ThreeDmolRenderer.test.ts`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Keeps: existing controlled `position`, `collapsed`, and viewport clamping contract.
- Produces: separate collapsed drag handle and expand button.
- Produces: renderer label classification or CSS hook that distinguishes atom overlays from a/b/c axes.

- [ ] **Step 1: Write failing interaction and contrast tests**

```tsx
it("drags the collapsed handle without expanding the palette", () => {
  const onPositionChange = vi.fn();
  const onCollapsedChange = vi.fn();
  render(<Harness
    initialCollapsed
    onPositionChange={onPositionChange}
    onCollapsedChange={onCollapsedChange}
  />);
  const handle = screen.getByTestId("collapsed-crystal-palette-handle");
  fireEvent.pointerDown(handle, { pointerId: 9, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(handle, { pointerId: 9, clientX: 50, clientY: 45 });
  expect(onPositionChange).toHaveBeenLastCalledWith({ x: 40, y: 35 });
  expect(onCollapsedChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Expand crystal tools" }));
  expect(onCollapsedChange).toHaveBeenCalledWith(false);
});
```

Extend the existing test `Harness` with `onCollapsedChange?: (collapsed: boolean) => void`. Its controlled callback must invoke the spy and then update local collapsed state, matching the existing position callback pattern.

Add tests that atom legend/selection/hover labels receive white-on-dark overlay styles while axis labels preserve renderer-supplied colors.

- [ ] **Step 2: Run focused tests and witness collapsed pointer failures**

Run: `pnpm exec vitest run src/webview/features/layout/DraggableCrystalPalette.test.tsx src/webview/features/structure/CrystalPanel.test.tsx src/webview/renderers/ThreeDmolRenderer.test.ts`

Expected: FAIL because the collapsed form is one button and atom overlay label styling is not classified.

- [ ] **Step 3: Share pointer lifecycle and separate the controls**

```tsx
if (collapsed)
  return (
    <div ref={setMeasuredElement} className="crystal-palette-toggle" style={{ left: position.x, top: position.y }}>
      <div
        data-testid="collapsed-crystal-palette-handle"
        className="crystal-palette-drag-handle"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span aria-hidden="true">⋮⋮</span><span>Crystal tools</span>
      </div>
      <button type="button" aria-label="Expand crystal tools" onClick={() => onCollapsedChange(false)}>Expand</button>
    </div>
  );
```

Use renderer label styles with `fontColor: 'white'` and a translucent dark background only for atom overlays. Do not change the axis-label color mapping.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run src/webview/features/layout/DraggableCrystalPalette.test.tsx src/webview/features/structure/CrystalPanel.test.tsx src/webview/renderers/ThreeDmolRenderer.test.ts && pnpm typecheck`

Expected: PASS including collapse/expand transition cleanup and viewport reclamping.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/layout vscode/src/webview/features/structure vscode/src/webview/renderers vscode/src/webview/styles.css
git commit -m "fix: improve crystal overlay interaction"
```

### Task 7: Build the multi-select convergence workspace

**Files:**
- Create: `vscode/src/webview/features/convergence/ConvergenceWorkspace.tsx`
- Create: `vscode/src/webview/features/convergence/ConvergenceWorkspace.test.tsx`
- Modify: `vscode/src/webview/features/convergence/ConvergencePanel.tsx`
- Modify: `vscode/src/webview/features/convergence/ConvergencePanel.test.tsx`
- Modify: `vscode/src/webview/features/convergence/IonicStepControl.tsx`
- Modify: `vscode/src/webview/features/convergence/IonicStepControl.test.tsx`
- Modify: `vscode/src/webview/features/convergence/SeriesChart.tsx`
- Modify: `vscode/src/webview/features/convergence/SeriesChart.test.tsx`
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/webview/App.test.tsx`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Produces: `ConvergenceWorkspace` controlled by Task 5 `ConvergencePreferences`.
- Consumes: existing `IonicStepControl` in both CompactToolbar and workspace.
- Produces: module slots keyed by `AnalysisModuleId`, with independent metric/mode callbacks.
- Extends: `IonicStepControlProps` with optional `labelPrefix?: string`; it prefixes only accessible labels, not visible copy.

- [ ] **Step 1: Write failing synchronization, persistence, and grid tests**

```tsx
it("starts Energy-only and synchronizes the workspace and toolbar step controls", async () => {
  render(<App host={new MemoryHost(twoStepDataset)} rendererFactory={rendererFactory} />);
  expect(screen.getByRole("button", { name: "Energy module" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Force module" })).toHaveAttribute("aria-pressed", "false");
  const workspaceStep = screen.getByRole("spinbutton", { name: "Convergence ionic step number" });
  await userEvent.clear(workspaceStep);
  await userEvent.type(workspaceStep, "2{Enter}");
  expect(screen.getByRole("spinbutton", { name: "Ionic step number" })).toHaveValue(2);
  expect(screen.getAllByText("2 / 2").length).toBeGreaterThanOrEqual(2);
});
```

Add tests for multi-select toggles, inability to deselect the final module, per-module mode/metric persistence, 1/2/3 module grid classes, narrow wrapping, and removal of the separate chart-point button list.

- [ ] **Step 2: Run workspace/App/SeriesChart tests and observe missing component/state wiring**

Run: `pnpm exec vitest run src/webview/features/convergence/ConvergenceWorkspace.test.tsx src/webview/features/convergence/ConvergencePanel.test.tsx src/webview/features/convergence/SeriesChart.test.tsx src/webview/App.test.tsx`

Expected: FAIL because the fixed two-chart panel and chart-point controls remain.

- [ ] **Step 3: Implement controlled module composition**

```tsx
export interface ConvergenceWorkspaceProps {
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly preferences: ConvergencePreferences;
  readonly onSelectStep: (index: number) => void;
  readonly onPreferencesChange: (next: ConvergencePreferences) => void;
  readonly onSelectSite: (siteIndex: number) => void;
}

const moduleOrder: readonly AnalysisModuleId[] = ["energy", "force", "cellStress"];

export function ConvergenceWorkspace(props: ConvergenceWorkspaceProps): ReactElement {
  const selected = moduleOrder.filter((id) => props.preferences.selectedModules.includes(id));
  const setSelected = (id: AnalysisModuleId, enabled: boolean): void => {
    const next = enabled
      ? moduleOrder.filter((candidate) => selected.includes(candidate) || candidate === id)
      : selected.filter((candidate) => candidate !== id);
    if (next.length) props.onPreferencesChange({ ...props.preferences, selectedModules: next });
  };
  return (
    <section className="convergence-workspace">
      <IonicStepControl
        total={props.dataset.ionicSteps.length}
        selectedIndex={props.selectedIndex}
        onSelect={props.onSelectStep}
        labelPrefix="Convergence "
      />
      <ModulePicker selected={selected} onChange={setSelected} />
      <div className="convergence-module-grid" data-count={selected.length}>
        {selected.map((id) => <ModuleSlot key={id} id={id} {...props} />)}
      </div>
    </section>
  );
}
```

Define private `ModulePicker` and `ModuleSlot` components in the same file. `ModulePicker` receives `selected` and `(id, enabled) => void`, and renders the three native pressed buttons. `ModuleSlot` switches exhaustively on `AnalysisModuleId`; until Task 8 it renders accessible module-name placeholders so Task 7 is independently testable.

Keep SVG marks selectable, but remove the redundant DOM list of one button per point. CSS uses `repeat(auto-fit, minmax(min(100%, 19rem), 1fr))` so modules wrap instead of overflowing.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run src/webview/features/convergence src/webview/App.test.tsx && pnpm typecheck`

Expected: PASS with Energy-only defaults and synchronized controls.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/convergence vscode/src/webview/App.tsx vscode/src/webview/App.test.tsx vscode/src/webview/styles.css
git commit -m "feat: add modular convergence workspace"
```

### Task 8: Add detailed Energy, Force, and Cell & Stress modules

**Files:**
- Create: `vscode/src/webview/features/convergence/detailRows.ts`
- Create: `vscode/src/webview/features/convergence/detailRows.test.ts`
- Create: `vscode/src/webview/features/convergence/EnergyModule.tsx`
- Create: `vscode/src/webview/features/convergence/EnergyModule.test.tsx`
- Create: `vscode/src/webview/features/convergence/ForceModule.tsx`
- Create: `vscode/src/webview/features/convergence/ForceModule.test.tsx`
- Create: `vscode/src/webview/features/convergence/CellStressModule.tsx`
- Create: `vscode/src/webview/features/convergence/CellStressModule.test.tsx`
- Modify: `vscode/src/webview/features/convergence/analysisSeries.ts`
- Modify: `vscode/src/webview/features/convergence/analysisSeries.test.ts`
- Modify: `vscode/src/webview/features/convergence/ConvergenceWorkspace.tsx`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Produces: pure `energyDetailRows(step)`, `forceDetailRows(dataset, step)`, and ranking helpers.
- Consumes: Task 5 contracts and Task 7 module slots.
- Emits: `onSelectSite(siteIndex)` from Force table rows.

- [ ] **Step 1: Write failing selector and component tests**

```ts
it("ranks the two greatest absolute non-aggregate energy contributions", () => {
  const source = twoStepDataset.ionicSteps[0]!;
  const rows = energyDetailRows({ ...source, energyTerms: [
    { key: "toten", rawLabel: "TOTEN", value: -500, unit: "eV", kind: "aggregate" },
    { key: "ewald", rawLabel: "Ewald", value: -120, unit: "eV", kind: "contribution" },
    { key: "xc", rawLabel: "XC", value: 40, unit: "eV", kind: "contribution" },
    { key: "entropy_ts", rawLabel: "-TS", value: -60, unit: "eV", kind: "contribution" },
  ] });
  expect(rows.map(({ key, rank }) => [key, rank])).toEqual([
    ["toten", null], ["ewald", 1], ["xc", null], ["entropy_ts", 2],
  ]);
});

it("ranks free force components and selects the atom row", async () => {
  const select = vi.fn();
  render(<ForceModule
    dataset={twoStepDataset}
    selectedIndex={0}
    metric="strongestFreeComponent"
    mode="table"
    onMetricChange={vi.fn()}
    onModeChange={vi.fn()}
    onSelectStep={vi.fn()}
    onSelectSite={select}
  />);
  await userEvent.click(screen.getByRole("row", { name: /O 17/ }));
  expect(select).toHaveBeenCalledWith(16);
  expect(screen.getByText("Rank 1")).toBeInTheDocument();
  expect(screen.getByText("Rank 2")).toBeInTheDocument();
});
```

Add tests for ties by source order, aggregates excluded, unknown constraints with no rank, complete position/raw/free/norm columns, metric-specific axes, null gaps, kB/GPa conversion, VASP sign label, stress matrix shape, and unavailable values.

- [ ] **Step 2: Run focused tests and witness missing modules/selectors**

Run: `pnpm exec vitest run src/webview/features/convergence/detailRows.test.ts src/webview/features/convergence/EnergyModule.test.tsx src/webview/features/convergence/ForceModule.test.tsx src/webview/features/convergence/CellStressModule.test.tsx`

Expected: FAIL because the files and module implementations do not exist.

- [ ] **Step 3: Implement pure deterministic rows and independent module views**

```ts
export interface RankedEnergyRow {
  readonly key: string;
  readonly rawLabel: string;
  readonly value: number;
  readonly unit: "eV";
  readonly kind: "contribution" | "aggregate";
  readonly rank: 1 | 2 | null;
}

export function rankTopTwo<T>(
  values: readonly T[],
  eligible: (value: T) => boolean,
  magnitude: (value: T) => number,
): ReadonlyMap<number, 1 | 2> {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => eligible(value))
    .sort((left, right) => magnitude(right.value) - magnitude(left.value) || left.index - right.index)
    .slice(0, 2);
  return new Map(ordered.map(({ index }, rank) => [index, (rank + 1) as 1 | 2]));
}
```

Each module renders one selected metric in Graph mode and the selected step's exact table in Table mode. Rank cells include visible `Rank 1`/`Rank 2` text and stable CSS classes. Force rows use one-based site labels but emit zero-based site indices.

- [ ] **Step 4: Run all convergence tests and typecheck**

Run: `pnpm exec vitest run src/webview/features/convergence src/webview/App.test.tsx && pnpm typecheck`

Expected: PASS with independent module modes/metrics and exact table content.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/convergence vscode/src/webview/styles.css
git commit -m "feat: show detailed convergence tables"
```

### Task 9: Add Parameters analysis and selected-step structure status

**Files:**
- Create: `vscode/src/webview/features/parameters/ParametersPanel.tsx`
- Create: `vscode/src/webview/features/parameters/ParametersPanel.test.tsx`
- Create: `vscode/src/webview/features/analysis/AnalysisTabs.tsx`
- Create: `vscode/src/webview/features/analysis/AnalysisTabs.test.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.test.tsx`
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/webview/App.test.tsx`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Produces: local `AnalysisTabId = "convergence" | "parameters"` selection; this tab choice is not persisted.
- Consumes: `CalculationDataset.parameters` and selected-step pressure/volume fields.
- Keeps: future DOS/Band/Charge capability buttons disabled with their existing reasons.

- [ ] **Step 1: Write failing interpreted/raw/search and structure-overlay tests**

```tsx
it("shows the last occurrence as effective while raw mode preserves every occurrence", async () => {
  const repeatedEncuts: readonly ParameterOccurrence[] = [
    { key: "encut", rawKey: "ENCUT", rawValue: "400", value: 400, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 0, lineNumber: 12 },
    { key: "encut", rawKey: "ENCUT", rawValue: "520", value: 520, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 1, lineNumber: 18 },
  ];
  render(<ParametersPanel parameters={repeatedEncuts} />);
  expect(screen.getByRole("cell", { name: "520" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Raw parameters" }));
  expect(screen.getAllByRole("row", { name: /ENCUT/ })).toHaveLength(2);
});

it("omits the structure status when pressure volume and Pulay stress are unavailable", () => {
  const { props, view } = setup();
  expect(screen.queryByRole("status", { name: "Cell and stress status" })).not.toBeInTheDocument();
  view.rerender(<CrystalPanel
    {...props}
    selectedStep={{ ...props.selectedStep, externalPressureKb: -2.5 }}
  />);
  expect(screen.getByRole("status", { name: "Cell and stress status" })).toHaveTextContent("-2.5 kB");
});
```

Add tests for category grouping, unknown raw tags, search across key/value/description/category, interpreted filters, typed tuple formatting, analysis-tab keyboard/ARIA behavior, and selected-step overlay updates.

- [ ] **Step 2: Run focused tests and observe missing panels/tabs**

Run: `pnpm exec vitest run src/webview/features/parameters/ParametersPanel.test.tsx src/webview/features/analysis/AnalysisTabs.test.tsx src/webview/features/structure/CrystalPanel.test.tsx src/webview/App.test.tsx`

Expected: FAIL because Parameters and status components do not exist.

- [ ] **Step 3: Implement local analysis tabs and lossless parameter views**

```tsx
export function effectiveParameters(
  occurrences: readonly ParameterOccurrence[],
): readonly ParameterOccurrence[] {
  const latest = new Map<string, ParameterOccurrence>();
  for (const occurrence of occurrences) latest.set(occurrence.key, occurrence);
  return [...latest.values()].sort((left, right) =>
    (left.category ?? "other").localeCompare(right.category ?? "other")
      || left.key.localeCompare(right.key),
  );
}
```

Use native tab roles with a local active-tab state in `AnalysisTabs`. Parameters search/filter is presentation-only local state. Render raw occurrences in ordinal order. Add selected-step status only when at least one of pressure, Pulay stress, or volume is non-null.

- [ ] **Step 4: Run focused tests, complete Webview tests, and typecheck**

Run: `pnpm test && pnpm typecheck`

Expected: all Webview/extension tests PASS.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/parameters vscode/src/webview/features/analysis vscode/src/webview/features/structure vscode/src/webview/App.tsx vscode/src/webview/App.test.tsx vscode/src/webview/styles.css
git commit -m "feat: inspect effective OUTCAR parameters"
```

### Task 10: Validate the real corpus, package, document, and update the draft PR

**Files:**
- Modify: `README.md`
- Modify: `vscode/README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/vasp_analyzer/cli/corpus.py`
- Modify: `tests/corpus/test_local_outcars.py`
- Modify: `docs/superpowers/specs/2026-07-21-detailed-convergence-and-outcar-metadata-design.md` only if implementation reveals a factual correction; do not weaken approved requirements.

**Interfaces:**
- Consumes: Tasks 1-9 complete behavior.
- Produces: fresh wheel, sdist, VSIX, CI evidence, corpus evidence, and a live Remote SSH checklist.

- [ ] **Step 1: Add failing release/corpus assertions for new schema and bounded parsing**

```python
@pytest.mark.corpus
def test_configured_corpus_detailed_metadata_is_finite_and_bounded() -> None:
    report = validate_corpus_details(corpus_root_or_skip())
    assert report.files_seen > 0
    assert report.non_finite_energy_terms == 0
    assert report.invalid_stress_shapes == 0
    assert report.parameter_occurrences >= report.files_with_parameters
```

Add this immutable aggregate beside the existing `CorpusReport` in `src/vasp_analyzer/cli/corpus.py`:

```python
class CorpusDetailReport(FrozenModel):
    files_seen: int
    files_with_energy_terms: int
    files_with_stress: int
    files_with_parameters: int
    energy_terms: int
    parameter_occurrences: int
    non_finite_energy_terms: int
    invalid_stress_shapes: int


def validate_corpus_details(root: Path) -> CorpusDetailReport:
    outcars = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.name.casefold() == "outcar"
    )
    datasets = (CalculationSession(path).load() for path in outcars)
    return summarize_detail_datasets(datasets)


def summarize_detail_datasets(
    datasets: Iterable[CalculationDataset],
) -> CorpusDetailReport:
    files_seen = files_with_energy_terms = files_with_stress = 0
    files_with_parameters = energy_terms = parameter_occurrences = 0
    non_finite_energy_terms = invalid_stress_shapes = 0
    for dataset in datasets:
        files_seen += 1
        terms = tuple(term for step in dataset.ionic_steps for term in step.energy_terms)
        tensors = tuple(
            step.stress_tensor_kb
            for step in dataset.ionic_steps
            if step.stress_tensor_kb is not None
        )
        files_with_energy_terms += bool(terms)
        files_with_stress += bool(tensors)
        files_with_parameters += bool(dataset.parameters)
        energy_terms += len(terms)
        parameter_occurrences += len(dataset.parameters)
        non_finite_energy_terms += sum(not math.isfinite(term.value) for term in terms)
        invalid_stress_shapes += sum(
            len(tensor) != 3 or any(len(row) != 3 for row in tensor)
            for tensor in tensors
        )
    return CorpusDetailReport(
        files_seen=files_seen,
        files_with_energy_terms=files_with_energy_terms,
        files_with_stress=files_with_stress,
        files_with_parameters=files_with_parameters,
        energy_terms=energy_terms,
        parameter_occurrences=parameter_occurrences,
        non_finite_energy_terms=non_finite_energy_terms,
        invalid_stress_shapes=invalid_stress_shapes,
    )
```

`summarize_detail_datasets` consumes an iterable once and accumulates only integer counters; it retains neither datasets nor source paths. Unit-test the exact counters with two in-memory datasets before the corpus gate.

CI package inspection must assert schema 2 fixtures/contracts, `dist/extension.cjs`, bundled Webview assets, and no application runtime network URLs. Corpus reporting prints only aggregate counts and relative identifiers, never the private root.

- [ ] **Step 2: Run release-focused tests and witness missing detail report/docs**

Run: `python -m pytest tests/corpus/test_local_outcars.py -m corpus --collect-only && rg -n "Energy|Cell & Stress|Parameters|schema 2" README.md vscode/README.md`

Expected: collection succeeds but the new corpus test/helper or required documentation terms are absent.

- [ ] **Step 3: Document the workflow and add CI/package gates**

Document:

```text
Convergence starts with Energy only. Select Energy, Force, and Cell & Stress in any combination; each module independently switches between Graph and Table. Both the structure toolbar and convergence workspace control the same ionic step. Parameters reports effective values echoed by OUTCAR and does not claim which values were explicitly present in INCAR.
```

Keep browser behavior explicit (`analyzer OUTCAR --web`) and Remote VS Code handoff as the default. Add only deterministic CI gates; keep the private corpus opt-in.

- [ ] **Step 4: Run the complete final verification sequence**

Run from the repository root:

```bash
python -m pytest -m "not corpus"
python -m ruff check src tests
python -m build
```

Run from `vscode/`:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm exec vsce package --no-dependencies
node scripts/verify-vsix-entrypoint.mjs vasp-analyzer-0.1.0.vsix
```

Run the two long corpus gates separately with a 15-minute timeout each:

```bash
python -m pytest -m corpus tests/corpus/test_local_outcars.py::test_actual_home_barrier_corpus -v
python -m pytest -m corpus tests/corpus/test_local_outcars.py::test_largest_file_cache_reuse_and_bounded_append_resume -v
```

Expected: every command exits 0; the aggregate remains scientifically consistent with the current configured corpus snapshot; the largest-file gate observes an application-cache hit and bounded append resume.

- [ ] **Step 5: Perform manual Remote SSH acceptance**

```bash
python -m pip install --user --force-reinstall ./vasp_analyzer-0.1.0-py3-none-any.whl
code --install-extension ./vasp-analyzer-0.1.0.vsix --force
command -v analyzer
analyzer OUTCAR
```

Reload the Remote Extension Host before opening a new terminal. Verify lowercase/mixed-case OUTCAR opening, collapsed palette drag, overlay contrast, both step controls, 1/2/3-module wrapping, all Graph/Table modes, atom-row selection, pressure/stress values, Parameters interpreted/raw views, WebGL fallback, and no implicit browser launch. Record unavailable GPU conditions rather than claiming them as passed.

- [ ] **Step 6: Commit documentation and deterministic gates**

```bash
git add README.md vscode/README.md .github/workflows/ci.yml src/vasp_analyzer/cli/corpus.py tests/corpus/test_local_outcars.py docs/superpowers/specs/2026-07-21-detailed-convergence-and-outcar-metadata-design.md
git commit -m "docs: validate detailed OUTCAR analysis"
```

- [ ] **Step 7: Request final whole-branch review and publish**

Generate a review package from `dcd8ebc` to final HEAD. Fix every Critical or Important finding with a witnessed RED/GREEN test and re-review. After fresh verification, push `agent/vasp-analyzer-v1`, update public PR #1 with exact test/corpus results, and keep it draft until the live Remote SSH checklist is complete.
