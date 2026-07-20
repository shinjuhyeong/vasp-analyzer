# Standalone VASP Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline VASP analyzer that parses standard and home-barrier calculations, recovers complete data from running OUTCAR files, and presents synchronized crystal and convergence views in a VS Code Remote SSH Webview with a browser fallback.

**Architecture:** Immutable contracts live in `core/`; calculation discovery, assembly, sessions, and caches live in `calculation/`; parser integrations are isolated in `parsing/adapters/`, syntax compatibility in `parsing/dialects/` and `parsing/profiles/`, and interrupted-file state in `parsing/recovery/`. ASE 3.29+ streams OUTCAR trajectories, pymatgen parses normalized POSCAR/CONTCAR and later electronic/volumetric formats, while `structure/`, `convergence/`, `transport/`, and `cli/` consume only analyzer-owned contracts.

**Tech Stack:** Python 3.11+, ASE 3.29+, pymatgen 2026.5.4+, Pydantic 2.13+, NumPy 2.2+, Typer, FastAPI/Uvicorn, pytest, Ruff; TypeScript, VS Code Extension API, React, Vitest, 3Dmol.js, uPlot, pnpm.

## Global Constraints

- Preserve the behavior already committed in `abadf13` and `4b358e7`, but migrate their flat modules into the approved feature packages in Task 1.
- Do not preserve the uncommitted old Task 3 parser artifacts; replace `src/vasp_analyzer/parsers/` with the planned `src/vasp_analyzer/parsing/` paths and recreate only synthetic fixtures.
- Runtime must work offline. Bundle all JavaScript, CSS, renderer, and chart assets; no CDN or runtime Node.js dependency.
- Primary Remote SSH operation uses VS Code message passing and newline-delimited JSON over stdio, never HTTP or port forwarding.
- Accept `analyzer`, `analyzer OUTCAR`, `analyzer <directory>`, explicit profiles, dialect validation, and corpus validation.
- Use pymatgen only after dialect/profile normalization for POSCAR and CONTCAR. No pymatgen or ASE object may cross an adapter boundary.
- Use ASE 3.29+ for OUTCAR trajectory lattice, positions, energy, and forces; use a narrow streaming scanner for convergence markers, complete-block validation, byte offsets, and interrupted tails.
- `home_barrier` is a tested built-in dialect selected by deterministic scored literal markers including `vasp.5.4.1-barrier`.
- User compatibility profiles are schema-versioned declarative TOML. They cannot import code, execute Python, execute shell commands, or declare unrestricted transformations.
- Do not add a general third-party application plugin API; dialect profiles are data-only parser compatibility inputs.
- Accept exactly a standalone integer metadata line between `Selective dynamics` and `Direct`/`Cartesian`; preserve it as provenance and reject unrelated lines with line number and content.
- A complete position/force block must pass atom-count, six-column, finite-number, and lattice validation. Never fill a partial step from a previous step.
- A structure with no following energy remains available with `total_energy=None`; an incomplete physical tail emits a nonfatal `IncompleteTail` warning.
- Incremental caches store source path, size, mtime, fingerprint, last verified byte offset, and parser state. Replacement or truncation forces a clean reparse.
- Treat `T` as movable and `F` as fixed. If masks are unavailable, preserve `None` and do not claim constraint-aware metrics.
- `CalculationDataset.source_files` and every public domain object are immutable.
- Preserve stable `site_index` across steps and future DOS, band, and charge features; supercell images add an image vector without creating new sites.
- Keep root VASP outputs, the 2,288,020,784-byte corpus, aggregate reports, cache data, absolute local paths, `__pycache__/`, and `.pytest_cache/` out of Git.
- Corpus tests run only with `VASP_ANALYZER_CORPUS_DIR` or `analyzer corpus validate PATH`; ordinary `pytest` uses small reviewed synthetic fixtures.
- The first release implements structure and convergence. DOS/band/volumetric seams are contracts only and must not create empty `electronic/` or `volumetric/` packages.
- Use TDD for every behavior change: add one focused failing test, observe the expected failure, implement minimally, rerun focused tests, then run the task suite and Ruff before committing.

## Primary References

- ASE VASP OUT reader: <https://wiki.fysik.dtu.dk/ase/ase/io/formatoptions.html#vasp-out>
- ASE 3.29.0 package metadata: <https://pypi.org/project/ase/>
- pymatgen VASP I/O: <https://pymatgen.org/pymatgen.io.vasp.html>
- VS Code Webview API: <https://code.visualstudio.com/api/extension-guides/webview>
- VS Code remote extensions: <https://code.visualstudio.com/api/advanced-topics/remote-extensions>
- 3Dmol.js GLViewer API: <https://3dmol.org/doc/GLViewer.html>

## Planned File Map

```text
src/vasp_analyzer/
|- core/{models,errors,config}.py
|- calculation/{discovery,dataset,cache,session}.py
|- parsing/
|  |- adapters/{poscar_pymatgen,outcar_ase}.py
|  |- dialects/{base,standard,home_barrier,registry}.py
|  |- profiles/{models,loader,normalizer}.py
|  `- recovery/{scanner,checkpoint}.py
|- structure/{constraints,bonds,supercell}.py
|- convergence/{forces,electronic}.py
|- transport/{protocol,stdio,web,handoff}.py
`- cli/{app,corpus}.py
```

Tests mirror these packages under `tests/unit/`, `tests/integration/`, and `tests/corpus/`. The VS Code extension remains under `vscode/src/`; the React Webview remains under `vscode/webview/src/` with renderer and chart adapters.

---

### Task 1: Migrate and Harden the Committed Core and Discovery Baseline

**Files:**
- Create: `src/vasp_analyzer/core/__init__.py`
- Create: `src/vasp_analyzer/core/models.py`
- Create: `src/vasp_analyzer/core/errors.py`
- Create: `src/vasp_analyzer/core/config.py`
- Create: `src/vasp_analyzer/calculation/__init__.py`
- Create: `src/vasp_analyzer/calculation/discovery.py`
- Modify: `src/vasp_analyzer/__init__.py`
- Delete: `src/vasp_analyzer/models.py`
- Delete: `src/vasp_analyzer/errors.py`
- Delete: `src/vasp_analyzer/discovery.py`
- Delete if present and uncommitted: `src/vasp_analyzer/parsers/`, `tests/unit/test_poscar_parser.py`, `tests/fixtures/POSCAR.standard`, `tests/fixtures/POSCAR.home-zero`
- Modify: `tests/unit/test_models.py`
- Modify: `tests/unit/test_discovery.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: behavior from commits `abadf13` and `4b358e7`.
- Produces: `FrozenModel`, `Vec3`, `Mat3`, `SelectiveMask`, `Site`, `ForceComponent`, `IonicStep`, `Capability`, `CalculationDataset`, `SourceFile`, `DiscoveredCalculation`, `discover_calculation(path: Path)`, and stable errors.

- [ ] **Step 1: Write failing migration and immutability tests**

```python
from pathlib import Path

import pytest
from pydantic import ValidationError

from vasp_analyzer.calculation.discovery import discover_calculation
from vasp_analyzer.core.models import CalculationDataset, SourceFile


def test_source_files_are_deeply_immutable(tmp_path: Path) -> None:
    source = SourceFile(path=str(tmp_path / "OUTCAR"), size=7, mtime_ns=11, fingerprint="abc")
    dataset = CalculationDataset(root=str(tmp_path), source_files=(source,), sites=(), ionic_steps=(), capabilities=())
    with pytest.raises(ValidationError):
        dataset.source_files = ()


def test_discovery_inventories_poscar_contcar_and_outcar(tmp_path: Path) -> None:
    for name in ("POSCAR", "CONTCAR", "OUTCAR", "vasprun.xml", "CHGCAR"):
        (tmp_path / name).write_text(name, encoding="utf-8")
    found = discover_calculation(tmp_path)
    assert (found.poscar, found.contcar, found.outcar) == tuple((tmp_path / name).resolve() for name in ("POSCAR", "CONTCAR", "OUTCAR"))
    assert tuple(item.name for item in found.optional) == ("CHGCAR", "vasprun.xml")
```

- [ ] **Step 2: Run migration tests and verify failure**

Run: `python -m pytest tests/unit/test_models.py tests/unit/test_discovery.py -v`

Expected: FAIL because `vasp_analyzer.core` and `vasp_analyzer.calculation` do not exist.

- [ ] **Step 3: Move and harden the public contracts**

Move the committed classes without semantic regressions, replace the mutable mapping with immutable source records, and keep JSON aliases:

```python
class SourceFile(FrozenModel):
    path: str
    size: int
    mtime_ns: int
    fingerprint: str


class Site(FrozenModel):
    site_index: int
    element: str
    initial_fractional_position: Vec3
    initial_cartesian_position: Vec3
    selective_dynamics: SelectiveMask


class ParserWarning(FrozenModel):
    category: Literal["IncompleteTail", "IgnoredCompatibilityMetadata"]
    message: str
    byte_offset: int | None = None
    line_number: int | None = None


class ParserProvenance(FrozenModel):
    adapter: str
    adapter_version: str
    dialect: str
    profile_id: str | None = None
    normalization_rules: tuple[str, ...] = ()
    compatibility_metadata: tuple[str, ...] = ()


class EnergyTerm(FrozenModel):
    name: str
    value: float
    unit: Literal["eV"] = "eV"


class IonicStep(FrozenModel):
    index: int
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    free_forces: tuple[Vec3, ...] | None
    free_force_norms: tuple[float, ...] | None
    total_energy: float | None
    energy_terms: tuple[EnergyTerm, ...] = ()
    delta_energy: float | None
    scf_iterations: int | None
    electronic_converged: bool | None
    ionic_converged: bool | None
    strongest_free_component: ForceComponent | None
    rms_free_force: float | None


class CalculationDataset(FrozenModel):
    schema_version: Literal[1] = 1
    root: str
    source_files: tuple[SourceFile, ...]
    sites: tuple[Site, ...]
    ionic_steps: tuple[IonicStep, ...]
    capabilities: tuple[Capability, ...]
    warnings: tuple[ParserWarning, ...] = ()
    provenance: ParserProvenance | None = None
```

Define `UnsupportedDialect`, `ProfileValidationError`, `MalformedBlock`, `IncompleteTail`, and `DatasetConsistencyError` in `core/errors.py`; `IncompleteTail` is also representable as a nonfatal `ParserWarning` value.

- [ ] **Step 4: Move discovery and cover all inputs**

```python
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
    optional_names = ("AECCAR0", "AECCAR1", "AECCAR2", "CHGCAR", "DOSCAR", "EIGENVAL", "ELFCAR", "LOCPOT", "PROCAR", "vasprun.xml")
    return DiscoveredCalculation(
        root=root,
        outcar=outcar,
        poscar=(root / "POSCAR") if (root / "POSCAR").is_file() else None,
        contcar=(root / "CONTCAR") if (root / "CONTCAR").is_file() else None,
        optional=tuple(DiscoveredFile(name, (root / name).resolve()) for name in optional_names if (root / name).is_file()),
    )
```

- [ ] **Step 5: Add generated/cache ignores and remove disposable artifacts**

Add exactly:

```gitignore
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.coverage
htmlcov/
.vasp-analyzer-cache/
corpus-report*.json
```

Remove only the listed uncommitted old Task 3 paths; do not read or copy the ignored root `POSCAR`.

- [ ] **Step 6: Verify and commit**

Run: `python -m pytest tests/unit/test_models.py tests/unit/test_discovery.py -v && python -m ruff check src tests`

Expected: all model/discovery tests PASS; Ruff reports no errors; `git status --short` contains no cache files.

```bash
git add .gitignore src/vasp_analyzer tests/unit/test_models.py tests/unit/test_discovery.py
git commit -m "refactor: establish analyzer feature packages"
```

### Task 2: Load Fail-Closed Declarative Compatibility Profiles

**Files:**
- Create: `src/vasp_analyzer/parsing/__init__.py`
- Create: `src/vasp_analyzer/parsing/profiles/{__init__,models,loader,normalizer}.py`
- Create: `tests/unit/parsing/profiles/test_loader.py`
- Create: `tests/fixtures/profiles/home-example.toml`

**Interfaces:**
- Consumes: `ProfileValidationError`.
- Produces: `CompatibilityProfile`, `load_profile(path: Path)`, and `normalize_poscar(text: str, profile: CompatibilityProfile) -> NormalizationResult`.

- [ ] **Step 1: Write failing profile schema and security tests**

Create `home-example.toml` exactly as:

```toml
schema_version = 1
id = "home-example"
display_name = "Home example"

[detection]
outcar_contains = ["vasp.5.4.1-barrier"]
priority = 100

[poscar]
drop_exact_line_after = "Selective dynamics"
drop_exact_line = "0"

[outcar.markers]
position_force = ["POSITION", "TOTAL-FORCE"]
total_energy = ["free energy", "TOTEN"]
converged = ["reached required accuracy"]

[validation]
expected_force_columns = 6
allow_incomplete_tail = true
```

```python
def test_profile_loads_only_supported_declarative_rules() -> None:
    profile = load_profile(FIXTURES / "profiles" / "home-example.toml")
    assert profile.schema_version == 1
    assert profile.poscar.drop_exact_line == "0"


@pytest.mark.parametrize("source", [
    "schema_version = 2\nid = 'x'\n",
    "schema_version = 1\nid = 'x'\npython = 'payload.py'\n",
    "schema_version = 1\nid = 'x'\n[poscar]\ndrop_regex = '.*'\n",
])
def test_profile_rejects_unknown_versions_and_executable_rules(tmp_path: Path, source: str) -> None:
    path = tmp_path / "bad.toml"
    path.write_text(source, encoding="utf-8")
    with pytest.raises(ProfileValidationError):
        load_profile(path)
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py -v`

Expected: FAIL importing the absent profile package.

- [ ] **Step 3: Implement frozen schema and strict TOML loader**

```python
class DetectionRule(FrozenModel):
    outcar_contains: tuple[str, ...] = ()
    priority: int = 0


class PoscarRule(FrozenModel):
    drop_exact_line_after: Literal["Selective dynamics"] | None = None
    drop_exact_line: str | None = None


class ValidationRule(FrozenModel):
    expected_force_columns: Literal[6] = 6
    allow_incomplete_tail: bool = True


class MarkerAliases(FrozenModel):
    position_force: tuple[str, ...] = ("POSITION", "TOTAL-FORCE")
    total_energy: tuple[str, ...] = ("free energy", "TOTEN")
    converged: tuple[str, ...] = ("reached required accuracy",)


class OutcarRule(FrozenModel):
    markers: MarkerAliases = MarkerAliases()


class CompatibilityProfile(FrozenModel):
    schema_version: Literal[1]
    id: str
    display_name: str
    detection: DetectionRule = DetectionRule()
    poscar: PoscarRule = PoscarRule()
    outcar: OutcarRule = OutcarRule()
    validation: ValidationRule = ValidationRule()


def load_profile(path: Path) -> CompatibilityProfile:
    try:
        return CompatibilityProfile.model_validate(tomllib.loads(path.read_text(encoding="utf-8")))
    except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
        raise ProfileValidationError(f"Invalid profile {path.name}: {exc}") from exc


class NormalizationResult(FrozenModel):
    text: str
    applied_rules: tuple[str, ...] = ()
    compatibility_metadata: tuple[str, ...] = ()

    def provenance(self, adapter: str, adapter_version: str, dialect: str) -> ParserProvenance:
        return ParserProvenance(
            adapter=adapter,
            adapter_version=adapter_version,
            dialect=dialect,
            normalization_rules=self.applied_rules,
            compatibility_metadata=self.compatibility_metadata,
        )
```

All nested models use `extra="forbid"`; `normalizer.py` supports only the exact after-line/drop-line operation and validates the resulting coordinate-mode line.

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest tests/unit/parsing/profiles/test_loader.py -v && python -m pytest -v && python -m ruff check src tests`

Expected: profile tests and full repository suite PASS; Ruff clean.

```bash
git add src/vasp_analyzer/parsing tests/unit/parsing/profiles tests/fixtures/profiles
git commit -m "feat: validate declarative parser profiles"
```

### Task 3: Detect Standard and Built-In Home-Barrier Dialects

**Files:**
- Create: `src/vasp_analyzer/parsing/dialects/{__init__,base,standard,home_barrier,registry}.py`
- Create: `tests/unit/parsing/dialects/test_registry.py`

**Interfaces:**
- Consumes: `CompatibilityProfile`, `UnsupportedDialect`.
- Produces: `Dialect`, `DialectMatch`, `STANDARD`, `HOME_BARRIER`, `detect_dialect(outcar_head: str, forced_profile: CompatibilityProfile | None = None)`.

- [ ] **Step 1: Write failing deterministic detection tests**

```python
def test_home_barrier_marker_wins_over_standard() -> None:
    match = detect_dialect("vasp.5.4.1-barrier build\n")
    assert (match.dialect.id, match.score, match.markers) == ("home_barrier", 100, ("vasp.5.4.1-barrier",))


def test_unknown_header_fails_with_actionable_error() -> None:
    with pytest.raises(UnsupportedDialect, match="no supported OUTCAR marker"):
        detect_dialect("unrelated output\n")
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/parsing/dialects/test_registry.py -v`

Expected: FAIL importing the absent dialect registry.

- [ ] **Step 3: Implement scored literal matching**

```python
@dataclass(frozen=True)
class Dialect:
    id: str
    display_name: str
    markers: tuple[str, ...]
    priority: int
    profile: CompatibilityProfile


@dataclass(frozen=True)
class DialectMatch:
    dialect: Dialect
    score: int
    markers: tuple[str, ...]


def detect_dialect(outcar_head: str, forced_profile: CompatibilityProfile | None = None) -> DialectMatch:
    if forced_profile is not None:
        return DialectMatch(profile_dialect(forced_profile), forced_profile.detection.priority, ())
    matches = [
        DialectMatch(dialect, dialect.priority, tuple(m for m in dialect.markers if m in outcar_head))
        for dialect in BUILT_INS
        if any(marker in outcar_head for marker in dialect.markers)
    ]
    if not matches:
        raise UnsupportedDialect("no supported OUTCAR marker; pass --profile with a validated TOML profile")
    return max(matches, key=lambda item: (item.score, item.dialect.id))
```

`HOME_BARRIER` embeds the exact POSCAR normalization rule; `STANDARD` matches recognized ordinary VASP headers with lower priority.

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest tests/unit/parsing/dialects/test_registry.py -v && python -m pytest -v && python -m ruff check src tests`

Expected: deterministic detection and full suite PASS; Ruff clean.

```bash
git add src/vasp_analyzer/parsing/dialects tests/unit/parsing/dialects
git commit -m "feat: detect VASP parser dialects"
```

### Task 4: Parse Normalized POSCAR and CONTCAR with pymatgen

**Files:**
- Create: `src/vasp_analyzer/parsing/adapters/{__init__,poscar_pymatgen}.py`
- Create: `tests/unit/parsing/adapters/test_poscar_pymatgen.py`
- Create: `tests/fixtures/poscar/{standard-direct,standard-cartesian,no-selective,skewed,home-zero,invalid-custom}.vasp`

**Interfaces:**
- Consumes: `Dialect`, `Site`, `SelectiveMask`, `Mat3`, `Vec3`, `MalformedBlock`.
- Produces: `ParsedStructure` and `parse_poscar(path: Path, dialect: Dialect) -> ParsedStructure`.

- [ ] **Step 1: Add reviewed synthetic fixtures and failing tests**

The home fixture is exactly:

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

```python
def test_home_metadata_normalizes_to_standard_structure() -> None:
    standard = parse_poscar(FIXTURES / "standard-direct.vasp", STANDARD)
    home = parse_poscar(FIXTURES / "home-zero.vasp", HOME_BARRIER)
    assert home.sites == standard.sites
    assert home.fractional_positions == standard.fractional_positions
    assert home.provenance.compatibility_metadata == ("0",)


def test_unknown_compatibility_line_reports_line_and_content() -> None:
    with pytest.raises(MalformedBlock, match=r"line 9.*custom"):
        parse_poscar(FIXTURES / "invalid-custom.vasp", HOME_BARRIER)
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/parsing/adapters/test_poscar_pymatgen.py -v`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement narrow normalization and immediate conversion**

```python
class ParsedStructure(FrozenModel):
    lattice: Mat3
    sites: tuple[Site, ...]
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    provenance: ParserProvenance


def parse_poscar(path: Path, dialect: Dialect) -> ParsedStructure:
    result = normalize_poscar(path.read_text(encoding="utf-8", errors="strict"), dialect.profile)
    try:
        structure = Poscar.from_str(result.text).structure
    except ValueError as exc:
        raise MalformedBlock(f"{path.name}: invalid POSCAR: {exc}") from exc
    raw_masks = structure.site_properties.get("selective_dynamics")
    masks = raw_masks if raw_masks is not None else [[None, None, None] for _ in structure]
    return ParsedStructure(
        lattice=mat3(structure.lattice.matrix),
        sites=tuple(Site(site_index=i, element=site.specie.symbol, initial_fractional_position=vec3(site.frac_coords), initial_cartesian_position=vec3(site.coords), selective_dynamics=SelectiveMask(a=mask[0], b=mask[1], c=mask[2])) for i, (site, mask) in enumerate(zip(structure, masks, strict=True))),
        fractional_positions=tuple(vec3(site.frac_coords) for site in structure),
        cartesian_positions=tuple(vec3(site.coords) for site in structure),
        provenance=result.provenance(adapter="pymatgen", adapter_version=version("pymatgen"), dialect=dialect.id),
    )
```

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest tests/unit/parsing/adapters/test_poscar_pymatgen.py -v && python -m pytest -v && python -m ruff check src tests`

Expected: direct, Cartesian, absent masks, skewed lattice, exact metadata, and strict error tests PASS.

```bash
git add src/vasp_analyzer/parsing tests/unit/parsing/adapters tests/fixtures/poscar
git commit -m "feat: parse normalized VASP structures"
```

### Task 5: Index and Recover Complete OUTCAR Records

**Files:**
- Create: `src/vasp_analyzer/parsing/recovery/{__init__,scanner,checkpoint}.py`
- Create: `tests/unit/parsing/recovery/test_scanner.py`
- Create: `tests/fixtures/outcar/{complete-two-step,truncated-force,trailing-no-energy,appended-prefix}.OUTCAR`

**Interfaces:**
- Consumes: dialect marker aliases and validation rules.
- Produces: `StepRecord`, `ScanResult`, `ParserCheckpoint`, `scan_outcar(path, dialect, checkpoint=None)`.

- [ ] **Step 1: Write failing complete-tail and offset tests**

```python
def test_partial_force_block_is_discarded_without_losing_earlier_steps() -> None:
    result = scan_outcar(FIXTURES / "truncated-force.OUTCAR", HOME_BARRIER)
    assert len(result.steps) == 1
    assert result.warnings[0].category == "IncompleteTail"


def test_completed_structure_without_energy_is_retained() -> None:
    result = scan_outcar(FIXTURES / "trailing-no-energy.OUTCAR", HOME_BARRIER)
    assert result.steps[-1].energy is None


def test_appended_file_resumes_at_last_verified_offset(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(PREFIX)
    first = scan_outcar(path, HOME_BARRIER)
    path.write_bytes(PREFIX + SUFFIX)
    second = scan_outcar(path, HOME_BARRIER, first.checkpoint)
    assert second.resumed_from == first.checkpoint.last_verified_offset
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/parsing/recovery/test_scanner.py -v`

Expected: FAIL importing the absent recovery scanner.

- [ ] **Step 3: Implement byte-oriented validated records**

```python
class ParserCheckpoint(FrozenModel):
    path: str
    size: int
    mtime_ns: int
    prefix_fingerprint: str
    last_verified_offset: int
    next_step_id: int


class StepRecord(FrozenModel):
    step_id: int
    block_start: int
    block_end: int
    atom_count: int
    lattice: Mat3
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    energy: float | None
    scf_iterations: int | None
    electronic_converged: bool | None
    ionic_converged: bool | None


class ScanResult(FrozenModel):
    steps: tuple[StepRecord, ...]
    warnings: tuple[ParserWarning, ...]
    checkpoint: ParserCheckpoint
    resumed_from: int
    normally_finished: bool


def checkpoint_is_append_only(path: Path, checkpoint: ParserCheckpoint) -> bool:
    stat = path.stat()
    return stat.st_size >= checkpoint.size and fingerprint_prefix(path, checkpoint.size) == checkpoint.prefix_fingerprint
```

`scan_outcar()` reads binary lines once, records byte offsets, requires exactly six finite numeric columns per atom row, validates the expected atom count and current lattice before emitting a step, and advances `last_verified_offset` only after a complete record. A non-append fingerprint or truncation returns a clean scan from byte zero.

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest tests/unit/parsing/recovery/test_scanner.py -v && python -m pytest -v && python -m ruff check src tests`

Expected: complete, incomplete, no-energy, append-resume, replacement, NaN, and inconsistent-column tests PASS.

```bash
git add src/vasp_analyzer/parsing/recovery tests/unit/parsing/recovery tests/fixtures/outcar
git commit -m "feat: recover indexed OUTCAR records"
```

### Task 6: Stream OUTCAR Trajectories Through ASE 3.29+

**Files:**
- Modify: `pyproject.toml`
- Create: `src/vasp_analyzer/parsing/adapters/outcar_ase.py`
- Create: `tests/unit/parsing/adapters/test_outcar_ase.py`

**Interfaces:**
- Consumes: `ScanResult`, `StepRecord`.
- Produces: `ParsedTrajectoryStep` and `iter_outcar_steps(path: Path, scan: ScanResult) -> Iterator[ParsedTrajectoryStep]`.

- [ ] **Step 1: Pin the adapter floor and write failing conversion tests**

Add `"ase>=3.29"` to runtime dependencies, then test:

```python
def test_ase_steps_match_scanner_records_and_release_atoms(monkeypatch: pytest.MonkeyPatch) -> None:
    scan = scan_outcar(FIXTURES / "complete-two-step.OUTCAR", HOME_BARRIER)
    monkeypatch.setattr(outcar_ase, "iread", lambda *args, **kwargs: iter(make_two_ase_atoms()))
    steps = tuple(iter_outcar_steps(FIXTURES / "complete-two-step.OUTCAR", scan))
    assert [step.step_id for step in steps] == [record.step_id for record in scan.steps]
    assert all(len(step.cartesian_positions) == len(step.raw_forces) == 2 for step in steps)
    assert steps[1].total_energy == scan.steps[1].energy
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/parsing/adapters/test_outcar_ase.py -v`

Expected: FAIL because `outcar_ase` is absent.

- [ ] **Step 3: Implement bounded ASE conversion**

```python
class ParsedTrajectoryStep(FrozenModel):
    step_id: int
    lattice: Mat3
    fractional_positions: tuple[Vec3, ...]
    cartesian_positions: tuple[Vec3, ...]
    raw_forces: tuple[Vec3, ...]
    total_energy: float | None


def iter_outcar_steps(path: Path, scan: ScanResult) -> Iterator[ParsedTrajectoryStep]:
    frames = islice(iread(path, format="vasp-out", index=":"), len(scan.steps))
    converted = 0
    for record in scan.steps:
        try:
            atoms = next(frames)
        except StopIteration:
            if record is scan.steps[-1] and record.energy is None:
                yield recovered_step(record)
                converted += 1
                break
            raise DatasetConsistencyError(
                f"ASE returned {converted} frames for {len(scan.steps)} indexed steps"
            )
        cell = mat3(atoms.cell.array)
        positions = tuple(vec3(row) for row in atoms.positions)
        scaled = tuple(vec3(row) for row in atoms.get_scaled_positions(wrap=False))
        forces = tuple(vec3(row) for row in atoms.get_forces(apply_constraint=False))
        validate_finite_step(record.step_id, cell, positions, forces)
        yield ParsedTrajectoryStep(step_id=record.step_id, lattice=cell, fractional_positions=scaled, cartesian_positions=positions, raw_forces=forces, total_energy=record.energy)
        converted += 1
        del atoms
```

The adapter reconciles ASE frames with explicit scanner `step_id`; a count mismatch raises `DatasetConsistencyError` rather than padding either sequence. For a final scanner-validated force block that ASE cannot emit because the physical file ends before its normal frame terminator, the recovery scanner converts only that final block through the same `ParsedTrajectoryStep` validator and sets `total_energy=None`; it never reuses ASE data from the preceding frame.

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest tests/unit/parsing/adapters/test_outcar_ase.py -v && python -m pytest -v && python -m ruff check src tests`

Expected: ASE/scanner agreement, finite-number, and mismatch tests PASS; installed ASE reports at least 3.29.

```bash
git add pyproject.toml src/vasp_analyzer/parsing/adapters/outcar_ase.py tests/unit/parsing/adapters/test_outcar_ase.py
git commit -m "feat: stream OUTCAR trajectories with ASE"
```

### Task 7: Compute Structure and Convergence Data and Assemble a Dataset

**Files:**
- Create: `src/vasp_analyzer/structure/{__init__,constraints,bonds,supercell}.py`
- Create: `src/vasp_analyzer/convergence/{__init__,forces,electronic}.py`
- Create: `src/vasp_analyzer/calculation/{dataset,cache,session}.py`
- Create: `tests/unit/structure/test_constraints.py`
- Create: `tests/unit/structure/test_geometry.py`
- Create: `tests/unit/convergence/test_forces.py`
- Create: `tests/unit/core/test_future_contracts.py`
- Create: `tests/integration/test_dataset.py`

**Interfaces:**
- Consumes: discovered files, parsed structures/trajectory, checkpoints.
- Produces: `apply_constraints`, `force_metrics`, `load_dataset(path, profile=None)`, fingerprint cache, future DOS/band/volumetric capability seams.

- [ ] **Step 1: Write failing force and reconciliation tests**

```python
def test_fixed_largest_component_is_excluded() -> None:
    masks = (SelectiveMask(a=True, b=False, c=True),)
    metrics = force_metrics(((0.4, 9.0, -0.6),), masks)
    assert metrics.strongest == ForceComponent(site_index=0, axis="c", value=-0.6)
    assert metrics.free_forces == ((0.4, 0.0, -0.6),)


def test_species_mismatch_names_both_sources(calculation_with_mismatch: Path) -> None:
    with pytest.raises(DatasetConsistencyError, match=r"POSCAR.*OUTCAR"):
        load_dataset(calculation_with_mismatch)


def test_supercell_images_keep_original_identity() -> None:
    images = replicate_sites(SITES, repeat=(2, 1, 1))
    assert [(image.site_index, image.image) for image in images] == [(0, (0, 0, 0)), (1, (0, 0, 0)), (0, (1, 0, 0)), (1, (1, 0, 0))]


def test_volumetric_contract_rejects_mismatched_lattice() -> None:
    field = VolumetricDescriptor(source="CHGCAR", lattice=IDENTITY, dimensions=(8, 8, 8), kind="charge", units="e/angstrom^3", value_range=(-0.2, 0.5))
    with pytest.raises(VolumetricAlignmentError):
        field.require_compatible_structure(((2.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/core/test_future_contracts.py tests/unit/structure tests/unit/convergence tests/integration/test_dataset.py -v`

Expected: FAIL because structure, convergence, and dataset modules are absent.

- [ ] **Step 3: Implement constraint-aware metrics and explicit reconciliation**

```python
class ForceMetrics(FrozenModel):
    free_forces: tuple[Vec3, ...] | None
    free_force_norms: tuple[float, ...] | None
    strongest: ForceComponent | None
    rms: float | None


def force_metrics(forces: tuple[Vec3, ...], masks: tuple[SelectiveMask, ...] | None) -> ForceMetrics:
    if masks is None or any(None in mask.as_tuple() for mask in masks):
        return ForceMetrics(free_forces=None, free_force_norms=None, strongest=None, rms=None)
    free = tuple(tuple(value if allowed else 0.0 for value, allowed in zip(force, mask.as_tuple(), strict=True)) for force, mask in zip(forces, masks, strict=True))
    eligible = [(abs(value), ForceComponent(site_index=i, axis=axis, value=value)) for i, (force, mask) in enumerate(zip(forces, masks, strict=True)) for axis, value, allowed in zip(("a", "b", "c"), directional_components(force, lattice), mask.as_tuple(), strict=True) if allowed]
    strongest = max(eligible, default=(0.0, None), key=lambda item: item[0])[1]
    norms = tuple(sqrt(sum(value * value for value in vector)) for vector in free)
    allowed_values = [component.value for _, component in eligible]
    rms = sqrt(sum(value * value for value in allowed_values) / len(allowed_values)) if allowed_values else None
    return ForceMetrics(free_forces=free, free_force_norms=norms, strongest=strongest, rms=rms)
```

`load_dataset()` selects the dialect, parses POSCAR/CONTCAR and OUTCAR, rejects atom-count or species-order conflicts, joins records only by `step_id`, calculates delta energy only across present energies, persists warnings/provenance, and advertises disabled DOS/band/charge capabilities with required filenames.

Define `SupercellSite(site_index, image, fractional_position)`, periodic minimum-image bond generation, and `replicate_sites()` in `structure/`. Define `VolumetricDescriptor` and `VolumetricRequest` in `core/models.py`; `require_compatible_structure()` uses `numpy.allclose(..., atol=1e-6, rtol=0.0)`, and mesh/cache request identity includes fingerprint, isovalue, downsample, and repeat. These are contracts only: no CHGCAR reader or empty future feature package is added.

- [ ] **Step 4: Add cache/session behavior**

```python
def cache_key(source: SourceFile, dialect_id: str, profile: CompatibilityProfile) -> str:
    """Hash core source fingerprints, dialect, canonical full profile, analyzer and cache schemas."""


class CalculationSession:
    def __init__(self, path: Path, profile: CompatibilityProfile | None = None, cache: CacheStore | None = None) -> None:
        self.path = path
        self.profile = profile
        self.cache = cache or CacheStore.default()
        self._source: SourceFile | None = None
        self._dataset: CalculationDataset | None = None

    def load(self) -> CalculationDataset:
        discovered = discover_calculation(self.path)
        source = inspect_source(discovered.outcar)
        dialect = detect_path_dialect(discovered, self.profile)
        key = cache_key(source, dialect.id, dialect.profile)
        self._dataset = self.cache.get(key) or load_dataset(self.path, profile=self.profile)
        self.cache.put(key, self._dataset)
        self._source = source
        return self._dataset

    def refresh_if_changed(self) -> CalculationDataset:
        discovered = discover_calculation(self.path)
        source = inspect_source(discovered.outcar)
        if self._dataset is not None and source == self._source:
            return self._dataset
        return self.load()
```

Implement `load` and `refresh_if_changed` with immutable cache payloads and recovered offsets; corrupt caches are ignored and rebuilt.

- [ ] **Step 5: Verify and commit**

Run: `python -m pytest tests/unit/core/test_future_contracts.py tests/unit/structure tests/unit/convergence tests/integration/test_dataset.py -v && python -m pytest -v && python -m ruff check src tests`

Expected: force, unknown-mask, reconciliation, incomplete-tail, cache reuse, and refresh tests PASS.

```bash
git add src/vasp_analyzer/core/models.py src/vasp_analyzer/structure src/vasp_analyzer/convergence src/vasp_analyzer/calculation tests/unit/core/test_future_contracts.py tests/unit/structure tests/unit/convergence tests/integration/test_dataset.py
git commit -m "feat: assemble immutable calculation datasets"
```

### Task 8: Validate the Actual 52-File Corpus Without Committing It

**Files:**
- Create: `src/vasp_analyzer/cli/corpus.py`
- Create: `tests/corpus/test_local_outcars.py`
- Create: `tests/unit/cli/test_corpus_report.py`
- Modify: `pyproject.toml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: dialect detection, recovery scanner, ASE adapter, dataset validation.
- Produces: `CorpusReport`, `validate_corpus(root: Path)`, opt-in `corpus` marker, aggregate JSON output.

- [ ] **Step 1: Register an opt-in marker and write failing aggregate tests**

```toml
[tool.pytest.ini_options]
markers = ["corpus: requires VASP_ANALYZER_CORPUS_DIR and reads local OUTCAR files"]
```

```python
@pytest.mark.corpus
def test_actual_home_barrier_corpus() -> None:
    root = corpus_root_or_skip()
    report = validate_corpus(root)
    assert report.files == 52
    assert report.bytes_total == 2_288_020_784
    assert report.bytes_total / (1024 ** 3) == pytest.approx(2.131, rel=0.01)
    assert report.home_barrier == 52
    assert report.with_force_blocks == 50
    assert report.force_blocks == 12_909
    assert report.complete == 38
    assert report.incomplete == 14
    assert report.max_steps == 3_000
```

Keep the byte count exact and use a +/-1% tolerance only for the rounded 2.131 GiB display value; all aggregate counts are exact.

- [ ] **Step 2: Verify safe skip and RED implementation state**

Run without the environment variable: `python -m pytest tests/corpus/test_local_outcars.py -v`

Expected: one SKIP naming `VASP_ANALYZER_CORPUS_DIR`, no filesystem probing outside the repository.

Run with the actual corpus after setting `VASP_ANALYZER_CORPUS_DIR` outside the repository: `python -m pytest -m corpus tests/corpus/test_local_outcars.py -v`

Expected before implementation: FAIL importing `validate_corpus`.

- [ ] **Step 3: Implement streaming aggregate validation**

```python
class CorpusReport(FrozenModel):
    files: int
    bytes_total: int
    home_barrier: int
    with_force_blocks: int
    force_blocks: int
    complete: int
    incomplete: int
    max_steps: int
    elapsed_seconds: float
    peak_rss_bytes: int
    warnings: tuple[str, ...]
    fingerprints: tuple[str, ...]


def validate_corpus(root: Path) -> CorpusReport:
    outcars = tuple(sorted(root.rglob("OUTCAR")))
    if len(outcars) != 52:
        raise AnalyzerError(f"expected 52 OUTCAR files under corpus root, found {len(outcars)}")
    accumulator = CorpusAccumulator()
    for path in outcars:
        accumulator.consume(path, detect_dialect(read_head(path)), scan_outcar(path, HOME_BARRIER))
    return accumulator.finish()
```

For every emitted step validate atom/coordinate/force/constraint dimensions, finite values, valid lattice, and selected ASE/scanner numerical agreement. Record aggregate timings, peak RSS, warnings, and hashes only; never serialize source content or absolute paths.

- [ ] **Step 4: Add performance, cache, and append checks**

Select the corpus file with the largest size at runtime. Record wall time and peak RSS without a machine-independent threshold; assert peak retained parser data is bounded by converted steps rather than a copied 0.49 GB input. Parse twice and assert the second run reports cache reuse; append a copied sanitized tail in a temporary directory and assert resumption from the last verified offset.

- [ ] **Step 5: Run repository and actual corpus gates**

Run: `python -m pytest -m "not corpus" -v && python -m ruff check src tests`

Expected: repository-safe suite PASS; Ruff clean.

Run: `python -m pytest -m corpus tests/corpus -v` with `VASP_ANALYZER_CORPUS_DIR` already set in the shell and not stored in a project file.

Expected: 52 `home_barrier`; 38 complete/14 incomplete; 50 structural; 12,909 force blocks; maximum 3,000 steps; no crash, NaN, invalid lattice, dimension mismatch, or false success.

- [ ] **Step 6: Commit code and tests, never the report or corpus**

```bash
git add pyproject.toml .gitignore src/vasp_analyzer/cli/corpus.py tests/corpus tests/unit/cli/test_corpus_report.py
git diff --cached --name-only
git commit -m "test: validate local OUTCAR corpus"
```

Expected staged names contain no `OUTCAR`, absolute-path file, cache, or generated corpus report.

### Task 9: Add Transport Protocol, Stdio Sessions, Handoff, and CLI

**Files:**
- Create: `src/vasp_analyzer/transport/{__init__,protocol,stdio,handoff}.py`
- Create: `src/vasp_analyzer/cli/{__init__,app}.py`
- Create: `tests/unit/transport/test_protocol.py`
- Create: `tests/integration/test_stdio.py`
- Create: `tests/integration/test_cli.py`
- Modify: `pyproject.toml`

**Interfaces:**
- Consumes: `CalculationSession`, profile/dialect validation, `validate_corpus`.
- Produces: JSON methods `getDataset`, `getStep`, reserved `getVolumetric`; `analyzer` CLI modes; authenticated endpoint handoff.

- [ ] **Step 1: Write failing protocol and CLI tests**

```python
def test_stdio_returns_camel_case_dataset(two_step_calculation: Path) -> None:
    response = transact(two_step_calculation, {"id": 1, "method": "getDataset", "params": {}})
    assert response["id"] == 1
    assert response["result"]["schemaVersion"] == 1


@pytest.mark.parametrize("argument", [None, "OUTCAR", "."])
def test_cli_accepts_all_discovery_forms(argument: str | None, isolated_calculation: Path) -> None:
    result = runner.invoke(app, [] if argument is None else [argument])
    assert result.exit_code == 0
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/unit/transport tests/integration/test_stdio.py tests/integration/test_cli.py -v`

Expected: FAIL because transport and CLI modules are absent.

- [ ] **Step 3: Implement typed JSON lines and CLI routing**

```python
class DatasetParams(FrozenModel):
    pass


class StepParams(FrozenModel):
    step_index: int


class VolumetricParams(FrozenModel):
    source: str
    mode: Literal["isosurface", "slice"]


class Request(FrozenModel):
    id: int
    method: Literal["getDataset", "getStep", "getVolumetric"]
    params: DatasetParams | StepParams | VolumetricParams = DatasetParams()


def serve_stdio(session: CalculationSession, source: TextIO, sink: TextIO) -> None:
    for line in source:
        request = Request.model_validate_json(line)
        response = dispatch(session, request)
        sink.write(response.model_dump_json(by_alias=True) + "\n")
        sink.flush()


app = typer.Typer(no_args_is_help=False)
corpus_app = typer.Typer()
dialect_app = typer.Typer()
app.add_typer(corpus_app, name="corpus")
app.add_typer(dialect_app, name="dialect")


@corpus_app.command("validate")
def corpus_validate(path: Path) -> None:
    typer.echo(validate_corpus(path).model_dump_json(indent=2))


@dialect_app.command("validate")
def dialect_validate(path: Path, profile: Path | None = None) -> None:
    selected = load_profile(profile) if profile else None
    typer.echo(validate_path_dialect(path, selected).model_dump_json(indent=2))
```

`getVolumetric` returns typed `capability_unavailable`; `--profile` forces the validated profile. The root callback accepts the optional calculation path and tries an authenticated extension endpoint containing only token and canonical readable path. It receives a `WebLauncher` callable so tests can prove absent/stale/invalid endpoint routing before Task 14 supplies the lazy-imported browser implementation.

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest tests/unit/transport tests/integration/test_stdio.py tests/integration/test_cli.py -v && python -m pytest -m "not corpus" -v && python -m ruff check src tests`

Expected: protocol, all input forms, stale handoff fallback, profile, dialect, and corpus command tests PASS.

```bash
git add pyproject.toml src/vasp_analyzer/transport src/vasp_analyzer/cli tests/unit/transport tests/integration/test_stdio.py tests/integration/test_cli.py
git commit -m "feat: expose analyzer transport and CLI"
```

### Task 10: Build the Remote VS Code Extension and Authenticated Control Endpoint

**Files:**
- Create: `vscode/package.json`, `vscode/pnpm-lock.yaml`, `vscode/tsconfig.json`, `vscode/esbuild.mjs`
- Create: `vscode/src/{extension,controlEndpoint,analyzerProcess,webviewHtml}.ts`
- Create: `vscode/src/test/{controlEndpoint,analyzerProcess}.test.ts`

**Interfaces:**
- Consumes: `analyzer serve --stdio`, JSON methods from Task 9.
- Produces: Explorer/Command Palette open actions, Webview lifecycle, Unix socket/Windows named pipe endpoint, terminal environment token injection.

- [ ] **Step 1: Write failing endpoint and subprocess tests**

Create `package.json` with `test`, `typecheck`, `build`, and `package` scripts; declare `main: "./dist/extension.js"`, `extensionKind: ["workspace"]`, the `vaspAnalyzer.open` command, an Explorer context menu for `OUTCAR`, and development dependencies for TypeScript, esbuild, Vitest, VS Code types, and `@vscode/vsce`. Generate and commit `pnpm-lock.yaml` with the same dependency graph.

```typescript
it("rejects an invalid token before opening a panel", async () => {
  const endpoint = await createControlEndpoint({token: "secret", onOpen});
  await endpoint.request({token: "wrong", path: fixturePath});
  expect(onOpen).not.toHaveBeenCalled();
});

it("correlates newline-delimited responses", async () => {
  const process = new AnalyzerProcess(fakeChild);
  const pending = process.request("getDataset", {});
  fakeChild.stdout.emit("data", '{"id":1,"result":{"schemaVersion":1}}\n');
  await expect(pending).resolves.toMatchObject({schemaVersion: 1});
});
```

- [ ] **Step 2: Verify RED**

Run: `cd vscode && pnpm install && pnpm test -- controlEndpoint analyzerProcess`

Expected: FAIL because extension sources are absent.

- [ ] **Step 3: Implement endpoint, process, and CSP-safe Webview**

```typescript
context.environmentVariableCollection.replace("VASP_ANALYZER_ENDPOINT", endpoint.address);
context.environmentVariableCollection.replace("VASP_ANALYZER_TOKEN", endpoint.token);

export class AnalyzerProcess {
  request(method: Method, params: object): Promise<unknown> {
    const id = ++this.nextId;
    this.child.stdin.write(JSON.stringify({id, method, params}) + "\n");
    return new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
  }
}
```

Validate token with constant-time comparison and validate canonical path readability before opening a panel. Launch Python on the remote extension host. `webviewHtml.ts` uses a nonce CSP and only `webview.asWebviewUri()` bundle URIs.

The build emits `dist/extension.js` and `dist/webview/`; after the first lockfile generation, every verification and CI install uses `pnpm install --frozen-lockfile`.

- [ ] **Step 4: Verify and commit**

Run: `cd vscode && pnpm test && pnpm typecheck && pnpm build`

Expected: Linux socket/Windows pipe abstraction, invalid/stale endpoint, subprocess correlation, CSP, command, and menu tests PASS.

```bash
git add vscode
git commit -m "feat: add Remote SSH analyzer extension"
```

### Task 11: Build the Webview Host, Store, and Split Layout

**Files:**
- Create: `vscode/webview/src/core/{contracts,host,store}.ts`
- Create: `vscode/webview/src/App.tsx`
- Create: `vscode/webview/src/App.test.tsx`
- Create: `vscode/webview/src/styles.css`
- Create: `vscode/webview/src/test/fixtures.ts`

**Interfaces:**
- Consumes: immutable dataset JSON and `getDataset`/`getStep`.
- Produces: one selected-step/site state, persisted editor state, and upper-structure/lower-analysis layout slots.

- [ ] **Step 1: Write failing shared-state and reload tests**

```typescript
it("uses one selected step across both layout regions", async () => {
  render(<App host={twoStepHost} structure={FakeStructure} convergence={FakeConvergence} />);
  await user.selectOptions(screen.getByLabelText("Ionic step"), "1");
  expect(screen.getByLabelText("Ionic step")).toHaveValue("1");
  expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
  expect(screen.getByTestId("convergence-step")).toHaveTextContent("1");
});

it("restores selected step and site after a Webview reload", async () => {
  const first = render(<App host={persistingHost} structure={FakeStructure} convergence={FakeConvergence} />);
  await user.selectOptions(screen.getByLabelText("Ionic step"), "1");
  persistingHost.setState({selectedStep: 1, selectedSite: 1});
  first.unmount();
  render(<App host={persistingHost} structure={FakeStructure} convergence={FakeConvergence} />);
  expect(screen.getByLabelText("Ionic step")).toHaveValue("1");
  expect(screen.getByText("O 2")).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

Run: `cd vscode && pnpm test -- App.test.tsx`

Expected: FAIL because the Webview host, store, and split layout are absent.

- [ ] **Step 3: Implement one immutable UI state source and split layout**

```typescript
export type AnalysisState = Readonly<{
  dataset: CalculationDataset | null;
  selectedStep: number;
  selectedSite: number | null;
  forceMode: "free" | "raw";
  forceScale: number;
}>;

export const selectStep = (state: AnalysisState, index: number): AnalysisState => ({
  ...state,
  selectedStep: clamp(index, 0, Math.max(0, (state.dataset?.ionicSteps.length ?? 1) - 1)),
});
```

`VsCodeHost` and `HttpHost` implement the same request/state interface. Persist only selected step/site, restore and clamp them before the first frame, and render a resizable upper structure region above a lower tab region with `Convergence` active and `DOS/PDOS`, `Band`, and `Charge` visibly disabled.

- [ ] **Step 4: Verify and commit the Webview state boundary**

Run: `cd vscode && pnpm test -- App.test.tsx && pnpm typecheck`

Expected: shared-state, reload, clamp, vertical layout, and disabled-tab tests PASS.

```bash
git add vscode/webview/src/core vscode/webview/src/App* vscode/webview/src/styles.css vscode/webview/src/test
git commit -m "feat: add Webview analysis workspace"
```

### Task 12: Implement the Crystallographic Structure Viewer

**Files:**
- Create: `vscode/webview/src/renderers/{CrystalRenderer,ThreeDmolRenderer}.ts`
- Create: `vscode/webview/src/features/structure/{CrystalPanel,AtomDetail,scene}.tsx`
- Create: `vscode/webview/src/features/structure/{CrystalPanel,scene}.test.tsx`

**Interfaces:**
- Consumes: Task 11 `AnalysisState`, selected `IonicStep`, stable site identity, bonds, and supercell records.
- Produces: crystallographic scene layers, camera controls, atom detail selection, force scale, and renderer-level volumetric seam.

- [ ] **Step 1: Write failing crystal interaction tests**

```typescript
it("preserves original identity in periodic images", () => {
  expect(replicateSites(sites, [2, 1, 1]).map(site => site.siteIndex)).toEqual([0, 1, 0, 1]);
});

it("clicking an atom shows positions forces and directional constraints", async () => {
  render(<CrystalPanel store={twoStepStore} rendererFactory={fakeRendererFactory} />);
  fakeRenderer.selectSite(1);
  expect(await screen.findByText("O 2")).toBeVisible();
  expect(screen.getByText("Fx -0.100000 eV/angstrom")).toBeVisible();
  expect(screen.getByText("Selective Dynamics a/b/c F F T")).toBeVisible();
});

it("scales arrow geometry without changing displayed force values", async () => {
  render(<CrystalPanel store={twoStepStore} rendererFactory={fakeRendererFactory} />);
  await user.clear(screen.getByLabelText("Force vector scale"));
  await user.type(screen.getByLabelText("Force vector scale"), "2");
  expect(fakeRenderer.setForceScale).toHaveBeenLastCalledWith(2);
  expect(screen.getByText("Fx -0.100000 eV/angstrom")).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

Run: `cd vscode && pnpm test -- scene.test.tsx CrystalPanel.test.tsx`

Expected: FAIL because the structure feature and renderer are absent.

- [ ] **Step 3: Implement renderer isolation and the crystal scene**

```typescript
export interface CrystalRenderer {
  setStructure(frame: CrystalFrame): void;
  setForces(vectors: readonly VectorGlyph[]): void;
  setForceScale(scale: number): void;
  setConstraints(glyphs: readonly ConstraintGlyph[]): void;
  setSupercell(repeat: readonly [number, number, number]): void;
  setViewDirection(direction: readonly [number, number, number]): void;
  setOrthographic(enabled: boolean): void;
  setLayerVisible(layer: "cell" | "bonds" | "forces" | "constraints", visible: boolean): void;
  setVolumetricLayer(layer: VolumetricLayer | null): void;
  onSelectSite(callback: (siteIndex: number) => void): void;
  resetView(): void;
  dispose(): void;
}
```

Keep 3Dmol.js wholly behind `ThreeDmolRenderer` and bundle it locally. Scene helpers render unit-cell edges, `a/b/c` axes, minimum-image periodic bonds, `a x b x c` supercells, `[100]`/`[010]`/`[001]` and validated arbitrary `[hkl]` directions, rotation/pan/zoom/reset, orthographic projection, atom selection, raw/free force arrows, strongest-component highlighting, and selected/hovered directional `T/F` glyphs.

- [ ] **Step 4: Verify and commit the structure viewer**

Run: `cd vscode && pnpm test -- scene.test.tsx CrystalPanel.test.tsx && pnpm typecheck && pnpm build`

Expected: unit cell, skewed axes, periodic bonds, supercell identity, camera presets, atom details, directional constraints, force scaling, and disposal tests PASS.

```bash
git add vscode/webview/src/renderers vscode/webview/src/features/structure
git commit -m "feat: add crystallographic structure viewer"
```

### Task 13: Synchronize Convergence Views and Add the Data Fallback

**Files:**
- Create: `vscode/webview/src/features/convergence/{analysisSeries,ConvergencePanel,IonicStepControl,UPlotChart}.ts*`
- Create corresponding `*.test.ts` and `*.test.tsx` files under `vscode/webview/src/features/convergence/`.
- Create: `vscode/webview/src/features/fallback/{DataTableFallback,DataTableFallback.test}.tsx`
- Modify: `vscode/webview/src/App.tsx`

**Interfaces:**
- Consumes: Task 11 store and Task 12 structure panel.
- Produces: synchronized energy/force charts and values, a single ionic-step control, reduced-motion transitions, and non-WebGL fallback.

- [ ] **Step 1: Write failing synchronization and fallback tests**

```typescript
it("selecting a force point updates structure slider and exact values", async () => {
  render(<App host={twoStepHost} rendererFactory={fakeRendererFactory} />);
  await user.click(screen.getByLabelText("Force at ionic step 2"));
  expect(screen.getByLabelText("Ionic step")).toHaveValue("1");
  expect(fakeRenderer.setStructure).toHaveBeenLastCalledWith(expect.objectContaining({stepIndex: 1}));
  expect(screen.getByText("-0.250000 eV")).toBeVisible();
});

it("keeps missing constraint-aware metrics as chart gaps", () => {
  expect(forceSeries(datasetWithUnknownMasks)[0].value).toBeNull();
});

it("keeps parsed data usable after WebGL failure", () => {
  render(<App host={twoStepHost} rendererFactory={() => { throw new Error("WebGL unavailable"); }} />);
  expect(screen.getByRole("table", {name: "Atomic positions and forces"})).toBeVisible();
  expect(screen.getByLabelText("Ionic step")).toBeEnabled();
});
```

- [ ] **Step 2: Verify RED**

Run: `cd vscode && pnpm test -- analysisSeries ConvergencePanel IonicStepControl DataTableFallback`

Expected: FAIL because convergence and fallback features are absent.

- [ ] **Step 3: Implement synchronized accessible convergence UI**

```typescript
export const forceSeries = (dataset: CalculationDataset): PlotPoint[] =>
  dataset.ionicSteps.map(step => ({
    step: step.index,
    value: step.strongestFreeComponent?.magnitude ?? null,
    ariaLabel: step.strongestFreeComponent
      ? `Force at ionic step ${step.index + 1}: ${step.strongestFreeComponent.magnitude} eV per angstrom`
      : `Force at ionic step ${step.index + 1}: unavailable`,
  }));
```

The slider, plots, renderer, and exact panel dispatch one `selectStep`. Preserve missing values as gaps. Animate coordinates/arrows for 150 ms only when reduced motion is off. `DataTableFallback` shows site, element, positions, raw/free forces, and `T/F/?` flags. Reserve disabled `DOS/PDOS`, `Band`, and `Charge` tabs; define plotting and volumetric layer contracts without implementing those analyses.

- [ ] **Step 4: Verify offline bundles, behavior, and commit**

Run: `cd vscode && pnpm test && pnpm typecheck && pnpm build && rg -n "(src|href)=[\"']https?://|fetch\([\"']https?://" dist`

Expected: tests/typecheck/build PASS; URL scan returns no runtime network references.

```bash
git add vscode/webview vscode/package.json vscode/esbuild.mjs
git commit -m "feat: add synchronized crystal analysis Webview"
```

### Task 14: Package Browser Fallback, CI, Documentation, and Acceptance

**Files:**
- Create: `src/vasp_analyzer/transport/web.py`
- Create: `tests/integration/test_web.py`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `vscode/README.md`
- Modify: `pyproject.toml`
- Modify: `vscode/esbuild.mjs`

**Interfaces:**
- Consumes: Webview bundle, `CalculationSession`, CLI router.
- Produces: loopback browser mode, distributable wheel/VSIX, Linux/Windows gates, final Remote SSH acceptance.

- [ ] **Step 1: Write failing loopback and path-safety tests**

```python
def test_web_fallback_serves_offline_dataset(two_step_calculation: Path) -> None:
    client = TestClient(create_web_app(two_step_calculation))
    assert client.get("/api/dataset").json()["schemaVersion"] == 1
    assert "https://" not in client.get("/").text


def test_static_assets_cannot_escape_root(two_step_calculation: Path) -> None:
    client = TestClient(create_web_app(two_step_calculation))
    assert client.get("/assets/../../POSCAR").status_code in {400, 404}
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/integration/test_web.py -v`

Expected: FAIL because `transport.web` is absent.

- [ ] **Step 3: Implement loopback-only hosting and package built assets**

```python
def create_web_app(path: Path) -> FastAPI:
    session = CalculationSession(path)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.get("/api/dataset")(lambda: session.load().model_dump(mode="json", by_alias=True))
    app.mount("/assets", StaticFiles(directory=asset_root(), check_dir=True), name="assets")
    app.get("/", response_class=FileResponse)(lambda: asset_root() / "index.html")
    return app


def run_web(path: Path, port: int, open_browser: bool) -> None:
    selected = reserve_loopback_port() if port == 0 else port
    url = f"http://127.0.0.1:{selected}"
    typer.echo(url)
    if open_browser:
        webbrowser.open(url)
    uvicorn.run(create_web_app(path), host="127.0.0.1", port=selected, log_level="warning")
```

Package `vscode/dist/webview` into `vasp_analyzer/web_assets` in the wheel/sdist. Never bind a non-loopback address.

```toml
[tool.hatch.build.targets.wheel.force-include]
"vscode/dist/webview" = "vasp_analyzer/web_assets"

[tool.hatch.build.targets.sdist]
include = ["src", "vscode/dist/webview", "README.md", "pyproject.toml"]
```

- [ ] **Step 4: Add Linux/Windows CI**

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
      - run: python -m pytest -m "not corpus" --cov=vasp_analyzer
  webview:
    strategy:
      matrix: {os: [ubuntu-latest, windows-latest]}
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: {node-version: 24, cache: pnpm, cache-dependency-path: vscode/pnpm-lock.yaml}
      - run: pnpm install --frozen-lockfile
        working-directory: vscode
      - run: pnpm test && pnpm typecheck && pnpm build
        working-directory: vscode
```

- [ ] **Step 5: Document install, privacy, profiles, recovery, and corpus use**

Document `pipx install vasp-analyzer`, VSIX installation, all CLI forms, new-terminal requirement after extension installation, exact TOML schema/example, fail-closed behavior, incomplete-tail semantics, unknown constraints, browser fallback, offline assets, disabled 0.1.0 DOS/band/charge tabs, `VASP_ANALYZER_CORPUS_DIR`, and the guarantee that raw calculations/absolute paths are not committed or emitted in reports.

- [ ] **Step 6: Run final automated acceptance**

```bash
python -m pytest -m "not corpus" -v
python -m ruff check src tests
cd vscode
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm exec vsce package --no-dependencies
cd ..
python -m build
git status --short
```

Expected: all repository-safe Python/TypeScript tests PASS; Ruff/typecheck/build PASS; wheel, sdist, and VSIX are created; Git shows no caches, root VASP output, raw corpus file, report, or absolute-path artifact.

- [ ] **Step 7: Run actual corpus and manual Remote SSH acceptance**

Run: `python -m pytest -m corpus tests/corpus -v` with `VASP_ANALYZER_CORPUS_DIR` already set outside the repository.

Expected: exact corpus acceptance from Task 8: 52 home-barrier files, 50 structural files, 12,909 blocks, 38 complete, 14 incomplete, maximum 3,000 steps.

Then install the built wheel with `pipx`, install the VSIX, reload Remote SSH, open a new integrated terminal, and verify: `analyzer` opens a Webview without a port; Explorer and Command Palette open an OUTCAR; step/site selection synchronizes all views; periodic images retain site identity; fixed components do not win free-force metrics; an incomplete file shows its last valid step and warning; Webview reload restores state; disabled network still renders; forced WebGL failure leaves the data table usable.

- [ ] **Step 8: Commit the releasable first version**

```bash
git add pyproject.toml src/vasp_analyzer/transport/web.py tests/integration/test_web.py .github/workflows/ci.yml README.md vscode/README.md vscode/esbuild.mjs
git commit -m "docs: package and validate VASP analyzer"
```

---

## Final Verification Checklist

- [ ] Tasks 1-14 each have an observed RED, focused GREEN, full relevant suite, Ruff/typecheck gate, and reviewable commit.
- [ ] Commits `abadf13` and `4b358e7` remain represented by migrated and expanded model/discovery tests.
- [ ] Public Python imports use only `core/`, `calculation/`, `parsing/`, `structure/`, `convergence/`, `transport/`, and `cli/` feature packages.
- [ ] pymatgen is confined to normalized POSCAR/CONTCAR adapters; ASE 3.29+ is confined to OUTCAR trajectory conversion.
- [ ] Profiles are declarative, schema-versioned, fail-closed, and incapable of executing code.
- [ ] Recovery emits only validated complete force blocks, retains a structure lacking energy, warns on partial tails, and resumes from verified offsets only for append-only sources.
- [ ] Real corpus validation reports the current 52/50/12,909/38/14/3,000 counts without committing raw files, reports, or absolute paths.
- [ ] Root VASP files and all Python/test/cache artifacts remain ignored.
- [ ] `CalculationDataset.source_files` and all domain models are immutable.
- [ ] One selected-step/site identity drives structure, forces, plots, exact values, and future analysis seams.
- [ ] JSON method names are exactly `getDataset`, `getStep`, and reserved `getVolumetric`.
- [ ] Webview assets are bundled, Remote SSH uses stdio with authenticated handoff, and browser mode binds only `127.0.0.1`.
- [ ] DOS/band/volumetric contracts are tested while their implementation packages and full UIs remain deferred.
- [ ] Final `git status --short` is clean before using the branch-completion workflow.
