# Fixed Ionic-Step Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor the ionic-step control to the same horizontal coordinate for Initial, ionic, and comparison states.

**Architecture:** Replace the primary toolbar flex row with a three-column CSS Grid: a fixed 200 px title column, a scroll-contained step column, and an intrinsic fullscreen column. Add a layout-capable Playwright regression harness because jsdom cannot measure element coordinates.

**Tech Stack:** React 19, TypeScript, CSS Grid, Vitest, Playwright Chromium, pnpm.

## Global Constraints

- The title column is exactly 200 px and truncates with an ellipsis.
- The ionic-step control starts at the same x-coordinate in Initial, ionic, comparison-off, and comparison-on states.
- Expand/Restore remains in the last column and immediately reachable.
- At narrow widths only the middle step column scrolls; no toolbar control wraps to another row.
- The test must compare actual browser `getBoundingClientRect().x` values, not CSS source strings.

---

### Task 1: Primary Grid DOM Hook

**Files:**
- Modify: `vscode/src/webview/features/layout/CompactToolbar.tsx`
- Test: `vscode/src/webview/App.test.tsx`

**Interfaces:**
- Consumes: existing `CompactToolbarProps`.
- Produces: a stable `.toolbar-primary-grid` hook whose existing children are title, step control, and fullscreen control; Task 2 owns measured layout behavior.

- [ ] **Step 1: Write the failing DOM contract test**

In `App.test.tsx`, assert the primary row exposes a grid-layout class and that title, step control, and fullscreen control retain stable nodes across Initial/ionic transitions:

```tsx
const primary = screen.getByTestId("structure-toolbar-primary");
expect(primary).toHaveClass("toolbar-primary-grid");
const step = within(primary).getByLabelText("Ionic step slider");
fireEvent.change(screen.getByLabelText("Ionic step number"), { target: { value: "0" } });
expect(within(primary).getByLabelText("Ionic step slider")).toBe(step);
```

- [ ] **Step 2: Verify RED**

Run `pnpm --dir vscode exec vitest run src/webview/App.test.tsx`.

Expected: FAIL because `toolbar-primary-grid` is absent.

- [ ] **Step 3: Implement only the DOM hook**

Add `toolbar-primary-grid` to the primary row. Do not change layout CSS yet; the measured regression must still reproduce against the flex layout.

- [ ] **Step 4: Verify GREEN**

Run:

```text
pnpm --dir vscode exec vitest run src/webview/App.test.tsx
pnpm --dir vscode typecheck
```

Expected: App tests and typecheck exit 0.

- [ ] **Step 5: Commit**

```text
git add vscode/src/webview/features/layout/CompactToolbar.tsx vscode/src/webview/App.test.tsx
git commit -m "test: expose primary toolbar layout hook"
```

### Task 2: Browser Coordinate Regression

**Files:**
- Modify: `vscode/package.json`
- Modify: `vscode/pnpm-lock.yaml`
- Modify: `vscode/src/webview/styles.css`
- Create: `vscode/playwright.config.ts`
- Create: `vscode/tests/layout/ionic-step-position.spec.ts`
- Create: `vscode/tests/layout/toolbar-harness.html`
- Create: `vscode/tests/layout/toolbar-harness.tsx`

**Interfaces:**
- Consumes: production `CompactToolbar` and production CSS.
- Produces: `pnpm --dir vscode test:layout`, which runs Chromium coordinate assertions.

- [ ] **Step 1: Add a failing layout test and harness**

The harness renders the real toolbar with controls for changing selected frame and comparison state. The Playwright test records:

```ts
const x = async () => page.getByLabel("Ionic step slider").evaluate(
  (node) => node.getBoundingClientRect().x,
);
const ionicX = await x();
await page.getByRole("button", { name: "Select Initial" }).click();
expect(await x()).toBe(ionicX);
await page.getByLabel("Compare structures").check();
expect(await x()).toBe(ionicX);
```

Repeat at widths 1280 and 640. Assert `Expand` is inside the viewport and the primary row height is unchanged.

- [ ] **Step 2: Verify RED on the current flex layout**

Run `pnpm --dir vscode test:layout`.

Expected: at least one x-coordinate equality fails on the old flex layout.

- [ ] **Step 3: Wire Playwright without duplicating product markup**

Add `@playwright/test` to dev dependencies, a `test:layout` script, Chromium-only configuration, and an esbuild/Vite-compatible harness that imports `CompactToolbar.tsx` and `styles.css`. Do not copy toolbar JSX into the harness.

- [ ] **Step 4: Implement the fixed grid**

Replace the flex sizing rules with:

```css
.toolbar-primary-grid {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) auto;
  column-gap: 12px;
}
.toolbar-primary-grid > .title-group {
  width: 200px;
  min-width: 200px;
  overflow: hidden;
}
.toolbar-primary-grid > .toolbar-step-control {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.toolbar-primary-grid > .fullscreen-toggle {
  justify-self: end;
}
```

Remove the primary-row flex declarations whose intrinsic sizing shifts the step column. Preserve the fixed secondary dock.

- [ ] **Step 5: Verify GREEN and full Webview gates**

Run:

```text
pnpm --dir vscode test:layout
pnpm --dir vscode test
pnpm --dir vscode typecheck
pnpm --dir vscode build
```

Expected: coordinate tests pass at both widths; all existing gates exit 0.

- [ ] **Step 6: Commit**

```text
git add vscode/package.json vscode/pnpm-lock.yaml vscode/playwright.config.ts vscode/tests/layout vscode/src/webview/styles.css
git commit -m "fix: anchor ionic step controls"
```
