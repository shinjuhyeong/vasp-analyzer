# Effective OUTCAR Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract clean typed effective OUTCAR parameter values and units while making all parameter-metadata failures non-fatal to trajectory loading.

**Architecture:** Keep VaspParser as the sole trajectory parser and retain the existing `ParameterOccurrence` wire model. Replace annotation-heavy value coercion with a focused leading-expression interpreter, then harden the streaming metadata boundary so any ordinary scan failure becomes a bounded warning and an empty or partial parameter result.

**Tech Stack:** Python 3.11+, Pydantic, pytest, React/TypeScript, Vitest, VaspParser 0.0.7.

## Global Constraints

- Keep VaspParser as the only authoritative trajectory parser.
- Preserve `ParameterOccurrence` and wire schema 4; do not require a transport migration.
- Preserve complete `rawKey` and `rawValue` text and ordered occurrences for Raw Parameters.
- The final occurrence of a canonical key is the effective value.
- Parameter or Pulay metadata failure must never veto an otherwise valid trajectory.
- Metadata warnings must be bounded and must not expose full paths or unbounded source text.
- Do not swallow `MemoryError`, `KeyboardInterrupt`, or `SystemExit`.
- Real audit inputs under `C:\Users\tlswn\Documents\YBCO6.5\audit-input` are verification-only and must never be committed.
- Preserve the fixed ionic-slider Chromium coordinate and existing normalizer source-safety guarantees.

---

### Task 1: Leading Parameter Value Interpreter

**Files:**
- Modify: `src/vasp_analyzer/parsing/recovery/details.py`
- Modify: `tests/unit/parsing/recovery/test_details.py`
- Test: `tests/unit/parsing/recovery/test_details.py`

**Interfaces:**
- Consumes: raw assignment bytes passed to `parse_parameter_assignments(line, start_ordinal=0, line_number=None)`.
- Produces: existing `ParameterOccurrence` instances whose `value` is `bool | int | float | str | tuple[float, ...]` and whose `unit` is normalized or semantic.

- [ ] **Step 1: Write failing scalar and annotation tests**

Add parameterized tests equivalent to:

```python
@pytest.mark.parametrize(
    ("line", "value", "unit"),
    [
        (b" ISPIN = 1 spin polarized calculation?\n", 1, None),
        (b" ENCUT = 600.0 eV 44.10 Ry 6.64 a.u.\n", 600.0, "eV"),
        (b" EDIFFG = -.1D-01 stopping-criterion for IOM\n", -0.01, "eV/angstrom"),
        (b" LREAL = F real-space projection\n", False, None),
        (b" MAGMOM = 1 1 0 0\n", (1.0, 1.0, 0.0, 0.0), None),
    ],
)
def test_parameter_interpreter_uses_leading_value_expression(
    line: bytes,
    value: object,
    unit: str | None,
) -> None:
    occurrence = parse_parameter_assignments(line)[0]
    assert occurrence.value == value
    assert occurrence.unit == unit
    assert occurrence.raw_value == line.split(b"=", 1)[1].decode().strip()
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m pytest tests/unit/parsing/recovery/test_details.py -q
```

Expected: the new cases fail because annotated values remain strings and `D` notation or numeric vectors are not interpreted as specified.

- [ ] **Step 3: Implement a bounded leading-expression interpreter**

In `details.py`, introduce focused private helpers with these contracts:

```python
def _leading_parameter_value(
    raw: bytes,
    *,
    key: str,
) -> tuple[bool | int | float | str | tuple[float, ...], str | None]:
    """Interpret only the leading value expression and preserve unknown text."""

def _semantic_parameter_unit(
    key: str,
    value: bool | int | float | str | tuple[float, ...],
    explicit_unit: str | None,
) -> str | None:
    """Return a normalized explicit unit or a known parameter semantic unit."""
```

Implementation requirements:

- tokenize no more than the already bounded logical line;
- accept finite `E`/`D` scientific notation and `-.1E-01`;
- distinguish exact `T`/`F`, integer, scalar float, and a contiguous numeric vector;
- stop a numeric expression at the first explanatory token or secondary conversion;
- normalize exact supported explicit spellings to `eV`, `eV/angstrom`, `K`, `fs`, or `kB`;
- use existing parameter metadata for `ENCUT`, `EDIFF`, and sign-sensitive `EDIFFG`;
- preserve unknown leading text as a bounded decoded string;
- reject non-finite numeric values with `OutcarFormatError`.

Do not alter `raw_value`, source ordering, ordinal, category, or description.

- [ ] **Step 4: Add failing ambiguity and safety tests**

Cover:

```python
def test_option_legend_is_not_a_numeric_vector() -> None:
    item = parse_parameter_assignments(
        b" ICHARG = 2 charge: 1-file 2-atom 10-const\n"
    )[0]
    assert item.value == 2


def test_unknown_home_value_remains_string() -> None:
    item = parse_parameter_assignments(b" HOME_MODE = alpha-beta custom mode\n")[0]
    assert item.value == "alpha-beta custom mode"


@pytest.mark.parametrize("token", [b"nan", b"inf", b"-inf"])
def test_nonfinite_leading_number_is_rejected(token: bytes) -> None:
    with pytest.raises(OutcarFormatError, match="non-finite"):
        parse_parameter_assignments(b" CUSTOM = " + token + b"\n")
```

Run the focused tests once to observe the intended failures, implement the minimum disambiguation/non-finite checks, then rerun until green.

- [ ] **Step 5: Run focused and parser regression gates**

Run:

```powershell
python -m pytest tests/unit/parsing/recovery/test_details.py tests/unit/parsing/adapters -q
python -m ruff check src/vasp_analyzer/parsing tests/unit/parsing
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/vasp_analyzer/parsing/recovery/details.py tests/unit/parsing/recovery/test_details.py
git commit -m "feat: interpret effective OUTCAR parameters"
```

---

### Task 2: Non-Fatal Metadata Boundary

**Files:**
- Modify: `src/vasp_analyzer/parsing/outcar_metadata.py`
- Modify: `src/vasp_analyzer/calculation/dataset.py`
- Modify: `tests/integration/test_dataset.py`
- Create or modify: `tests/unit/parsing/test_outcar_metadata.py`

**Interfaces:**
- Consumes: `read_outcar_metadata(path: Path, rule: OutcarRule)`.
- Produces: `OutcarMetadata(parameters=..., pressure_details=..., warnings=...)` under all ordinary metadata failures; only control-flow and memory exceptions escape.

- [ ] **Step 1: Write failing line-level recovery tests**

Create tests using a temporary OUTCAR metadata stream:

```python
def test_malformed_assignment_warns_and_later_parameter_survives(tmp_path: Path) -> None:
    path = tmp_path / "OUTCAR"
    path.write_bytes(
        b" Startparameter for this run:\n"
        b" BROKEN =\n"
        b" ENCUT = 520 eV plane-wave cutoff\n"
        b" Dimension of arrays:\n"
    )
    result = read_outcar_metadata(path, STANDARD_RULE)
    assert [item.raw_key for item in result.parameters] == ["ENCUT"]
    assert result.parameters[0].value == 520
    assert any(w.category == "MetadataParseFailure" for w in result.warnings)
```

Also cover undecodable bytes, a logical line exceeding 1 MiB, and a malformed pressure line followed by valid metadata.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m pytest tests/unit/parsing/test_outcar_metadata.py -q
```

Expected: at least the stream-level and undecodable recovery cases fail under the current boundary.

- [ ] **Step 3: Make the metadata reader fail-soft**

Refactor `read_outcar_metadata` so that:

- per-line `AnalyzerError`, `UnicodeError`, and ordinary value/type errors produce one bounded warning and scanning continues;
- open/read failures at the outer boundary return empty metadata plus one bounded warning;
- an unexpected ordinary `Exception` at this optional metadata boundary becomes one bounded warning;
- `MemoryError`, `KeyboardInterrupt`, and `SystemExit` propagate;
- warning messages are capped at 512 printable characters and contain no absolute path;
- the existing 1 MiB logical-line limit remains;
- Pulay record-count mismatch continues to yield all-`None` Pulay values rather than shifted values.

Use a small helper:

```python
def _bounded_metadata_warning(message: str, line_number: int | None = None) -> ParserWarning:
    safe = "".join(ch for ch in message if ch.isprintable())[:512]
    return ParserWarning(
        category="MetadataParseFailure",
        message=safe or "OUTCAR metadata could not be interpreted",
        line_number=line_number,
    )
```

- [ ] **Step 4: Write a failing dataset-level non-blocking test**

Monkeypatch only the optional metadata boundary:

```python
def test_parameter_scan_failure_does_not_block_valid_trajectory(
    valid_calculation: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_metadata(*_args: object, **_kwargs: object) -> OutcarMetadata:
        raise OSError("private absolute path must not escape")

    monkeypatch.setattr(dataset_module, "read_outcar_metadata", fail_metadata)
    dataset = load_dataset(valid_calculation)
    assert dataset.ionic_steps
    assert dataset.parameters == ()
    assert any(w.category == "MetadataParseFailure" for w in dataset.warnings)
    assert all("private absolute path" not in w.message for w in dataset.warnings)
```

Verify it fails before changing dataset orchestration.

- [ ] **Step 5: Isolate the metadata call in dataset assembly**

Add a narrow wrapper in `dataset.py`:

```python
def _optional_outcar_metadata(path: Path, rule: OutcarRule) -> OutcarMetadata:
    try:
        return read_outcar_metadata(path, rule)
    except MemoryError:
        raise
    except Exception:
        return OutcarMetadata(
            warnings=(
                ParserWarning(
                    category="MetadataParseFailure",
                    message="OUTCAR parameter metadata is unavailable",
                ),
            )
        )
```

Use this wrapper before the normalizer/VaspParser path. Do not change trajectory error behavior.

- [ ] **Step 6: Verify metadata, dataset, session, and transport gates**

Run:

```powershell
python -m pytest tests/unit/parsing/test_outcar_metadata.py tests/integration/test_dataset.py tests/unit/calculation tests/unit/transport -q
python -m ruff check src tests
git diff --check
```

Expected: all pass and the new dataset-level failure test still returns ionic steps.

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/vasp_analyzer/parsing/outcar_metadata.py src/vasp_analyzer/calculation/dataset.py tests/unit/parsing/test_outcar_metadata.py tests/integration/test_dataset.py
git commit -m "fix: isolate optional OUTCAR metadata failures"
```

---

### Task 3: UI Semantics, Real Files, and Release Verification

**Files:**
- Modify: `vscode/src/webview/features/parameters/ParametersPanel.tsx`
- Modify: `vscode/src/webview/features/parameters/ParametersPanel.test.tsx`
- Modify: `tests/unit/test_audit_outcar.py`
- Modify: `scripts/verify_installed_wheel.py`
- Modify: `tests/unit/test_installed_wheel_smoke.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: unchanged wire-schema-4 `ParameterOccurrence[]`.
- Produces: interpreted final values by default, diagnostic raw occurrences on demand, and release evidence that metadata failure cannot block a valid installed-wheel dataset.

- [ ] **Step 1: Write failing Parameters UI tests**

Add component cases asserting:

```typescript
it("shows clean final typed values while preserving annotated raw text", async () => {
  render(<ParametersPanel parameters={[
    { key: "encut", rawKey: "ENCUT", rawValue: "400 eV old cutoff", value: 400, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 0, lineNumber: 10 },
    { key: "encut", rawKey: "ENCUT", rawValue: "600.0 eV 44.10 Ry", value: 600, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 1, lineNumber: 20 },
  ]} />);
  expect(screen.getByRole("cell", { name: "600" })).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Raw parameters" }));
  expect(screen.getByText("600.0 eV 44.10 Ry")).toBeVisible();
});
```

Add an empty-parameters case whose text explicitly says parameter metadata is unavailable but other analysis remains usable.

- [ ] **Step 2: Verify RED, then update only the empty-state/origin copy needed**

Run:

```powershell
$env:PATH='C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm --prefix vscode test -- --run src/webview/features/parameters/ParametersPanel.test.tsx
```

Expected: the new non-fatal empty-state wording fails. Keep the existing effective-last-occurrence algorithm; change only user-facing copy necessary to make the failure semantics clear.

- [ ] **Step 3: Add real-file parameter quality assertions**

For both private audit files, collect effective parameters and assert:

- official: 200 ionic steps and 6 atoms;
- home: 35 ionic steps and 25 atoms;
- `ENCUT`, `ISPIN`, `IBRION`, `NSW`, `EDIFF`, and `EDIFFG` are typed when present;
- annotated examples do not retain prose in `value`;
- known units match the design;
- source SHA-256 is unchanged;
- parameter warnings do not prevent dataset creation.

The tests must skip with an explicit reason when private audit files are absent and must never copy them into the repository.

- [ ] **Step 4: Extend installed-wheel smoke**

Make the installed-wheel verification run one valid fixture containing annotated parameters and assert the stdio dataset JSON contains clean typed values. Add a separate injected/fixture metadata failure path only if it can be exercised without private files; otherwise retain it in the Python integration gate and document that division.

- [ ] **Step 5: Update README**

Document:

- Parameters are parsed by an analyzer-owned optional metadata reader, not VaspParser;
- VaspParser remains the sole trajectory parser;
- the Interpreted view shows the final occurrence with typed value and normalized unit;
- the Raw view preserves all source occurrences;
- parameter scan errors yield warnings and never block an otherwise valid OUTCAR.

- [ ] **Step 6: Run complete verification**

Run:

```powershell
python -m pytest -q
python -m ruff check src tests scripts
$env:PATH='C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm --prefix vscode test -- --run
npm --prefix vscode run typecheck
npm --prefix vscode run build
npm --prefix vscode run test:layout
python -m build
python scripts/verify_release_artifacts.py
git diff --check
```

Expected:

- all configured tests pass;
- only documented platform/corpus skips remain;
- Chromium ionic-slider x-coordinate remains `339.046875` at 1280 px and 640 px;
- wheel, sdist, and VSIX contracts pass.

- [ ] **Step 7: Install and verify final artifacts**

Create a fresh temporary virtual environment, force-install the exact wheel, and run:

```powershell
analyzer --help
analyzer normalizer list
analyzer normalizer validate <candidate-json>
analyzer normalizer test <candidate-json> <valid-fixture-OUTCAR>
```

Install the rebuilt VSIX with:

```powershell
code --install-extension vscode/vasp-analyzer-0.1.0.vsix --force
```

Record SHA-256 hashes for wheel, sdist, and VSIX. Verify both private OUTCAR source hashes remain unchanged.

- [ ] **Step 8: Commit Task 3**

```powershell
git add README.md scripts/verify_installed_wheel.py tests/unit/test_installed_wheel_smoke.py tests/unit/test_audit_outcar.py vscode/src/webview/features/parameters/ParametersPanel.tsx vscode/src/webview/features/parameters/ParametersPanel.test.tsx
git commit -m "test: verify tolerant OUTCAR parameters"
```

Generated wheel, sdist, and VSIX files remain untracked release artifacts.
