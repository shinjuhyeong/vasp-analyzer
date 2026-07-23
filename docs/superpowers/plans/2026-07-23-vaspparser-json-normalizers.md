# VaspParser JSON Normalizers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vaspparser` authoritative for OUTCAR data and normalize home-VASP syntax through safe built-in and user JSON definitions.

**Architecture:** A strict package-resource JSON schema and XDG registry select one declarative normalizer. A line-preserving transformation session writes a private virtual OUTCAR and manifest, then a narrow `vaspparser` adapter validates and converts arrays into analyzer contracts. Calculation sessions retain the last successful immutable dataset for incomplete growing files; transport exposes provenance and reports without leaking parser-library objects.

**Tech Stack:** Python 3.11+, Pydantic 2, NumPy, vaspparser 0.0.7, Typer, pytest, React/TypeScript, VS Code Webview.

## Global Constraints

- `vaspparser==0.0.7` is the authoritative OUTCAR parser; the old scanner is never an automatic fallback.
- Built-ins load from package resources and user definitions from `$XDG_CONFIG_HOME/vasp-analyzer/normalizers` or `~/.config/vasp-analyzer/normalizers`.
- Duplicate IDs, invalid definitions, and equal highest-priority matches fail closed.
- Schema version 1 permits only typed whitespace-column projection inside bounded blocks; no executable code, arbitrary regex replacement, or line deletion.
- Source files remain read-only and source SHA-256 must be unchanged after every success and failure path.
- Specialized output preserves line count and line numbers exactly.
- Full supplied OUTCARs remain local and uncommitted.

---

## File Structure

- `src/vasp_analyzer/normalizers/`: package resources, Pydantic schema, registry, transformer, manifest, errors.
- `src/vasp_analyzer/parsing/adapters/vaspparser_outcar.py`: third-party adapter only.
- `src/vasp_analyzer/calculation/`: normalized parse orchestration and last-successful snapshots.
- `src/vasp_analyzer/cli/normalizer.py`: list/validate/test commands.
- `src/vasp_analyzer/transport/`: provenance/report wire models.
- `vscode/src/webview/features/`: concise warning and report UI.

### Task 1: Dependency and Strict JSON Models

**Files:**
- Modify: `pyproject.toml`
- Create: `src/vasp_analyzer/normalizers/{__init__,models,errors}.py`
- Create: `src/vasp_analyzer/normalizers/definitions/schema.json`
- Test: `tests/unit/normalizers/test_models.py`

**Interfaces:**
- Produces: `NormalizerDefinition`, `DetectionSpec`, `ProjectionRule`, `ColumnSpec`, `NormalizerDefinitionError`.

- [ ] **Step 1: Write failing model tests**

Test exact schema-1 acceptance plus rejection of unknown keys, unknown field types, duplicate names, invalid emit references, regex-like operations, non-ASCII detection literals, and unsafe suffixes:

```python
definition = NormalizerDefinition.model_validate(HOME_DEFINITION)
assert definition.rules[0].output.emit == ("x", "y", "z", "fx", "fy", "fz")
with pytest.raises(ValidationError):
    NormalizerDefinition.model_validate({**HOME_DEFINITION, "execute": "python x.py"})
```

- [ ] **Step 2: Verify RED**

Run `python -m pytest tests/unit/normalizers/test_models.py -q`.

Expected: import failure because the package does not exist.

- [ ] **Step 3: Implement frozen strict models and schema resource**

Use `extra="forbid"`, `schema_version: Literal[1]`, bounded snake-case IDs, priority `-10000..10000`, tuple fields, unique column names, typed column-specific validation, and emit-reference validation. Export a generated JSON Schema whose checked-in resource is compared to `NormalizerDefinition.model_json_schema()` in tests.

- [ ] **Step 4: Pin dependency and package resources**

Add `vaspparser==0.0.7`. Ensure Hatch includes `normalizers/definitions/*.json` in wheel and sdist contracts.

- [ ] **Step 5: Verify and commit**

Run model tests, `python -m ruff check src tests`, and `python -m build --wheel`. Commit with `feat: define JSON normalizer schema`.

### Task 2: Built-In and XDG Registry

**Files:**
- Create: `src/vasp_analyzer/normalizers/registry.py`
- Create: `src/vasp_analyzer/normalizers/definitions/{standard,home_barrier}.json`
- Test: `tests/unit/normalizers/test_registry.py`

**Interfaces:**
- Produces: `NormalizerSource(path, built_in)`, `NormalizerMatch`, `load_registry(environ, home)`, `select_normalizer(prefix, registry)`.

- [ ] **Step 1: Write failing discovery/selection tests**

Cover package resources, XDG override path, home fallback, duplicate IDs, malformed user JSON, deterministic priority selection, equal-priority ambiguity, `all/any/none`, the 1 MiB prefix bound, and standard fallback.

- [ ] **Step 2: Verify RED**

Run `python -m pytest tests/unit/normalizers/test_registry.py -q`; expect missing API failures.

- [ ] **Step 3: Implement deterministic registry**

Use `importlib.resources.files("vasp_analyzer.normalizers.definitions")` for built-ins and sorted `*.json` paths for users. Parse UTF-8 strictly. Reject all invalid discovered definitions rather than skipping them. Hash canonical model JSON for identity.

- [ ] **Step 4: Add exact built-ins**

`standard.json` has priority 0 and no transformation rules. `home_barrier.json` detects `vasp.5.4.1-barrier`, priority 100, and declares the verified named position/force projection with `allowedSuffixes: ["_"]`.

- [ ] **Step 5: Verify and commit**

Run registry/model tests and Ruff. Commit with `feat: discover JSON normalizers`.

### Task 3: Line-Preserving Transformation and Manifest

**Files:**
- Create: `src/vasp_analyzer/normalizers/{fields,transform,manifest}.py`
- Test: `tests/unit/normalizers/test_transform.py`
- Create: `tests/fixtures/normalizers/{home-small.OUTCAR,partial-home.OUTCAR}`

**Interfaces:**
- Produces: `normalize_outcar(source, match) -> NormalizedOutcarSession`; the session exposes `parser_path`, `manifest`, and context-manager cleanup.

- [ ] **Step 1: Write failing field and block tests**

Cover `elementLabel`, configured suffixes, positive integer, `E/D` finite floats, literal fields, text omission, exact atom-count rows, partial block, extra/missing token, nonfinite values, line-count equality, source hash equality, cleanup, and failure cleanup.

- [ ] **Step 2: Verify RED**

Run `python -m pytest tests/unit/normalizers/test_transform.py -q`; expect missing API failures.

- [ ] **Step 3: Implement typed projection**

Resolve atom count from validated `NIONS = <positive-int>` metadata before any scoped block. Enter only after the declared marker and dashed separator. Parse exactly `atomCount` rows; stage the whole block before emitting so partial matches cannot produce a partial file. Preserve original newline style per row.

- [ ] **Step 4: Implement secure session lifetime**

Create a private `tempfile.TemporaryDirectory`, never in the calculation directory. Compute source SHA-256 before and after. Standard definitions return the source path without copying. Specialized sessions write `OUTCAR`, retain source-to-virtual line identity, and clean on context exit and exceptions.

- [ ] **Step 5: Implement bounded manifest**

Record full line-level excerpts for changed rows in cache representation but emit only counts/first/last in normal transport. Bound each excerpt to 512 characters and reject non-UTF-8 source rows with mapped line errors.

- [ ] **Step 6: Verify and commit**

Run normalizer suites, Ruff, and `git diff --check`. Commit with `feat: normalize OUTCAR projections`.

### Task 4: VaspParser Adapter

**Files:**
- Create: `src/vasp_analyzer/parsing/adapters/vaspparser_outcar.py`
- Modify: `src/vasp_analyzer/parsing/adapters/__init__.py`
- Test: `tests/unit/parsing/adapters/test_vaspparser_outcar.py`

**Interfaces:**
- Produces: `parse_vaspparser_outcar(path, sites, provenance) -> ParsedTrajectory` using analyzer-owned models only.

- [ ] **Step 1: Write failing adapter-contract tests**

Use small official fixtures and injected parse dictionaries to cover exact array conversion, `D` values already converted by vaspparser, optional quantities, nonfinite values, shape mismatch, step-count mismatch, atom-count mismatch, and no third-party object leakage.

- [ ] **Step 2: Verify RED**

Run the focused adapter test; expect missing module failure.

- [ ] **Step 3: Implement the narrow import boundary**

Instantiate `Outcar`, call `from_file`, immediately copy `parse_dict` values into tuples/primitive models, and discard the parser. Map `energies`, `energy_components`, `positions`, `forces`, `cells`, `stresses`, `pressures`, `scf_energies`, and Fermi data. Derive contiguous zero-based analyzer step indices.

- [ ] **Step 4: Validate contracts before construction**

Use exact shape assertions and `numpy.isfinite`; absent optional arrays map to `None`, but present arrays with wrong shapes fail. Verify all available step axes agree.

- [ ] **Step 5: Verify and commit**

Run adapter tests, all parsing tests, and Ruff. Commit with `feat: adapt vaspparser OUTCAR data`.

### Task 5: Dataset Orchestration and Growing Files

**Files:**
- Modify: `src/vasp_analyzer/calculation/dataset.py`
- Modify: `src/vasp_analyzer/calculation/session.py`
- Modify: `src/vasp_analyzer/calculation/cache.py`
- Modify: `src/vasp_analyzer/core/models.py`
- Test: `tests/unit/calculation/test_vaspparser_dataset.py`
- Test: `tests/unit/calculation/test_session.py`

**Interfaces:**
- Consumes: registry, normalization session, vaspparser adapter, POSCAR/CONTCAR parser.
- Produces: dataset provenance containing parser/normalizer summaries and last-successful refresh behavior.

- [ ] **Step 1: Write failing assembly tests**

Cover normalizer selection, standard no-copy path, home virtual path, selective-dynamics reconciliation, provenance hash, cache-key definition hash, parser failure without fallback, last-successful dataset retention after source change, no retry for unchanged failed fingerprint, and recovery after another change.

- [ ] **Step 2: Verify RED**

Run focused calculation tests; expect old ASE/scanner path assertions to fail.

- [ ] **Step 3: Switch the authoritative pipeline**

Assemble inside `with normalize_outcar(...) as normalized:` and pass only `normalized.parser_path` to the adapter. Reconcile atom count/order with POSCAR/CONTCAR. Remove ASE/scanner trajectory selection from the normal dataset path; retain it behind an explicit diagnostic-only module used by no application call site.

- [ ] **Step 4: Add provenance models**

Extend schema with parser name/version, normalizer ID/display/schema/hash, changed-line count, manifest reference, and warnings. Advance dataset/cache schema versions and fail old caches closed.

- [ ] **Step 5: Implement refresh retention**

Store last successful immutable dataset and its fingerprint. On a changed file parse failure, return the previous dataset plus an in-progress warning; on unchanged failed fingerprint return the same result without re-parsing. With no successful dataset, propagate the error.

- [ ] **Step 6: Verify and commit**

Run calculation, cache-security, parsing, and full Python tests plus Ruff. Commit with `feat: parse calculations with vaspparser`.

### Task 6: Normalizer CLI and README

**Files:**
- Create: `src/vasp_analyzer/cli/normalizer.py`
- Modify: `src/vasp_analyzer/cli/app.py`
- Modify: `README.md`
- Test: `tests/unit/cli/test_normalizer_commands.py`

**Interfaces:**
- Produces: `analyzer normalizer list`, `validate PATH`, and `test PATH OUTCAR`.

- [ ] **Step 1: Write failing CLI tests**

Assert deterministic JSON, built-in/user source paths, schema failures with exit 2, conflict detection, exact home 35/25 summary when local corpus is available, source hash equality, and temporary cleanup.

- [ ] **Step 2: Verify RED**

Run the focused CLI suite; expect unknown `normalizer` command.

- [ ] **Step 3: Implement commands**

`list` loads the active registry; `validate` validates the supplied definition plus conflicts against the active registry; `test` adds only the supplied definition to an isolated registry, normalizes, runs the real adapter, validates invariants, and prints summary/manifest JSON.

- [ ] **Step 4: Document the complete user workflow**

README must contain paths, schema table, every field type/property, detection/priority rules, full home JSON, CLI examples, warnings/errors, source-safety statement, and a copy-paste custom-normalizer development flow.

- [ ] **Step 5: Verify and commit**

Run CLI tests, `analyzer normalizer --help`, README command smoke tests, and Ruff. Commit with `feat: document user OUTCAR normalizers`.

### Task 7: Transport, Warning, Report, and Diff UI

**Files:**
- Modify: `src/vasp_analyzer/transport/protocol.py`
- Modify: `src/vasp_analyzer/transport/stdio.py`
- Modify: `vscode/src/webview/core/contracts.ts`
- Modify: `vscode/src/webview/core/host.ts`
- Create: `vscode/src/webview/features/normalization/NormalizationStatus.tsx`
- Create: `vscode/src/webview/features/normalization/NormalizationReport.tsx`
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/extension.ts`
- Test: matching Python transport, host, component, and extension tests.

**Interfaces:**
- Produces: concise normalization summary in dataset transport; on-demand manifest request; extension commands to open normalized read-only content and VS Code diff.

- [ ] **Step 1: Write failing wire/UI/extension tests**

Assert parser/normalizer/status text, visible nonstandard warning, summary counts, lazy manifest fetch, bounded excerpts, read-only normalized document, original-to-normalized diff, missing/expired session error, and no normalized content embedded in the base dataset.

- [ ] **Step 2: Verify RED in Python and Webview suites**

Run focused tests; expect missing schema fields/components/commands.

- [ ] **Step 3: Add versioned transport operations**

Advance wire schema. Add `getNormalizationManifest` and `getNormalizedOutcar` session-scoped operations. Validate session ownership and source fingerprint before returning data.

- [ ] **Step 4: Add concise viewer status/report**

Render parser version, normalizer display name, changed-line count, and warning. Fetch line details only when report opens. Keep excerpts text-only and escaped by React.

- [ ] **Step 5: Add VS Code virtual-document and diff commands**

Use a `TextDocumentContentProvider` with a session-bound URI; never write beside OUTCAR. Open normalized content read-only and invoke `vscode.diff` with original and virtual URIs. Release the normalization session only after dependent documents close.

- [ ] **Step 6: Verify and commit**

Run focused Python/extension/Webview tests, full Webview tests, typecheck, and build. Commit with `feat: show OUTCAR normalization reports`.

### Task 8: Real-File and Installed-Artifact Acceptance

**Files:**
- Modify: `scripts/audit_outcar.py`
- Modify: `scripts/verify_installed_wheel.py`
- Modify: `scripts/verify_release_artifacts.py`
- Test: `tests/unit/test_audit_outcar.py`
- Test: `tests/unit/test_installed_wheel_smoke.py`

**Interfaces:**
- Produces: reproducible real-file evidence and release artifacts.

- [ ] **Step 1: Write failing acceptance assertions**

Require official 200 steps and home 35 steps/25 atoms through the production vaspparser path; assert exact shapes, all finite values, source hashes unchanged, home changed lines 875, selected normalizer IDs, and no old-parser fallback.

- [ ] **Step 2: Verify RED against the pre-migration audit**

Run focused audit tests; expect missing parser/normalizer fields.

- [ ] **Step 3: Update audit and installed-wheel verification**

Audit deterministic JSON must report parser, normalizer, manifest summary, shapes, and source hash. The installed-wheel verifier must launch the installed `analyzer` console from a temporary working directory with no checkout import path.

- [ ] **Step 4: Run complete gates**

```text
python -m pytest -q
python -m ruff check src tests scripts
python scripts/audit_outcar.py <home>
python scripts/audit_outcar.py <official>
pnpm --dir vscode test
pnpm --dir vscode typecheck
pnpm --dir vscode build
python -m build
pnpm --dir vscode package
```

Expected: all gates exit 0; real summaries exactly match the acceptance counts and hashes remain unchanged.

- [ ] **Step 5: Verify exact installed artifacts and commit**

Install the exact wheel in a fresh temporary environment, parse both real files through its installed console, verify the VSIX entrypoint, record SHA-256 hashes, and ensure real OUTCARs/generated artifacts are untracked. Commit tracked audit changes with `test: audit vaspparser normalizers`.
