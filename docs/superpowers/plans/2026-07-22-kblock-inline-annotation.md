# KBLOCK Inline Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse annotated `KBLOCK` output as a typed integer without losing its original text or weakening malformed-input validation.

**Architecture:** Extend the pure parameter parser with a narrowly scoped known-tag coercion rule. Assignment boundaries remain driven by `KEY =` matches, and the immutable `ParameterOccurrence` schema remains unchanged.

**Tech Stack:** Python 3.11+, pytest, Ruff, Pydantic models

## Global Constraints

- Preserve exact `raw_value` text for source inspection.
- Only known integer tags `NBLOCK` and `KBLOCK` may discard trailing explanatory text when producing the typed value.
- Unknown mixed values remain strings.
- Malformed assignments continue to fail closed.

---

### Task 1: Reproduce and Fix Annotated KBLOCK Parsing

**Files:**
- Modify: `src/vasp_analyzer/parsing/recovery/details.py`
- Test: `tests/unit/parsing/recovery/test_details.py`

**Interfaces:**
- Consumes: `parse_parameter_assignments(line: bytes, *, start_ordinal: int = 0, line_number: int | None = None) -> tuple[ParameterOccurrence, ...]`
- Produces: `ParameterOccurrence(value=3000, raw_value="3000    inner block; outer block")` for the reported `KBLOCK` assignment.

- [x] **Step 1: Write the failing regression test**

```python
def test_parameter_parser_extracts_known_integer_before_inline_annotation() -> None:
    parsed = parse_parameter_assignments(
        b"   NBLOCK =      1;   KBLOCK =   3000    inner block; outer block \n"
    )

    assert [(item.key, item.value) for item in parsed] == [
        ("nblock", 1),
        ("kblock", 3000),
    ]
    assert parsed[1].raw_value == "3000    inner block; outer block"
```

- [x] **Step 2: Run the regression test and verify RED**

Run: `python -m pytest tests/unit/parsing/recovery/test_details.py::test_parameter_parser_extracts_known_integer_before_inline_annotation -q`

Expected: fail with `OutcarFormatError: parameter assignment is malformed`.

- [x] **Step 3: Implement the minimal known-tag annotation rule**

Add a private known-integer-tag set and pass the canonical key into parameter coercion. Preserve `raw_value`, parse the first integer token for `NBLOCK`/`KBLOCK`, and allow an interior semicolon only in that recognized annotated form. Retain rejection of empty values, extra equals signs, leading semicolons, and repeated empty separators.

- [x] **Step 4: Run focused and full verification**

Run:

```text
python -m pytest tests/unit/parsing/recovery/test_details.py -q
python -m pytest -q
python -m ruff check src tests
```

Expected: all tests pass and Ruff reports no errors.

- [x] **Step 5: Commit the focused fix**

```text
git add docs/superpowers/specs/2026-07-22-kblock-inline-annotation-design.md docs/superpowers/plans/2026-07-22-kblock-inline-annotation.md tests/unit/parsing/recovery/test_details.py src/vasp_analyzer/parsing/recovery/details.py
git commit -m "fix: parse annotated KBLOCK parameters"
```
