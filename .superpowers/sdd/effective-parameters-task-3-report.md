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
  `67a69028dbb8273f4789520c426491b22ca9dc3cc9d551f53199ab37f1048e55`
- sdist SHA-256:
  `6bcd84d80245a4c4b8f98ef4351e51e76fe708e1e8ee8f5c99f328e95f02e0e0`
- VSIX SHA-256:
  `83f3f8f9d462101e13b1aea01acd6118f6a52ab1e8e1fdbe7b1677de89852428`

The VSIX was built and inspected but was not installed into the user's live
VS Code environment. Generated release artifacts remain untracked.
