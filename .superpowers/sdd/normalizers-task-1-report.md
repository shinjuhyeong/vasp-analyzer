# Normalizer Task 1 Report

## Scope

Implemented the schema-version-1 strict JSON model boundary, public errors/API,
checked-in JSON Schema resource, exact `vaspparser` dependency pin, and Hatch
wheel/sdist resource contracts. `release-current/` and unrelated UI files were
not modified.

## TDD evidence

### RED

After adding `tests/unit/normalizers/test_models.py`, ran:

```text
python -m pytest tests/unit/normalizers/test_models.py -q
```

Collection failed as required with:

```text
ModuleNotFoundError: No module named 'vasp_analyzer.normalizers'
1 error in 1.56s
```

### GREEN

After the minimal model implementation and schema resource were added:

```text
python -m pytest tests/unit/normalizers/test_models.py -q
................
16 passed in 1.40s
```

The tests cover schema-1 acceptance and frozen tuple conversion; unknown keys;
unsupported/regex-like field operations; duplicate column names; invalid emit
references; non-ASCII, control-containing, and empty detection literals; unsafe
suffixes; column-type-specific properties; and exact checked-in schema equality.

## Dependency compatibility evidence

Inspected the metadata in the published `vaspparser-0.0.7-py3-none-any.whl`:

```text
Requires-Python: <3.15,>=3.9
Requires-Dist: ase<=3.29.0,>=3.23.0
Requires-Dist: numpy<=2.5.1,>=1.26.0
```

The existing `ase>=3.29` constraint intersects at ASE 3.29.0, so it was retained
instead of being casually downgraded. The existing `numpy>=2.2` constraint also
has a compatible range.

## Static and build evidence

```text
python -m ruff check src tests
All checks passed!

python -m build --wheel
Successfully built vasp_analyzer-0.1.0-py3-none-any.whl

python -m build --sdist
Successfully built vasp_analyzer-0.1.0.tar.gz
```

Wheel inspection found:

```text
vasp_analyzer/normalizers/definitions/schema.json
Requires-Dist: vaspparser==0.0.7
```

Sdist inspection found:

```text
vasp_analyzer-0.1.0/src/vasp_analyzer/normalizers/definitions/schema.json
```

`git diff --check` exited 0.
