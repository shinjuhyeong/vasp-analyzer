# Final Review Fixes — RED/GREEN/Final Report

## Scope

Implemented all five final-review items from base `bc79f13`:

1. Comparison displacement arrows are independent of the normal force-layer visibility.
2. Comparison cell-delta arrows are independent of the crystallographic axes-layer visibility, while axes still honor that layer.
3. The global comparison summary is always rendered during Compare, independently of atom selection and inspector collapse; atom detail remains conditional.
4. Append/resume coverage now cuts exactly after the complete third geometry-lattice row and verifies persisted `geometry_lattice_consumed` and `last_lattice` plus fresh-parse step equivalence.
5. The comparison target number control now uses a local draft and commits/clamps on blur or Enter; empty/invalid drafts restore without dispatch.

## RED

- Renderer regression: with `forces=false` and `axes=false`, neither cyan displacement nor orange cell-delta arrows was emitted (zero `addArrow` calls); the axis arrow was correctly absent.
- Inspector unit regression: a null site returned only `Comparison data unavailable for this site`; the accessible `Comparison summary` heading and global metrics were absent.
- CrystalPanel entry-state regression: Compare with `selectedSite=null` rendered no summary and exposed only the disabled `No atom selected` affordance.
- Toolbar interaction regression: clearing the controlled target number immediately restored value `1`, proving edits dispatched during typing instead of remaining as a draft.
- Parser exact-cut regression: before the scanner change, an exact cut after the third geometry lattice row rolled the checkpoint back instead of persisting `geometry_lattice_consumed=true`.

The first attempted Webview RED command did not execute because the bundled Node runtime was absent from `PATH`; subsequent Webview commands explicitly prepended `C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`.

## GREEN

- `ThreeDmolRenderer.drawComparison` always emits comparison displacement and cell-delta glyphs; only normal force arrows and crystallographic axes retain their existing layer policies.
- `ComparisonInspector` separates summary/detail modes. `CrystalPanel` mounts summary mode in the always-rendered crystal content and detail mode only for a selected atom.
- `CompactToolbar` keeps a string draft synchronized from committed target changes, clamps finite integers on blur/Enter, and restores empty/invalid drafts without dispatch.
- Scanner checkpoints treat a fully consumed geometry lattice as a resumable active-iteration boundary. The current geometry volume is persisted and restored into pending details so an append can continue at the exact row boundary without losing cell volume.

Focused GREEN evidence:

- Parser: `1 passed, 78 deselected`.
- Renderer/App/toolbar/inspector focus: `4 files passed`, `70 tests passed`.

## Final Verification

- Full Python: `435 passed, 4 skipped, 1 warning in 7.72s`.
- Ruff: `All checks passed!`.
- Full Webview/extension Vitest: `32 files passed`, `332 tests passed`.
- TypeScript: `tsc --noEmit` exited 0.
- Build: `node esbuild.mjs` exited 0.
- Whitespace: `git diff --check` exited 0.

Exact combined automated test total: **767 passed, 4 skipped, 1 warning**.

## Self-review

- Confirmed no new comparison visibility control or persisted-state contract was introduced.
- Confirmed disabling axes still suppresses red/green/blue crystallographic axes while orange cell deltas remain.
- Confirmed normal forces remain hidden during Compare and a previously disabled force layer cannot suppress cyan displacement arrows.
- Confirmed global drift appears in the global summary and atom-only fractional/Cartesian/rank/image-shift fields remain conditional.
- Confirmed toolbar dispatch occurs only for a changed, committed target; invalid/empty commit restores the current target.
- Confirmed the parser test uses a minimal geometry section so equivalence isolates the requested lattice checkpoint boundary.

## Known non-failures / concerns

- Four Python tests were skipped as expected: three require `VASP_ANALYZER_CORPUS_DIR`, and one requires symlink support.
- The single warning is an external Starlette/httpx deprecation warning from `fastapi.testclient`.
- Git reports the repository's normal LF-to-CRLF checkout warning on Windows; `git diff --check` is clean.

## Parser Re-review: Complete-Lattice Boundary With Scientific Details

### RED

The exact third-lattice-row regression was extended to the approved full sequence: ionic/electronic iteration counters, stress tensor, external and Pulay pressure, geometry banner, cell volume, and three complete lattice rows, followed later by the force block. At the cut, the prior EOF optimization advanced the checkpoint while persisting only lattice/volume/geometry flags. The resumed `StepRecord` therefore had `stress_tensor_kb=None`, `external_pressure_kb=None`, and `pulay_stress_kb=None`, while the fresh parse retained all three.

A second regression cuts the second geometry lattice after one completed ionic record to verify that safe replay starts at the prior verified record boundary and yields exactly `fresh.steps[1:]`.

### GREEN

The no-replay active-iteration boundary is now allowed after a consumed geometry lattice only when `next_details_are_only_volume()` is true. Scientific-detail bundles containing stress or pressure rewind to the existing verified boundary, matching the checkpoint schema instead of silently dropping unpersisted fields. The volume-only exact-cut path remains resumable and continues to restore its representable volume/lattice state.

### Results

- Focused append/resume selection: `8 passed, 81 deselected`.
- Full recovery scanner/checkpoint suite: `89 passed`.
- Full Python suite: `436 passed, 4 skipped, 1 warning in 6.95s`.
- Ruff: `All checks passed!`.
- `git diff --check`: exit 0.

The skips and warning are unchanged from the prior verification: corpus/symlink environment skips and the external Starlette/httpx deprecation warning.
