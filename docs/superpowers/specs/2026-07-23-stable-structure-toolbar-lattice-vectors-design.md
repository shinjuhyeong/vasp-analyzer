# Stable Structure Toolbar and Lattice Vector Toggle Design

## Goal

Keep the ionic-step slider and the rest of the structure toolbar stationary when switching between the initial structure and ionic steps, and provide an explicit on/off control for the crystallographic lattice vectors.

## Toolbar Layout

The structure toolbar uses two persistent rows.

- The primary row contains the calculation title, ionic-step slider and number input, and structure expand/restore control.
- The secondary row is a fixed-height control dock. On the initial frame it contains comparison controls. On an ionic frame it contains force-component and force-scale controls.
- Enabling comparison may change controls within the secondary row, but it must not change either row's height or the primary row's position.
- Controls that do not fit remain in the secondary dock using horizontal overflow. They must not wrap onto a third row or increase the toolbar height.
- Hidden mode-specific controls are removed from keyboard and accessibility navigation; layout stability comes from the fixed dock dimensions, not focusable invisible controls.

The ionic-step slider and numeric input therefore keep the same screen position for the initial frame, every ionic frame, and comparison on/off transitions.

## Lattice Vector Layer

Crystal tools exposes a layer checkbox labelled `Lattice vectors (a, b, c)`.

- It controls the existing renderer `axes` layer, which represents the origin-based crystallographic a, b, and c direction glyphs and labels.
- It is independent of the `cell` layer, so hiding lattice vectors does not hide unit-cell edges.
- It defaults to enabled, preserving the current initial rendering.
- The internal renderer contract retains the `axes` layer name for compatibility; only the user-facing label becomes explicit.

## State and Data Flow

No parser or dataset schema change is required. Toolbar mode is derived from the selected frame already held in the analysis state. Lattice-vector visibility remains local CrystalPanel layer state and is sent through the existing `setLayerVisible("axes", visible)` renderer API.

## Testing

- Component tests assert the persistent primary and secondary toolbar rows in initial, ionic, comparison-disabled, and comparison-enabled states.
- Layout tests assert a stable toolbar contract: no wrapping and fixed secondary-dock sizing, with overflow contained inside the dock.
- CrystalPanel tests assert the explicit lattice-vector checkbox defaults on and sends `axes=false` without changing `cell=true`.
- Renderer tests continue to verify that axes and cell visibility are independent.
- The full Webview test, typecheck, and production build gates must pass.

## Scope

This change does not persist lattice-vector visibility across sessions, redesign comparison behavior, alter force/displacement scaling, or change the parser. It only stabilizes the existing structure toolbar and exposes the existing lattice-vector layer clearly.
