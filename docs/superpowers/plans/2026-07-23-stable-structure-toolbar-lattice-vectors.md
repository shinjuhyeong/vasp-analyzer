# Stable Structure Toolbar and Lattice Vector Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the ionic-step controls stationary across initial/ionic/comparison modes and expose an independent lattice-vector visibility toggle.

**Architecture:** Split `CompactToolbar` into persistent primary and secondary rows. The secondary row swaps comparison and force control content inside a fixed-size, horizontally scrollable dock. Reuse the existing renderer `axes` layer for the explicit `Lattice vectors (a, b, c)` control, preserving renderer and dataset contracts.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, 3Dmol renderer abstraction.

## Global Constraints

- The primary row always contains title, ionic-step control, and expand/restore control.
- The secondary row has fixed height and must not wrap or create a third toolbar row.
- Hidden mode-specific controls must not remain keyboard-focusable or exposed to accessibility navigation.
- Lattice vectors default on and remain independent of unit-cell edges.
- No parser, dataset schema, renderer contract, or persisted-state migration is introduced.

---

## File Structure

- `vscode/src/webview/features/layout/CompactToolbar.tsx`: render the two persistent toolbar rows and mode-specific secondary dock.
- `vscode/src/webview/styles.css`: define stable row geometry, non-wrapping overflow, and responsive behavior.
- `vscode/src/webview/App.test.tsx`: verify toolbar structure and mode switching through the integrated Webview.
- `vscode/src/webview/features/structure/CrystalPanel.tsx`: expose the existing `axes` layer under the explicit lattice-vector label.
- `vscode/src/webview/features/structure/CrystalPanel.test.tsx`: verify default visibility and independence from the cell layer.

### Task 1: Persistent Two-Row Structure Toolbar

**Files:**
- Modify: `vscode/src/webview/features/layout/CompactToolbar.tsx`
- Modify: `vscode/src/webview/styles.css`
- Test: `vscode/src/webview/App.test.tsx`

**Interfaces:**
- Consumes: the existing `CompactToolbarProps` without changes.
- Produces: `.toolbar-primary-row` and `.toolbar-secondary-dock` elements; the dock contains either comparison controls or force controls.

- [ ] **Step 1: Write failing integrated toolbar tests**

Add assertions that the same primary row contains the step control before and after selecting the initial frame, that a secondary dock is always present, and that comparison on/off swaps content without adding another dock:

```tsx
const primary = screen.getByTestId("structure-toolbar-primary");
const dock = screen.getByTestId("structure-toolbar-secondary");
expect(within(primary).getByLabelText("Ionic step slider")).toBeVisible();
expect(dock).toHaveClass("toolbar-secondary-dock");

fireEvent.change(screen.getByLabelText("Ionic step number"), { target: { value: "0" } });
expect(screen.getByTestId("structure-toolbar-primary")).toBe(primary);
expect(screen.getByTestId("structure-toolbar-secondary")).toBe(dock);
expect(within(dock).getByLabelText("Compare structures")).toBeVisible();
```

Also assert `Force components` is absent in initial mode, present in ionic mode, and that enabling comparison renders the target and displacement controls inside the same dock.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --dir vscode test -- App.test.tsx
```

Expected: FAIL because `structure-toolbar-primary` and `structure-toolbar-secondary` do not exist.

- [ ] **Step 3: Implement the persistent row markup**

Change the toolbar shape to:

```tsx
<header className="workspace-toolbar">
  <div className="toolbar-primary-row" data-testid="structure-toolbar-primary">
    {title}
    <div className="toolbar-control toolbar-step-control">...</div>
    <button className="fullscreen-toggle" ...>...</button>
  </div>
  <div className="toolbar-secondary-dock" data-testid="structure-toolbar-secondary">
    {selectedStepIndex === -1 ? comparisonControls : forceControls}
  </div>
</header>
```

Render only the controls for the active mode. For the initial frame, keep Compare visible and show target/number/displacement controls only when enabled. For ionic frames, always render force mode and force scale. Do not use invisible focusable placeholders.

- [ ] **Step 4: Implement fixed dock CSS**

Define stable geometry and contained overflow:

```css
.workspace-toolbar {
  display: grid;
  grid-template-rows: 38px 36px;
  gap: 0;
  min-height: 74px;
  padding: 0 10px;
}
.toolbar-primary-row,
.toolbar-secondary-dock {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.toolbar-secondary-dock {
  height: 36px;
  overflow-x: auto;
  overflow-y: hidden;
  flex-wrap: nowrap;
}
```

Update the narrow-screen media rule so neither row wraps; preserve horizontal overflow inside the secondary dock.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --dir vscode test -- App.test.tsx
pnpm --dir vscode typecheck
```

Expected: toolbar tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add vscode/src/webview/features/layout/CompactToolbar.tsx vscode/src/webview/styles.css vscode/src/webview/App.test.tsx
git commit -m "fix: stabilize structure toolbar controls"
```

### Task 2: Explicit Lattice Vector Toggle

**Files:**
- Modify: `vscode/src/webview/features/structure/CrystalPanel.tsx`
- Test: `vscode/src/webview/features/structure/CrystalPanel.test.tsx`

**Interfaces:**
- Consumes: existing `LayerName = "axes"` and `CrystalRenderer.setLayerVisible(layer, visible)`.
- Produces: checkbox accessible as `Show lattice vectors`, labelled visibly as `Lattice vectors (a, b, c)`; no new renderer method or layer name.

- [ ] **Step 1: Write failing lattice-vector tests**

Render `CrystalPanel` with `FakeRenderer`, then assert:

```tsx
const vectors = screen.getByLabelText("Show lattice vectors");
const cell = screen.getByLabelText("Show cell");
expect(vectors).toBeChecked();
expect(cell).toBeChecked();
fireEvent.click(vectors);
expect(vectors).not.toBeChecked();
expect(cell).toBeChecked();
expect(fakeRenderer.layerCalls).toContainEqual(["axes", false]);
expect(fakeRenderer.layerCalls).not.toContainEqual(["cell", false]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --dir vscode test -- CrystalPanel.test.tsx
```

Expected: FAIL because `Show lattice vectors` is not present.

- [ ] **Step 3: Change only the axes layer presentation**

Replace the axes entry in `LAYERS` while retaining its internal name:

```tsx
{ name: "axes", label: "lattice vectors", accessibleLabel: "Show lattice vectors", initial: true }
```

Give every layer an explicit `accessibleLabel`, render that string as `aria-label`, and render `Lattice vectors (a, b, c)` as the visible axes-layer label. Keep `cell` as a separate checked layer.

- [ ] **Step 4: Run focused and renderer tests**

Run:

```bash
pnpm --dir vscode test -- CrystalPanel.test.tsx ThreeDmolRenderer.test.ts
```

Expected: both suites PASS; axes visibility remains independent of cell visibility.

- [ ] **Step 5: Run full Webview gates**

Run:

```bash
pnpm --dir vscode test
pnpm --dir vscode typecheck
pnpm --dir vscode build
```

Expected: all Vitest tests PASS, TypeScript exits 0, and the production build exits 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add vscode/src/webview/features/structure/CrystalPanel.tsx vscode/src/webview/features/structure/CrystalPanel.test.tsx
git commit -m "feat: add lattice vector visibility toggle"
```

### Task 3: Final Integrated Verification

**Files:**
- Verify only; modify earlier task files only if a failing requirement-specific regression demands it.

**Interfaces:**
- Consumes: both completed tasks.
- Produces: verified Webview bundle ready for VSIX packaging.

- [ ] **Step 1: Re-read the design acceptance requirements**

Confirm the implementation has a persistent primary row, one fixed secondary dock, contained horizontal overflow, mode-specific accessible controls, default-on lattice vectors, and independent unit-cell visibility.

- [ ] **Step 2: Run all Webview verification commands fresh**

```bash
pnpm --dir vscode test
pnpm --dir vscode typecheck
pnpm --dir vscode build
git diff --check
```

Expected: all commands exit 0 with no test failures, type errors, build errors, or whitespace errors.

- [ ] **Step 3: Inspect the final diff and commit any verification-only correction**

If no correction is required, do not create an empty commit. If a requirement-specific correction was necessary, add a failing regression first, then commit only that correction with:

```bash
git add vscode/src/webview/features/layout/CompactToolbar.tsx vscode/src/webview/features/structure/CrystalPanel.tsx vscode/src/webview/styles.css vscode/src/webview/App.test.tsx vscode/src/webview/features/structure/CrystalPanel.test.tsx
git commit -m "test: lock stable structure controls"
```
