# Effective Parameters Task 3 Report

Status: DONE

## Scope

- Kept wire schema 4 and the existing final-occurrence algorithm.
- Added explicit nonfatal empty-state copy to the Parameters panel.
- Verified clean interpreted values and complete annotated raw occurrences.
- Added private-corpus quality checks without copying private OUTCAR bytes:
  tests create temporary same-volume hard links and re-hash the original source.
- Extended installed-wheel smoke with annotated `ENCUT`/`ISPIN` metadata.
- Documented that the analyzer-owned metadata reader is optional while
  VaspParser remains the sole trajectory parser.

## TDD evidence

RED:

- The new empty-state UI test failed because the panel said only
  `No parameters match the current view.`

GREEN:

- Focused Python tests: 13 passed.
- Focused and full Webview tests: 349 passed.

## Real-file evidence

| Input | Ionic steps | Atoms | Legacy typed/string occurrences | New typed/string occurrences | New typed/string effective keys |
|---|---:|---:|---:|---:|---:|
| official | 200 | 6 | 36 / 101 | 129 / 8 | 111 / 8 |
| home | 35 | 25 | 24 / 82 | 103 / 3 | 102 / 3 |

Both inputs yield typed `ENCUT`, `ISPIN`, `IBRION`, `NSW`, `EDIFF`, and
`EDIFFG`. `ENCUT` is normalized to eV, `EDIFF` to eV, and negative `EDIFFG`
to eV/angstrom. Prose such as `stopping-criterion` and alternate-unit text such
as `Ry` remains in `rawValue` but not in `value`.

Private source SHA-256 values remained unchanged:

- home: `d32e56941b708d1d102081e3593a4b6d956a0e1723192410c663de828d0b62f8`
- official: `2d6e65e0417b52243ddde6e22e6eeb9f428203aa082662acee7ca373a423190a`

## Complete gates

- Python: 640 passed, 7 skipped.
- Ruff: clean.
- Webview: 349 passed.
- TypeScript typecheck: passed.
- Webview/extension build: passed.
- Chromium layout: 2 passed; ionic slider x-coordinate was exactly
  `339.046875` at both 1280 px and 640 px.
- Wheel/sdist/VSIX release contract verification: passed.
- Fresh Python 3.13 virtual environment force-install of exact wheel: passed.
- Installed `analyzer --help`, normalizer list/validate/test, schema-4 stdio
  typed-parameter checks, and no-browser handoff smoke: passed.
- `git diff --check`: passed.

Documented skips:

- 3 local corpus tests because `VASP_ANALYZER_CORPUS_DIR` is unset.
- 2 Windows open-file replacement limitations.
- 2 unavailable symlink capability checks.

## Artifacts

- wheel SHA-256:
  `5b8ac98548e6a92a4d66f24a15ec8f36ffe546e974f535227fb4081d88a676eb`
- sdist SHA-256:
  `334e8db56b81f2a317e58a01d70274208f07ff586d9dc34caad6ac8454347ea4`
- VSIX SHA-256:
  `41b899b2fa7da790ada06ee06be11a047d5b0a56673d06f971df186d156b6714`

The VSIX was built and inspected but was not installed into the user's live
VS Code environment. Generated release artifacts remain untracked.

## Important-review fix: no-copy audit fallback

The initial private-corpus test used a temporary hard link and skipped if
`os.link` failed. That could hide an acceptance failure on a platform without
hard-link support.

RED:

```text
python -m pytest -q tests/unit/test_discovery.py tests/unit/test_audit_outcar.py
3 failed, 7 passed
```

The failures proved that descriptive `OUTCAR_official`/`OUTCAR_homever` paths
could not be loaded directly.

GREEN:

- Discovery now treats an explicitly selected existing file whose basename
  starts case-insensitively with `OUTCAR` as the exact OUTCAR path.
- Directory discovery and arbitrary selected-file sibling lookup are unchanged.
- `audit_outcar` parses the exact source path without copying, linking, or
  creating a temporary OUTCAR.
- The private test monkeypatches `os.link` to always raise and still runs both
  complete audits, typed-parameter checks, and before/after source hashes.

```text
python -m pytest -q tests/unit/test_discovery.py tests/unit/test_audit_outcar.py tests/integration/test_dataset.py
28 passed

python -m pytest -q
641 passed, 7 skipped

python -m ruff check src tests scripts
All checks passed!

python -m build
Successfully built vasp_analyzer-0.1.0.tar.gz and vasp_analyzer-0.1.0-py3-none-any.whl

pnpm --dir vscode run package
Packaged vasp-analyzer-0.1.0.vsix

python scripts/verify_release_artifacts.py --wheel ... --sdist ... --vsix ...
release artifact contracts passed

python scripts/verify_installed_wheel.py --fixture tests/fixtures/outcar/ase-complete-one-step.OUTCAR
installed wheel CLI, stdio, and no-browser smokes passed
```
