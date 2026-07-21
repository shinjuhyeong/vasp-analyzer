# Viewer Workspace and VS Code Extension Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `analyzer OUTCAR` reliably open a compact, resizable crystal viewer inside a Remote SSH VS Code editor tab, with direct ionic-step and 1×–1000× force controls.

**Architecture:** Repair the packaged CommonJS extension boundary first, then extend the authenticated handoff with an optional declarative profile path and remove implicit browser fallback. Split Webview behavior into focused controls and layout components backed by a versioned persisted-state contract; keep rendering and scientific datasets unchanged.

**Tech Stack:** Python 3.11+, Typer, Pydantic, pytest, TypeScript, React 19, Vitest, Testing Library, esbuild, VS Code Extension API, 3Dmol.js, pnpm 11.9.

## Global Constraints

- Default `analyzer OUTCAR` must open a VS Code editor panel or fail with actionable instructions; it must not launch a browser implicitly.
- Browser mode remains available only through explicit `--web`, `--port`, or `--no-open` options and stays loopback-only.
- The extension host entrypoint is CommonJS at `dist/extension.cjs`; the Webview remains an IIFE at `dist/webview/index.js`.
- The VS Code extension remains a workspace extension compatible with Remote SSH and launches child processes without a shell.
- Compatibility profiles remain strict data-only TOML. An optional profile is passed as a canonical path, never as executable content.
- Ionic-step UI is 1-based `current / total`, but the shared store continues to hold a zero-based array index.
- Force scale range is exactly 1×–1000×, logarithmic in the slider, with a 10× default.
- The crystal palette starts collapsed, remains bounded inside the structure viewport, and persists its position and collapsed state.
- Structure/convergence height and atom-inspector width are pointer- and keyboard-resizable; full-screen mode is session-only and restores the prior layout.
- Layout state never enters calculation datasets, parser cache keys, or scientific model types.
- Every production change follows a witnessed RED–GREEN cycle; run `git diff --check` before each commit.

## File Structure

### New files

- `tests/unit/transport/test_handoff.py` — optional profile-path serialization and bounds tests.
- `vscode/scripts/verify-vsix-entrypoint.mjs` — inspect and load the entrypoint declared by a packaged VSIX.
- `vscode/src/webview/core/store.test.ts` — reducer defaults, migration, and preference clamping tests.
- `vscode/src/webview/features/controls/ForceScaleControl.tsx` — logarithmic mapping and numeric draft behavior.
- `vscode/src/webview/features/controls/ForceScaleControl.test.tsx` — boundary and synchronization tests.
- `vscode/src/webview/features/layout/CompactToolbar.tsx` — compose always-visible controls and full-screen action.
- `vscode/src/webview/features/layout/DraggableCrystalPalette.tsx` — collapse, drag, bounds, persistence callbacks, reset.
- `vscode/src/webview/features/layout/DraggableCrystalPalette.test.tsx` — drag and resize-clamp tests.
- `vscode/src/webview/features/layout/ResizableWorkspace.tsx` — structure/convergence splitter and full-screen restore.
- `vscode/src/webview/features/layout/ResizableWorkspace.test.tsx` — pointer, keyboard, and Escape tests.
- `vscode/src/webview/features/layout/ResizableAtomInspector.tsx` — inspector collapse and width splitter.
- `vscode/src/webview/features/layout/ResizableAtomInspector.test.tsx` — width bounds and collapse tests.

### Modified files

- `vscode/esbuild.mjs`, `vscode/package.json`, `.github/workflows/ci.yml` — CommonJS output and packaged-entrypoint gate.
- `src/vasp_analyzer/transport/handoff.py`, `src/vasp_analyzer/cli/app.py` — optional profile path and explicit browser policy.
- `tests/integration/test_cli.py` and new `tests/unit/transport/test_handoff.py` — CLI/handoff regression coverage.
- `vscode/src/controlEndpoint.ts`, `vscode/src/extension.ts`, `vscode/src/analyzerProcess.ts` — receive profile, open files/folders, and spawn the matching parser session.
- `vscode/src/test/controlEndpoint.test.ts`, `vscode/src/test/analyzerProcess.test.ts`, `vscode/src/test/manifest.test.ts` — Remote extension behavior tests.
- `vscode/src/webview/core/contracts.ts`, `vscode/src/webview/core/host.ts`, `vscode/src/webview/core/store.ts`, and their tests — versioned preference persistence and migration.
- `vscode/src/webview/features/convergence/IonicStepControl.tsx` and `.test.tsx` — slider plus numeric input.
- `vscode/src/webview/features/structure/CrystalPanel.tsx` and `.test.tsx` — use the extracted palette and resizable inspector.
- `vscode/src/webview/App.tsx`, `vscode/src/webview/App.test.tsx`, `vscode/src/webview/styles.css` — compact composition and responsive layout.
- `README.md`, `vscode/README.md` — CatGo-style default workflow and explicit browser fallback.

---

### Task 1: Repair and Verify the Packaged Extension Entrypoint

**Files:**
- Create: `vscode/scripts/verify-vsix-entrypoint.mjs`
- Modify: `vscode/esbuild.mjs`
- Modify: `vscode/package.json`
- Modify: `vscode/pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`
- Test: `vscode/src/test/manifest.test.ts`

**Interfaces:**
- Consumes: existing `activate(context)` and `deactivate()` exports from `vscode/src/extension.ts`.
- Produces: manifest `main: "./dist/extension.cjs"`; command `node scripts/verify-vsix-entrypoint.mjs <vsix>` that exits 0 only when the packaged entrypoint loads as CommonJS.

- [ ] **Step 1: Write the failing manifest and package tests**

Update `manifest.test.ts` to require the `.cjs` path:

```ts
expect(manifest.main).toBe("./dist/extension.cjs");
```

Add `adm-zip@0.6.0` and `@types/adm-zip@0.5.8` as explicit pinned dev dependencies. Create `verify-vsix-entrypoint.mjs` with a first gate that reads `extension/package.json` from the VSIX and asserts the declared `main` ends in `.cjs` and exists in the archive.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd vscode
pnpm exec vitest run src/test/manifest.test.ts
pnpm build
pnpm exec vsce package --no-dependencies
node scripts/verify-vsix-entrypoint.mjs vasp-analyzer-0.1.0.vsix
```

Expected: manifest test and verifier fail because `main` is `./dist/extension.js` while the bundle contains CommonJS syntax under an ESM package.

- [ ] **Step 3: Emit a real CommonJS entrypoint**

Change the extension build target and manifest:

```js
build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  legalComments: "none",
})
```

```json
"main": "./dist/extension.cjs"
```

In the verifier, extract to `mkdtemp()`, temporarily intercept `Module._load` so only `require("vscode")` returns a controlled empty stub, load the declared `.cjs` entrypoint with `createRequire(import.meta.url)`, restore `Module._load` in `finally`, and assert `typeof exports.activate === "function"` and `typeof exports.deactivate === "function"`.

- [ ] **Step 4: Add the packaged gate to CI and verify GREEN**

After `vsce package` in `release-artifacts`, run:

```yaml
- run: node scripts/verify-vsix-entrypoint.mjs vasp-analyzer-0.1.0.vsix
  working-directory: vscode
```

Run the four commands from Step 2 again. Expected: all pass and the VSIX contains `extension/dist/extension.cjs`.

- [ ] **Step 5: Commit**

```bash
git add vscode/esbuild.mjs vscode/package.json vscode/pnpm-lock.yaml vscode/scripts/verify-vsix-entrypoint.mjs vscode/src/test/manifest.test.ts .github/workflows/ci.yml
git diff --check
git commit -m "fix: package a loadable VS Code extension entrypoint"
```

---

### Task 2: Make VS Code Handoff the Only Default and Carry Profiles

**Files:**
- Modify: `src/vasp_analyzer/transport/handoff.py`
- Modify: `src/vasp_analyzer/cli/app.py`
- Modify: `tests/integration/test_cli.py`
- Create: `tests/unit/transport/test_handoff.py`

**Interfaces:**
- Consumes: `canonical_calculation_path(path: Path) -> Path` and strict `load_profile(path)` validation.
- Produces: `try_extension_handoff(path, *, profile_path: Path | None = None, environ, sender) -> bool`; JSON request `{token, path, profile?}`.

- [ ] **Step 1: Replace fallback expectations with failing explicit-policy tests**

Add tests with these assertions:

```python
result = runner.invoke(app, [str(root)])
assert result.exit_code == 2
assert launches == []
assert "VS Code extension" in result.output
```

```python
result = runner.invoke(app, [str(root), "--web"])
assert result.exit_code == 0
assert launches == [WebLaunchRequest(path=root.resolve())]
```

```python
result = runner.invoke(app, [str(root), "--profile", str(profile)])
assert result.exit_code == 0
assert json.loads(sent[0][1]) == {
    "token": "c" * 32,
    "path": str(root.resolve()),
    "profile": str(profile.resolve()),
}
```

- [ ] **Step 2: Run focused Python tests to verify RED**

```bash
python -m pytest tests/integration/test_cli.py tests/unit/transport/test_handoff.py -q
```

Expected: current fallback tests fail because the browser launcher is invoked and profile handoff is skipped.

- [ ] **Step 3: Extend the bounded request and root command**

Add an optional bounded profile path:

```python
class HandoffRequest(FrozenModel):
    token: str = Field(repr=False, min_length=32, max_length=512)
    path: str = Field(min_length=1, max_length=32_767)
    profile: str | None = Field(default=None, max_length=32_767)
```

Resolve a supplied profile with `Path(profile_path).expanduser().resolve(strict=True)`, require `is_file()`, and serialize it. In `root()`, attempt handoff whenever browser mode is not explicit, including when `--profile` is present. If it returns false, raise:

```python
raise AnalyzerError(
    "VS Code extension handoff unavailable; install or reload the Remote SSH "
    "workspace extension, then open a new integrated terminal. Use --web only "
    "for explicit browser mode."
)
```

Do not echo endpoint, token, calculation path, or profile path in that error.

- [ ] **Step 4: Verify focused and full Python suites GREEN**

```bash
python -m pytest tests/integration/test_cli.py tests/unit/transport/test_handoff.py -q
python -m ruff check src tests
python -m pytest -m "not corpus"
```

Expected: focused tests pass; full suite passes with only the existing platform-dependent symlink skip.

- [ ] **Step 5: Commit**

```bash
git add src/vasp_analyzer/transport/handoff.py src/vasp_analyzer/cli/app.py tests/integration/test_cli.py tests/unit/transport/test_handoff.py
git diff --check
git commit -m "fix: require explicit browser mode for analyzer"
```

---

### Task 3: Open OUTCAR or Calculation Folders Through the Remote Extension

**Files:**
- Modify: `vscode/src/controlEndpoint.ts`
- Modify: `vscode/src/analyzerProcess.ts`
- Modify: `vscode/src/extension.ts`
- Modify: `vscode/package.json`
- Test: `vscode/src/test/controlEndpoint.test.ts`
- Test: `vscode/src/test/analyzerProcess.test.ts`
- Test: `vscode/src/test/manifest.test.ts`

**Interfaces:**
- Consumes: authenticated request `{ token, path, profile?: string }` from Task 2.
- Produces: `AnalyzerLaunchConfiguration.profilePath?: string`; panel identity `${root}\0${profilePath ?? "auto"}`; case-insensitive OUTCAR context menu and file/folder dialog.

- [ ] **Step 1: Write failing protocol, invocation, and manifest tests**

Require a profile to remain one literal non-shell argument:

```ts
const invocation = analyzerInvocation("/work/calc", { profilePath: "/profiles/home.toml" });
expect(invocation.args).toEqual([
  "serve", "--stdio", "/work/calc", "--profile", "/profiles/home.toml",
]);
expect(invocation.shell).toBe(false);
```

Require the context predicate and dialog behavior:

```ts
expect(menu.when).toBe("resourceFilename =~ /^outcar$/i");
expect(source).toContain("canSelectFolders: true");
```

Add endpoint tests that accept a canonical readable profile file, reject a missing/directory profile, and ensure `onOpen` receives `{ root, profilePath }` without following an invalid profile selection.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
cd vscode
pnpm exec vitest run src/test/controlEndpoint.test.ts src/test/analyzerProcess.test.ts src/test/manifest.test.ts
```

Expected: failures for the missing optional profile, invocation arguments, folder selection, and case-insensitive menu.

- [ ] **Step 3: Implement typed profile forwarding and panel identity**

Use this launch contract:

```ts
export interface AnalyzerLaunchConfiguration {
  readonly executablePath?: string;
  readonly pythonPath?: string;
  readonly profilePath?: string;
}
```

Append `--profile`, `profilePath` after the calculation path in both executable and Python-module forms. Resolve an optional profile with `realpath`, `stat().isFile()`, and read access before `onOpen`. Change the callback to:

```ts
readonly onOpen: (
  calculation: { readonly root: string; readonly profilePath: string | null },
  signal: AbortSignal,
) => void | Promise<void>;
```

Key `panels` by root plus profile path, and pass `profilePath` to `spawnAnalyzer` through configuration. In the open dialog set both `canSelectFiles: true` and `canSelectFolders: true`.

- [ ] **Step 4: Verify extension-focused tests GREEN**

```bash
pnpm exec vitest run src/test/controlEndpoint.test.ts src/test/analyzerProcess.test.ts src/test/manifest.test.ts
pnpm typecheck
pnpm build
```

Expected: tests, typecheck, and build pass.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/controlEndpoint.ts vscode/src/analyzerProcess.ts vscode/src/extension.ts vscode/package.json vscode/src/test/controlEndpoint.test.ts vscode/src/test/analyzerProcess.test.ts vscode/src/test/manifest.test.ts
git diff --check
git commit -m "feat: open profiled calculations in Remote VS Code"
```

---

### Task 4: Introduce Versioned Webview Preferences

**Files:**
- Modify: `vscode/src/webview/core/contracts.ts`
- Modify: `vscode/src/webview/core/host.ts`
- Modify: `vscode/src/webview/core/store.ts`
- Modify: `vscode/src/webview/core/host.test.ts`
- Create: `vscode/src/webview/core/store.test.ts`
- Modify: `vscode/src/webview/test/fixtures.ts`

**Interfaces:**
- Produces: `PersistedAnalysisState` version 2 and `LayoutPreferences`; reducer defaults used by later layout tasks.

- [ ] **Step 1: Write failing migration and clamping tests**

Use this contract in tests:

```ts
export interface LayoutPreferences {
  readonly structurePercent: number;
  readonly inspectorWidth: number;
  readonly inspectorCollapsed: boolean;
  readonly paletteX: number;
  readonly paletteY: number;
  readonly paletteCollapsed: boolean;
}

export interface PersistedAnalysisState {
  readonly version: 2;
  readonly selectedStep: number;
  readonly selectedSite: number | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly layout: LayoutPreferences;
}
```

Assert legacy `{selectedStep, selectedSite}` migrates independently to force scale 10 and safe layout defaults; malformed individual layout fields fall back without discarding valid selection; persisted force scales clamp to 1..1000.

- [ ] **Step 2: Run host/store tests to verify RED**

```bash
cd vscode
pnpm exec vitest run src/webview/core/host.test.ts src/webview/core/store.test.ts
```

Expected: missing versioned fields, force preference, and layout reducer actions fail.

- [ ] **Step 3: Implement versioned state and reducer actions**

Define exported bounds/defaults:

```ts
export const DEFAULT_LAYOUT: LayoutPreferences = Object.freeze({
  structurePercent: 60,
  inspectorWidth: 280,
  inspectorCollapsed: true,
  paletteX: 10,
  paletteY: 10,
  paletteCollapsed: true,
});
```

Set `initialAnalysisState.forceScale` to 10. Clamp force to `[1, 1000]`, split to the layout component's supported range, inspector width to its supported range, and finite palette coordinates to nonnegative numbers. Add exact reducer actions `setLayout` and `resetLayout`; full-screen remains local component state and is not persisted.

- [ ] **Step 4: Verify migration and existing host tests GREEN**

```bash
pnpm exec vitest run src/webview/core/host.test.ts src/webview/core/store.test.ts src/webview/core/runtimeHost.test.ts
pnpm typecheck
```

Expected: old selection state migrates, malformed preferences are isolated, and typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/core/contracts.ts vscode/src/webview/core/host.ts vscode/src/webview/core/store.ts vscode/src/webview/core/host.test.ts vscode/src/webview/core/store.test.ts vscode/src/webview/test/fixtures.ts
git diff --check
git commit -m "feat: persist versioned viewer preferences"
```

---

### Task 5: Replace Ionic-Step Dropdown and Add Logarithmic Force Control

**Files:**
- Modify: `vscode/src/webview/features/convergence/IonicStepControl.tsx`
- Modify: `vscode/src/webview/features/convergence/IonicStepControl.test.tsx`
- Create: `vscode/src/webview/features/controls/ForceScaleControl.tsx`
- Create: `vscode/src/webview/features/controls/ForceScaleControl.test.tsx`

**Interfaces:**
- `IonicStepControl({ total, selectedIndex, onSelect })` emits zero-based valid indices.
- `ForceScaleControl({ value, onChange })` emits finite values in `[1, 1000]`.

- [ ] **Step 1: Write failing control behavior tests**

For ionic steps, assert slider and number both display 1-based `2`, guide `/ 120`, and emit index `41` after entering `42`. Assert an empty draft leaves selection unchanged and Enter clamps `999` to the final index.

For force scale, export and test the mapping:

```ts
expect(scaleToSlider(1)).toBe(0);
expect(scaleToSlider(10)).toBeCloseTo(1 / 3);
expect(scaleToSlider(1000)).toBe(1);
expect(sliderToScale(scaleToSlider(250))).toBeCloseTo(250);
```

Assert the paired input/readout shows `250×`, accepts `500`, and clamps `5000` to `1000` on Enter.

- [ ] **Step 2: Run both component tests to verify RED**

```bash
cd vscode
pnpm exec vitest run src/webview/features/convergence/IonicStepControl.test.tsx src/webview/features/controls/ForceScaleControl.test.tsx
```

Expected: old select-only ionic control fails and force component/module does not exist.

- [ ] **Step 3: Implement draft-safe controls**

Use an exponent-normalized slider:

```ts
const MIN_SCALE = 1;
const MAX_SCALE = 1000;
const LOG_RANGE = Math.log10(MAX_SCALE / MIN_SCALE);

export const scaleToSlider = (scale: number): number =>
  Math.log10(clamp(scale, MIN_SCALE, MAX_SCALE) / MIN_SCALE) / LOG_RANGE;

export const sliderToScale = (position: number): number =>
  MIN_SCALE * 10 ** (clamp(position, 0, 1) * LOG_RANGE);
```

Use range input `min="0" max="1" step="0.001"`. Keep text drafts local; dispatch only finite valid values, and normalize/clamp on blur or Enter. Give slider and number distinct accessible labels such as `Ionic step slider`, `Ionic step number`, `Force vector scale slider`, and `Force vector scale number`.

- [ ] **Step 4: Verify controls GREEN**

```bash
pnpm exec vitest run src/webview/features/convergence/IonicStepControl.test.tsx src/webview/features/controls/ForceScaleControl.test.tsx
pnpm typecheck
```

Expected: all boundary, synchronization, and draft tests pass.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/convergence/IonicStepControl.tsx vscode/src/webview/features/convergence/IonicStepControl.test.tsx vscode/src/webview/features/controls/ForceScaleControl.tsx vscode/src/webview/features/controls/ForceScaleControl.test.tsx
git diff --check
git commit -m "feat: add direct step and force controls"
```

---

### Task 6: Extract the Compact Toolbar and Draggable Crystal Palette

**Files:**
- Create: `vscode/src/webview/features/layout/CompactToolbar.tsx`
- Create: `vscode/src/webview/features/layout/DraggableCrystalPalette.tsx`
- Create: `vscode/src/webview/features/layout/DraggableCrystalPalette.test.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.test.tsx`
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/webview/App.test.tsx`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Consumes: Task 4 layout state/actions and Task 5 controls.
- Produces: `CompactToolbarProps`; `PalettePosition {x:number; y:number}`; bounded `DraggableCrystalPalette` with reset/collapse callbacks.

- [ ] **Step 1: Write failing compactness and palette interaction tests**

Assert:

```ts
expect(screen.getByRole("button", { name: "Expand crystal tools" })).toHaveAttribute("aria-expanded", "false");
expect(screen.queryByRole("group", { name: "Crystal tools" })).not.toBeInTheDocument();
```

After expansion, mock viewport and palette rectangles, drag the header beyond the lower-right corner, and assert `onPositionChange({x: boundedX, y: boundedY})`. Trigger a resize callback and assert an old off-screen position is re-clamped. Click `Reset layout` and assert collapsed state plus `{x:10,y:10}`.

- [ ] **Step 2: Run layout and App tests to verify RED**

```bash
cd vscode
pnpm exec vitest run src/webview/features/layout/DraggableCrystalPalette.test.tsx src/webview/features/structure/CrystalPanel.test.tsx src/webview/App.test.tsx
```

Expected: missing extracted components and current always-expanded overlay fail.

- [ ] **Step 3: Implement the compact composition and bounded drag**

Define:

```ts
export interface DraggableCrystalPaletteProps {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly collapsed: boolean;
  readonly onPositionChange: (position: Readonly<{ x: number; y: number }>) => void;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onReset: () => void;
  readonly children: ReactNode;
}
```

Use pointer capture only on the header. Clamp with:

```ts
const x = Math.min(Math.max(0, desiredX), Math.max(0, viewport.width - palette.width));
const y = Math.min(Math.max(0, desiredY), Math.max(0, viewport.height - palette.height));
```

Move all supercell/layer/direction/projection/strongest/reset controls from the old `.crystal-controls` container into the palette children. Compose the always-visible step and force controls in `CompactToolbar`. Keep renderer commands and scientific calculations unchanged.

- [ ] **Step 4: Apply compact responsive CSS and verify GREEN**

Set `.workspace-toolbar` target min-height to 38 px, use single-line compact labels above 720 px, allow one responsive wrap below that breakpoint, and constrain expanded palette with `max-width`, `max-height`, and `overflow:auto`. Ensure the drag header uses `touch-action:none` and form controls do not initiate drag.

Run:

```bash
pnpm exec vitest run src/webview/features/layout/DraggableCrystalPalette.test.tsx src/webview/features/structure/CrystalPanel.test.tsx src/webview/App.test.tsx
pnpm typecheck
```

Expected: palette and App tests pass with no accessibility-query ambiguity.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/layout/CompactToolbar.tsx vscode/src/webview/features/layout/DraggableCrystalPalette.tsx vscode/src/webview/features/layout/DraggableCrystalPalette.test.tsx vscode/src/webview/features/structure/CrystalPanel.tsx vscode/src/webview/features/structure/CrystalPanel.test.tsx vscode/src/webview/App.tsx vscode/src/webview/App.test.tsx vscode/src/webview/styles.css
git diff --check
git commit -m "feat: add compact draggable crystal controls"
```

---

### Task 7: Add Resizable Workspace, Inspector, and Structure Full-Screen

**Files:**
- Create: `vscode/src/webview/features/layout/ResizableWorkspace.tsx`
- Create: `vscode/src/webview/features/layout/ResizableWorkspace.test.tsx`
- Create: `vscode/src/webview/features/layout/ResizableAtomInspector.tsx`
- Create: `vscode/src/webview/features/layout/ResizableAtomInspector.test.tsx`
- Modify: `vscode/src/webview/features/structure/CrystalPanel.tsx`
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/webview/App.test.tsx`
- Modify: `vscode/src/webview/styles.css`

**Interfaces:**
- Consumes: persisted `structurePercent`, `inspectorWidth`, and `inspectorCollapsed` from Task 4.
- Produces: `ResizableWorkspace({structurePercent,onStructurePercentChange,fullScreen,onFullScreenChange,...})`; `ResizableAtomInspector({width,collapsed,onWidthChange,onCollapsedChange,...})`.

- [ ] **Step 1: Write failing pointer, keyboard, collapse, and restore tests**

Cover these exact outcomes:

- End on the horizontal separator reaches the supported near-full maximum rather than 80.
- Pointer drag clamps at both minimum and maximum.
- Arrow keys change the split by 5 percentage points.
- Atom-inspector splitter clamps to readable min/max widths and supports ArrowLeft/ArrowRight.
- No selected atom renders the narrow collapsed affordance rather than a 280 px empty panel.
- Full-screen hides convergence and splitters, preserves compact controls, exits on Escape, and restores the exact previous split/inspector state.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
cd vscode
pnpm exec vitest run src/webview/features/layout/ResizableWorkspace.test.tsx src/webview/features/layout/ResizableAtomInspector.test.tsx src/webview/App.test.tsx
```

Expected: new components are missing and the old 30..80/fixed-280 layout fails.

- [ ] **Step 3: Implement reusable splitters and session-only full-screen**

Use CSS custom properties rather than enumerated `split-30` classes:

```tsx
<main
  className={fullScreen ? "analysis-workspace is-structure-fullscreen" : "analysis-workspace"}
  style={{ "--structure-percent": `${structurePercent}%` } as CSSProperties}
>
```

```css
.analysis-workspace {
  grid-template-rows: minmax(0, var(--structure-percent)) 8px minmax(48px, 1fr);
}
.analysis-workspace.is-structure-fullscreen {
  grid-template-rows: minmax(0, 1fr);
}
.analysis-workspace.is-structure-fullscreen .analysis-region,
.analysis-workspace.is-structure-fullscreen > .splitter { display: none; }
```

Store full-screen only in `useState`. Capture the prior split and inspector collapse/width in a ref on entry; restore them on toggle or Escape. The vertical inspector splitter uses pointer capture and `aria-orientation="vertical"`.

- [ ] **Step 4: Verify layout GREEN**

```bash
pnpm exec vitest run src/webview/features/layout/ResizableWorkspace.test.tsx src/webview/features/layout/ResizableAtomInspector.test.tsx src/webview/features/structure/CrystalPanel.test.tsx src/webview/App.test.tsx
pnpm typecheck
```

Expected: resize, collapse, full-screen, restore, and keyboard tests pass.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/features/layout/ResizableWorkspace.tsx vscode/src/webview/features/layout/ResizableWorkspace.test.tsx vscode/src/webview/features/layout/ResizableAtomInspector.tsx vscode/src/webview/features/layout/ResizableAtomInspector.test.tsx vscode/src/webview/features/structure/CrystalPanel.tsx vscode/src/webview/App.tsx vscode/src/webview/App.test.tsx vscode/src/webview/styles.css
git diff --check
git commit -m "feat: add resizable full-screen crystal workspace"
```

---

### Task 8: Integrate Persistence, Fallback Behavior, and Documentation

**Files:**
- Modify: `vscode/src/webview/App.tsx`
- Modify: `vscode/src/webview/App.test.tsx`
- Modify: `vscode/src/webview/features/fallback/DataTableFallback.test.tsx`
- Modify: `README.md`
- Modify: `vscode/README.md`

**Interfaces:**
- Consumes: all control/layout components and versioned state from Tasks 4–7.
- Produces: one persisted state write containing scientific selection plus preferences; documented Remote SSH acceptance flow.

- [ ] **Step 1: Write failing end-to-end Webview state tests**

Start with a legacy state, change step, force scale, split, inspector, and palette, then assert one normalized version-2 state:

```ts
expect(host.state).toMatchObject({
  version: 2,
  selectedStep: 1,
  forceScale: 250,
  layout: {
    paletteCollapsed: false,
    inspectorCollapsed: false,
  },
});
expect(host.state).not.toHaveProperty("fullScreen");
```

Force WebGL construction failure and assert the tabular fallback plus ionic-step slider/number remain usable while crystal-only palette controls are absent.

- [ ] **Step 2: Run App/fallback tests to verify RED**

```bash
cd vscode
pnpm exec vitest run src/webview/App.test.tsx src/webview/features/fallback/DataTableFallback.test.tsx
```

Expected: persistence and fallback-control assertions fail before final integration.

- [ ] **Step 3: Wire one normalized persistence effect**

Replace selection-only persistence with:

```ts
host.setState({
  version: 2,
  selectedStep: state.selectedStep,
  selectedSite: state.selectedSite,
  forceMode: state.forceMode,
  forceScale: state.forceScale,
  layout: state.layout,
});
```

When the renderer fails, keep `CompactToolbar` step/force controls and `DataTableFallback`, but do not render the draggable crystal-tool palette.

- [ ] **Step 4: Update usage documentation and verify GREEN**

Document:

```text
analyzer OUTCAR              # VS Code editor handoff only
analyzer OUTCAR --web        # explicit loopback browser mode
analyzer OUTCAR --profile ~/profiles/home.toml
```

Include the fixed Remote SSH install/reload/new-terminal sequence and the expected `command -v analyzer` diagnostic. Run:

```bash
pnpm exec vitest run src/webview/App.test.tsx src/webview/features/fallback/DataTableFallback.test.tsx
pnpm test
pnpm typecheck
pnpm build
```

Expected: all Webview tests pass and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add vscode/src/webview/App.tsx vscode/src/webview/App.test.tsx vscode/src/webview/features/fallback/DataTableFallback.test.tsx README.md vscode/README.md
git diff --check
git commit -m "docs: integrate the Remote SSH viewer workflow"
```

---

### Task 9: Release Verification and Remote SSH Acceptance

**Files:**
- Modify only if a verification failure exposes a covered defect; use a new RED–GREEN commit for that defect.

**Interfaces:**
- Consumes: completed implementation from Tasks 1–8.
- Produces: verified wheel, sdist, VSIX, clean Git state, pushed branch, and updated draft PR.

- [ ] **Step 1: Run complete repository-safe verification**

```bash
python -m ruff check src tests
python -m pytest -m "not corpus"
cd vscode
pnpm test
pnpm typecheck
pnpm build
pnpm exec vsce package --no-dependencies
node scripts/verify-vsix-entrypoint.mjs vasp-analyzer-0.1.0.vsix
cd ..
python -m build
git diff --check
```

Expected: Ruff clean; Python and TypeScript suites have zero failures; typecheck/build/package commands exit 0; the packaged entrypoint loads; wheel and sdist contain offline Webview assets.

- [ ] **Step 2: Run the real corpus gates**

Set the private corpus path only in the current process environment, then run the existing authoritative corpus and cache-resume tests separately with their established 15-minute limits. Expected: the 52-file corpus and largest-file append/cache checks pass without recording the corpus path or reports in Git.

- [ ] **Step 3: Push and verify GitHub Actions**

```bash
git status --short
git push
gh pr checks 1 --repo shinjuhyeong/vasp-analyzer --watch
```

Expected: clean worktree, remote head equals local head, and Python, Webview, packaged-entrypoint, and release-artifact jobs all pass.

- [ ] **Step 4: Perform Remote SSH manual acceptance**

On the server:

```bash
python3 -m pip install --user --force-reinstall ./vasp_analyzer-0.1.0-py3-none-any.whl
code --install-extension ./vasp-analyzer-0.1.0.vsix --force
command -v analyzer
```

Reload the Remote SSH VS Code window, open a new integrated terminal, then:

```bash
cd /path/to/a/real/calculation
analyzer OUTCAR
```

Acceptance criteria:

- no external browser opens;
- a VASP Analyzer editor tab appears;
- OUTCAR context command is available for upper- and lower-case filenames;
- toolbar remains compact;
- crystal palette starts collapsed, drags, clamps, persists, and resets;
- ionic-step slider and number remain synchronized;
- force slider reaches 1000× and shows its multiplier;
- structure/convergence and atom-inspector splitters resize;
- structure full-screen exits with Escape and restores the prior layout;
- atom selection and force/convergence synchronization still work.

- [ ] **Step 5: Record the release result**

If no defects were found, leave the implementation commits intact, keep the PR in draft for user review, and report exact local/CI counts plus the manual acceptance result. Do not merge or delete the worktree without explicit user instruction.
