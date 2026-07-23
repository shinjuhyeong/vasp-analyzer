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

## Review-finding corrections

### Focused RED

Added review tests first and ran:

```text
python -m pytest tests/unit/normalizers/test_models.py -q
16 failed, 19 passed
```

The failures directly exposed the rejected canonical `localIndex`, accepted
non-printable bytes, coercive priority/schema-name behavior, and missing public
schema constraints.

### Naming policy

Canonical JSON examples use lowerCamel column names such as `localIndex`.
Snake-case names such as `local_index` remain accepted for user-authored
definitions. Both are constrained to at most 64 ASCII identifier characters,
must start with a lowercase letter, and cannot mix arbitrary punctuation or
unsafe separators.

### Strict JSON and printable-byte policy

`model_validate_json` now accepts alias JSON keys only. Python field-name
alternatives such as `schema_version` are rejected at this public boundary.
Priority uses a strict integer contract, so strings, floats, and booleans do not
coerce. Detection literals and block `containsAll` literals accept only bytes
from printable ASCII `0x20..0x7e`; focused tests include NUL, other C0 controls,
tab, newline, `0x1f`, DEL, and non-ASCII text.

### Public schema policy

Representable constraints are emitted in `schema.json`, including string
patterns and bounds, array `minItems`, `uniqueItems`, and numeric bounds.
Cross-field checks cannot be expressed by ordinary JSON Schema keywords, so the
public schema declares the extension
`x-vasp-analyzer-semantic-validations`, naming:

- `ruleIdsUnique`
- `columnNamesUniqueWithinRule`
- `emitReferencesDeclaredColumns`
- `textColumnsNotEmitted`

Runtime tests cover these semantics, while direct schema assertions cover the
representable constraints and extension contract. The exact checked-in resource
continues to be compared with `NormalizerDefinition.model_json_schema()`.

### Review GREEN and final build evidence

```text
python -m pytest tests/unit/normalizers/test_models.py -q
35 passed in 1.38s

python -m ruff check src tests
All checks passed!

python -m build --wheel --sdist
Successfully built vasp_analyzer-0.1.0-py3-none-any.whl and
vasp_analyzer-0.1.0.tar.gz

wheel/sdist schema resources and exact dependency contract: OK
```

The final programmatic artifact check parsed the packaged schema JSON, verified
it exists in both wheel and sdist, and verified wheel metadata still contains
`Requires-Dist: vaspparser==0.0.7`. Final `git diff --check` exited 0.
