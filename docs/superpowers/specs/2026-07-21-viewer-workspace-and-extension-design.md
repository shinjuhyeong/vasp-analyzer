# Viewer Workspace and VS Code Extension Reliability Design

**Date:** 2026-07-21  
**Status:** Approved in conversation  
**Scope:** VASP Analyzer 0.1.x usability and Remote SSH reliability improvements

## Objective

Make `analyzer OUTCAR` behave like the CatGo VS Code workflow: a command entered in a Remote SSH integrated terminal opens the interactive crystal viewer in a VS Code editor tab, without automatically opening an external browser. Reduce viewer obstruction, add direct numeric controls, and let the user expand the crystal workspace by dragging or entering full-screen mode.

## Confirmed Problems

1. The always-visible workspace toolbar and the overlaid crystal controls consume or cover too much of the structure viewport.
2. The user wants a terminal-launched VS Code editor experience, not a character-cell TUI and not an automatically opened website.
3. The installed Remote SSH extension fails activation. The packaged manifest declares `"type": "module"`, while esbuild emits CommonJS into `dist/extension.js`. The remote extension host therefore treats the file as ESM and rejects its `module.exports` entrypoint. This produces `command 'vaspAnalyzer.open' not found`.
4. Ionic-step selection is a dropdown rather than a slider plus direct numeric entry.
5. The force-vector scale stops at 10×, does not provide a large numeric readout, and cannot reach the magnification needed for small forces.
6. The current structure/convergence splitter caps the structure region at 80%, and atom details have a fixed width.

## Chosen Interaction Model

Three structure-control layouts were compared:

- **A — Compact toolbar plus draggable palette:** preserves immediate step and force controls while moving less frequent crystal controls into a collapsible overlay.
- **B — Fixed right dock:** never overlaps the crystal but permanently reduces its width.
- **C — Fully free-floating controls:** maximizes flexibility but creates excessive window management and can recreate the obstruction problem.

The user selected **A**. The application will use a compact persistent toolbar and one bounded, collapsible, draggable crystal-tools palette. The user also selected both resizable structure height and atom-inspector width, plus a full-screen structure mode.

## Runtime and Extension Design

### Default command flow

```text
Remote SSH integrated terminal
  -> analyzer OUTCAR
  -> authenticated extension handoff
  -> Remote VS Code workspace extension
  -> VASP Analyzer editor tab
```

The default command must never silently substitute a browser for a failed extension handoff.

- If the authenticated handoff succeeds, the command exits successfully after asking the extension to reveal or create the editor panel.
- If extension endpoint variables are present but the handoff fails, the CLI exits non-zero with instructions to reinstall/reload the extension and open a new integrated terminal.
- If no extension endpoint is present, the CLI exits non-zero with instructions for installing or activating the workspace extension.
- Browser mode remains available only through an explicit browser option such as `--web`, `--port`, or `--no-open`.

### VS Code activation and packaging

The workspace extension remains CommonJS for broad VS Code extension-host compatibility. esbuild will emit `dist/extension.cjs`, and the manifest `main` field will point to that file. The browser Webview remains an independent IIFE bundle at `dist/webview/index.js`; the package-wide ESM declaration must no longer conflict with the extension-host entrypoint.

The packaged VSIX must be smoke-tested by unpacking it and loading the actual declared entrypoint with a controlled `vscode` module stub. A source-only assertion is insufficient because the observed bug exists only in the packaged module contract.

### Opening calculations

- The command remains available from the Command Palette and Explorer context menu.
- Explorer matching accepts case variants of the canonical filename, including `OUTCAR` and `outcar`.
- The open dialog accepts either one OUTCAR file or one calculation directory.
- The selected path is still canonicalized and must resolve to a readable regular OUTCAR before a panel opens.
- Failed activation and failed calculation opening show distinct messages. Errors must include an actionable next step rather than the current generic failure text.
- Context-menu and dialog opens continue to use automatic declarative-profile detection.
- `analyzer OUTCAR --profile /path/profile.toml` sends the canonical readable profile path in the authenticated local handoff request. The extension passes that path as a non-shell argument to `analyzer serve --stdio --profile ...`; Python performs the existing strict TOML validation.
- An editor panel is identified by calculation root plus selected profile identity, so opening the same calculation with two profiles cannot silently reuse the wrong parser session.
- The handoff schema accepts no profile contents, executable hooks, or arbitrary code.

## Viewer Layout

### Compact toolbar

The structure region starts with a single compact toolbar targeted at 34–40 px height. It contains only:

- calculation name;
- ionic-step slider;
- ionic-step integer input and `/ total` guide;
- force-scale logarithmic slider;
- force-scale numeric input/readout with an `×` suffix;
- structure full-screen toggle.

Labels may collapse responsively, but the current numeric values remain visible. Narrow layouts may wrap once only if the controls cannot remain usable at the minimum supported editor width.

### Draggable crystal-tools palette

Supercell repeat, layer visibility, direct/reciprocal direction controls, projection mode, strongest-site focus, view reset, and layout reset move into `DraggableCrystalPalette`.

- The palette starts collapsed for a new Webview.
- Its header is the only drag handle, so form controls remain directly interactive.
- Dragging is limited to the structure viewport; the palette cannot be left entirely off-screen.
- The expanded size is content-driven with viewport-aware maximum width and height and internal scrolling when required.
- The last bounded position and collapsed state are stored in VS Code Webview state.
- On viewport resize, an invalid stored position is clamped to the closest visible position.
- `Reset layout` restores the default collapsed state and default top-left safe position.

### Resizable workspace

The horizontal splitter between structure and convergence remains the primary height control.

- Pointer dragging allows the structure region to grow from a usable minimum to nearly the full workspace.
- A small convergence minimum remains while not in full-screen mode so the splitter can always be recovered.
- Arrow keys adjust the split in fixed increments; Home and End select the supported minimum and maximum.
- The chosen split is persisted.

### Atom inspector

The atom inspector remains adjacent to the crystal rather than floating over it.

- Before atom selection, it is collapsed to a narrow affordance instead of reserving the current fixed width.
- After selection it may open to the last stored width.
- Its left boundary is a keyboard- and pointer-operable vertical splitter.
- The width is clamped to preserve a usable crystal viewport and a readable inspector.
- The inspector can be explicitly collapsed and reopened.

### Structure full-screen mode

Full-screen mode means full use of the Webview editor area, not native operating-system full screen.

- The convergence region and both splitters are hidden.
- The compact toolbar, crystal viewer, crystal palette, and optional atom inspector remain available.
- `Escape` and the toolbar toggle leave full-screen mode.
- Entering full-screen records the previous split and inspector state; leaving restores them exactly.

## Ionic-Step Control

`IonicStepControl` becomes a slider plus integer input sharing a single array-index state.

- The user sees 1-based values such as `42 / 120`.
- The slider range is `1..total`.
- The integer input accepts only whole values in that range.
- A valid edit updates structure coordinates, force arrows, convergence selection, and exact step values through the existing shared selected-step state.
- During an empty or temporarily invalid edit, the last valid selected step remains active. Blur or Enter clamps the draft to the nearest valid value and normalizes the displayed text.
- Graph-point selection updates both slider and number input.

No second OUTCAR-native step number is shown in this control.

## Force-Scale Control

The force-vector scale becomes a logarithmic slider paired with numeric entry.

- Minimum: `1×`
- Maximum: `1000×`
- Default for a new Webview: `10×`
- The slider uses logarithmic mapping so low multipliers retain useful precision while 1000× remains reachable.
- The numeric input accepts positive decimal values, clamps on blur or Enter, and synchronizes with the slider.
- The current multiplier is displayed prominently with an `×` suffix, for example `250×`.
- The renderer continues to receive one finite numeric scale; it does not need to understand slider mapping.
- Existing invalid persisted scale values are migrated by clamping to the new range. Absence of a persisted value uses 10×.

## Component Boundaries

- `CompactToolbar`: composes the step control, force control, and full-screen action.
- `IonicStepControl`: owns only slider/input draft behavior and emits a validated array index.
- `ForceScaleControl`: owns logarithmic mapping, numeric draft behavior, formatting, and emits a finite multiplier.
- `DraggableCrystalPalette`: owns crystal-tool presentation, drag mechanics, collapsed state, and bounded placement. Crystal rendering commands remain passed through the existing renderer interface.
- `ResizableWorkspace`: owns structure/convergence split and structure full-screen restoration.
- `ResizableAtomInspector`: owns inspector collapse and width, while `AtomDetail` remains responsible for scientific content.
- Analysis store/persistence adapter: owns stable selected step/site and layout preferences without mixing DOM coordinates into scientific dataset models.
- Extension activation/package entrypoint: owns command registration and editor-panel lifecycle; Python parsing remains in the existing analyzer process.

These units communicate through typed props/actions. Layout state must not enter the immutable calculation dataset or cache key.

## Persistence Model

Persist one versioned Webview-state object containing:

- selected step and selected site;
- force mode and force scale;
- structure/convergence split;
- atom-inspector width and collapsed state;
- crystal-palette position and collapsed state.

Full-screen mode itself is session-only to avoid reopening a calculation into an unexpected hidden-analysis state. Invalid, missing, or older layout fields use safe defaults independently rather than discarding valid scientific selection state.

## Error Handling

- Extension activation failures must remain visible in the Remote Extension Host log and must not masquerade as a missing command in supported packaging tests.
- CLI handoff failures print an actionable error and do not launch a browser unless browser mode was explicit.
- Invalid numeric drafts do not dispatch `NaN`, infinity, fractional ionic steps, or out-of-range values.
- Drag and resize operations clamp values at their source and on viewport resize.
- WebGL failure continues to expose synchronized tabular data and step selection; floating crystal-only controls are hidden when the renderer fallback is active.

## Verification

### Unit and component tests

- ionic-step slider/input bidirectional synchronization, graph selection, empty drafts, Enter/blur normalization, and `1..total` bounds;
- logarithmic force mapping at 1×, 10×, representative intermediate values, and 1000×;
- numeric force entry, prominent multiplier display, migration/clamping, and finite renderer input;
- palette initial collapse, expand, bounded dragging, resize re-clamping, persistence, and reset;
- horizontal and vertical splitters by pointer and keyboard;
- full-screen entry, Escape exit, and exact prior-layout restoration;
- atom-inspector collapse, reopen, and width bounds;
- lower- and upper-case OUTCAR context eligibility and file/folder command handling;
- default CLI handoff failure never invokes the browser launcher, while explicit `--web` still does.

### Package and integration tests

- build the Webview and CommonJS extension entrypoint;
- package the VSIX;
- inspect the manifest `main` path and confirm that exact file exists;
- load the packaged CommonJS entrypoint under Linux-compatible Node semantics with a controlled VS Code stub;
- verify command registration after activation;
- run existing Python, TypeScript, offline-asset, wheel, sdist, and VSIX gates;
- perform a manual Remote SSH acceptance pass: install the VSIX on the remote workspace host, reload, open a new integrated terminal, run `analyzer OUTCAR`, and confirm the editor tab opens without a browser.

## Out of Scope

- A character-cell terminal TUI or terminal image protocol renderer;
- replacing 3Dmol or the existing crystal renderer;
- DOS, band, charge, or isosurface implementation;
- arbitrary user plugin code;
- native OS full-screen or a separate desktop application.
