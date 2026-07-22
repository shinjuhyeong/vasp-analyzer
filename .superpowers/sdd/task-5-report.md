# Task 5 Report: Discriminated Frame Selection

## Status

Complete. Persisted analysis state is v4 and carries a discriminated `selectedFrame`, ionic `comparisonTarget`, and independent `displacementScale`. Host-boundary migration maps every legacy numeric `selectedStep` to `{ kind: "ionic", index: selectedStep }`.

## RED evidence

Command (with the bundled Node runtime added to `PATH`):

`pnpm --dir vscode test -- core/store.test.ts core/host.test.ts core/runtimeHost.test.ts`

Result before implementation: exit 1; 10 failed, 300 passed. The failures were the expected missing v4 host migration/runtime persistence and missing reducer fields/actions (`selectedFrame`, Initial availability normalization, comparison target, Compare behavior, and displacement scale).

The first attempt did not start Vitest because `node` was absent from the inherited `PATH`; rerunning with `C:\Users\tlswn\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` produced the RED result above.

## GREEN evidence

Fresh final commands:

- `pnpm --dir vscode test -- core/store.test.ts core/host.test.ts core/runtimeHost.test.ts` — exit 0; 30 files passed, 310 tests passed. (The repository test script runs the full suite despite the trailing file arguments.)
- `pnpm --dir vscode typecheck` — exit 0.
- `git diff --check` — exit 0; only existing Git line-ending conversion warnings.

A directly focused Vitest run also passed: 3 files, 94 tests.

## Implementation notes / self-review

- v3 and older numeric selections migrate only to ionic frames; they never infer Initial.
- Initial survives dataset normalization only when `initialStructure` exists; otherwise it becomes ionic index 0.
- Ionic frame and comparison target indices clamp to the loaded trajectory.
- Compare can be enabled only while Initial is selected and is disabled on transition to an ionic frame.
- Displacement and force scales normalize independently to 1..1000.
- Persistence serialization and test fixtures received minimal v4 updates to keep the required whole-project typecheck and suite green; no Initial/Compare controls or Crystal rendering were wired.
- The reducer retains a documented numeric `selectedStep` compatibility projection and `selectStep` adapter for the existing ionic-only App. `selectedFrame` is the authoritative persisted/frame state; later UI wiring can remove the adapter.

## Files

Core contracts, store, host migration, runtime host tests, and the minimal App persistence/test-fixture compatibility updates described above.

## P1 review fix: dataset-load purity

### RED

Added a sequential reducer regression that loads host A with explicit Initial selection, Compare enabled, non-default frame/force scales, target, site, layout, force mode, and convergence modules, then loads host B without persisted state.

Command: `pnpm --dir vscode exec vitest run src/webview/core/store.test.ts`

Result: exit 1; 1 failed, 18 passed. The canonical-state assertion showed leaked `comparisonTarget`, `displacementScale`, `forceMode`, `forceScale`, `layout`, `selectedSite`, and convergence modules from host A.

### GREEN

Changed `datasetLoaded` to derive all normalized fields exclusively from `initialAnalysisState`, optional persisted v4 input, and the loaded dataset. It never consults prior reducer state, and always resets the transient `compareEnabled` flag to false.

Fresh verification:

- `pnpm --dir vscode exec vitest run src/webview/core/store.test.ts src/webview/core/host.test.ts src/webview/core/runtimeHost.test.ts` — exit 0; 3 files passed, 95 tests passed.
- `pnpm --dir vscode typecheck` — exit 0.
- `git diff --check` — exit 0; only Git line-ending conversion warnings.

### Self-review

The fix is localized to the reducer normalization boundary. Persisted values still receive the existing dataset-aware clamps and canonical normalization, while an absent persisted value uses viewer-safe defaults. Compare cannot leak because it is deliberately non-persisted and reset on every dataset load.
