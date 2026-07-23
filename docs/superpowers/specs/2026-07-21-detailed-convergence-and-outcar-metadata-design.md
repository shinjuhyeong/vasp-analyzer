# Detailed Convergence and OUTCAR Metadata Design

Date: 2026-07-21

## Purpose

Extend the standalone VASP Analyzer with detailed, step-synchronized convergence inspection while preserving its streaming, profile-driven OUTCAR parser and crystal-first Remote SSH workflow.

This increment must:

- repair dragging of the collapsed Crystal tools control;
- make all atom-related text over the crystal viewport readable;
- expose synchronized slider and numeric ionic-step controls inside the convergence workspace as well as in the compact toolbar;
- replace fixed convergence plots with a multi-select, responsive analysis-module workspace;
- expose complete selected-step energy, atom position/force, cell, pressure, and stress tables;
- parse effective parameters reported by OUTCAR and expose interpreted and raw views;
- preserve declarative home-VASP compatibility profiles, incomplete-tail recovery, cache safety, and future DOS, band, charge, and volumetric boundaries.

## Scope

### Included

- `Energy`, `Force`, and `Cell & Stress` convergence modules.
- A `Parameters` analysis tab.
- OUTCAR energy-breakdown, pressure, stress, volume, and effective-parameter parsing.
- Dataset, checkpoint, cache, wire-contract, and persisted-view-preference migrations required by those features.
- Read-only validation against the configured real OUTCAR corpus.

### Excluded

- DOS, band, charge-density, or isosurface parsing/rendering.
- A plugin API or executable parser hooks.
- A 3D stress ellipsoid or principal-stress glyph.
- Guessing whether a reported parameter was explicitly supplied by the user or selected by a VASP default.

## Viewer Interaction Repairs

### Collapsed Crystal tools dragging

The collapsed palette is not one ambiguous click-and-drag button. It renders as a bounded compact container with:

- a visible drag handle and `Crystal tools` label that own pointer capture and drag events;
- a separate accessible expand button;
- the same immediate and `ResizeObserver`-driven viewport clamping as the expanded palette;
- pointer cancel, release, transition, and unmount cleanup.

Interactive descendants never initiate drag. Keyboard users can reach and operate the expand button without triggering movement.

### Crystal overlay text

Atom-related text drawn over the crystal viewport uses white foreground text on a translucent dark backing. This applies to:

- the element legend;
- the selected-atom overlay;
- atom hover labels.

The rule is scoped to viewport overlays. General panel text continues to use VS Code theme colors. Direct-lattice axis labels retain their a/b/c colors so direction identity is not lost.

## Ionic-Step Control

The compact toolbar and convergence workspace each render a slider and integer number input. Both are controlled views of the same zero-based selected-array-index state and display a one-based `current / total` value.

Requirements:

- changing either control updates the crystal frame, every selected analysis module, and selected-step tables;
- typed drafts remain editable until blur or Enter;
- empty or invalid drafts restore the current value without dispatch;
- values clamp to the available step range;
- parser step identifiers remain display metadata and never replace the array index used for selection.

The old chart-point button list is removed. Chart marks may remain pointer/keyboard selectable without creating a second list of per-step buttons.

## Convergence Workspace

### Module selection and layout

The workspace exposes multi-select toggles for:

- `Energy`;
- `Force`;
- `Cell & Stress`.

The first normalized preference state selects only `Energy`. Subsequent module selections, per-module metric selections, and Graph/Table modes are persisted and restored. Unsupported or empty persisted module sets normalize to `Energy`.

Selected modules occupy equal shares in a responsive grid:

- one module fills the available region;
- two modules use two equal columns when feasible;
- three use three equal columns at wide widths and a balanced wrapped grid at narrow widths;
- four future modules use a balanced 2x2-style grid when feasible;
- no module may shrink below its readable minimum; narrow layouts wrap rather than introduce horizontal page overflow.

### Independent module state

Each module independently owns:

- its selected metric;
- `Graph` or `Table` presentation mode.

Graph mode plots exactly one metric. Its y-axis range, label, and unit are computed for that metric only. Null values create gaps and are never converted to zero.

### Energy module

Initial metric: `Total energy`.

Graph metrics include at minimum:

- total energy;
- energy change.

Table mode displays the complete energy breakdown for the selected ionic step. Each row contains:

- canonical key when recognized;
- original OUTCAR label;
- numeric value;
- unit;
- classification as contribution or aggregate.

Recognized contributions include VASP-emitted variants of Ewald, Hartree, exchange-correlation, PAW double counting, entropy `T*S`, eigenvalues, and atomic energy. Recognized aggregates include `TOTEN`, energy without entropy, and sigma-to-zero energy. Unknown finite numeric terms are retained with their raw label.

Aggregate rows are visually distinct but excluded from contribution ranking. Among eligible finite contribution rows, the greatest and second-greatest absolute values receive stable first- and second-rank highlights. Ties use original OUTCAR order as the deterministic tiebreaker.

### Force module

Graph metrics include at minimum:

- strongest free component;
- RMS free force.

Table mode displays every atom for the selected ionic step with:

- element and one-based site number;
- Cartesian position x/y/z in angstrom;
- raw force Fx/Fy/Fz in eV/angstrom;
- selective-dynamics a/b/c state;
- derived free Cartesian force x/y/z when known;
- raw and free force norms.

Ranking considers individual free-force components after Selective Dynamics projection, not constrained raw components. The greatest and second-greatest absolute eligible components receive distinct highlights. Unknown constraints do not produce a fabricated free-force rank.

Selecting an atom row synchronizes the Crystal viewer selection and Atom Inspector without changing the ionic step.

### Cell & Stress module

Graph metrics include at minimum:

- external pressure;
- cell volume.

Table mode displays selected-step:

- external pressure;
- Pulay stress when reported;
- cell volume;
- the complete 3x3 stress tensor.

Stored pressure and stress values preserve the VASP OUTCAR sign convention and use kB as the canonical unit. The UI labels that convention and also displays the exact `1 kB = 0.1 GPa` conversion. It does not silently reinterpret tensile/compressive signs.

The structure region shows a compact selected-step status overlay for external pressure, Pulay stress, and volume when any of those values is available. Missing values render as `Unavailable`; if none exist, the overlay is omitted.

## Parameters Analysis Tab

The lower Analysis tab list gains `Parameters` alongside convergence and future analysis capabilities.

### Interpreted view

Recognized parameters are grouped into stable categories such as:

- electronic;
- ionic;
- spin;
- exchange-correlation;
- parallelization;
- output.

Each row displays key, effective reported value, optional unit, concise interpretation, and source occurrence. The last reported occurrence of a repeated key is shown as the effective value.

### Raw view

Raw mode preserves every parsed occurrence in OUTCAR order, including repeated and unknown home-version keys. It displays the original key and raw value text without claiming whether the value came from the user's INCAR or a VASP default.

Search applies to keys, values, category names, and known descriptions. Category filtering affects the interpreted view and never deletes underlying raw occurrences.

## Domain and Wire Contracts

### Step details

Each `IonicStep` gains optional immutable fields for:

- ordered energy terms;
- external pressure;
- Pulay stress;
- stress tensor;
- cell volume.

An energy term preserves canonical key, raw label, finite numeric value, canonical unit, and contribution/aggregate classification.

### Calculation parameters

`CalculationDataset` gains an ordered immutable collection of parameter occurrences. Each occurrence preserves:

- normalized key;
- raw key;
- raw value;
- typed scalar or tuple value when safely recognized;
- optional canonical unit and category;
- source order or location metadata.

Unknown values remain strings. No lossy boolean, integer, or floating-point coercion is permitted.

### Versioning

The public dataset/wire schema and application-cache schema advance to a new version. Old serialized application caches fail closed and rebuild from source. Viewer preference normalization migrates the prior layout state by adding:

- selected convergence modules, defaulting to Energy;
- per-module metric and mode state.

Full-screen state remains session-only.

## Streaming Parser Architecture

The existing byte-oriented recovery scanner remains authoritative for record boundaries and home-dialect normalization. ASE remains authoritative for the trajectory fields it already supplies. No additional full-file parser pass is introduced.

### Ionic record assembly

The scanner attaches complete energy and stress-related blocks encountered after a force block to that pending ionic record. A pending record is finalized only at an existing stable boundary such as the next record start or normal termination.

Checkpoint state includes any information required to resume without shifting energy or stress details to the wrong ionic step. Resume reconciliation remains keyed by `step_id`.

### Effective parameter collection

Effective-parameter sections are collected as ordered occurrences while scanning the bounded header and subsequent recognized parameter sections. Repeated keys are retained. Dataset assembly derives the interpreted effective map without removing the occurrence history.

### Declarative compatibility profiles

Profiles may declare:

- energy-section markers and aliases;
- energy-label aliases and canonical mappings;
- pressure/stress/volume markers;
- parameter-section markers;
- safe prefix-column or whitespace normalization rules already permitted by the profile model.

Profiles remain declarative TOML. They cannot execute Python, shell commands, expressions, or arbitrary regular expressions outside the repository's validated rule vocabulary. Invalid or ambiguous rules fail closed with a profile error.

Unknown finite energy labels and parameter keys within a recognized complete section are preserved instead of rejected.

## Incomplete and Invalid Input Policy

- Missing optional blocks produce null or empty detail collections.
- A physically incomplete final block produces an `IncompleteTail` warning and only exposes fields that crossed a verified boundary.
- A malformed complete recognized block raises a format error with safe byte/line context.
- Non-finite numeric values are rejected.
- Atom counts, stress tensor shape, and units must satisfy exact structural validation.
- No parser path invents zeroes for unavailable values.
- Parameters that cannot be typed safely remain raw strings.

## Component Boundaries

- `IonicStepControl` owns input drafts and emits validated selection indices.
- `ConvergenceWorkspace` owns module selection and responsive equal-share composition.
- Each analysis module owns only metric/mode selection and presentation.
- Pure selectors derive graph series, detailed table rows, rankings, and formatted units from immutable contracts.
- Energy, force, cell/stress tables are independent components with accessible captions and sortable semantics only where explicitly implemented.
- `ParametersPanel` owns interpreted/raw presentation and local search/filter state.
- Parser adapters do not import Webview concepts; Webview components do not infer scientific values from display strings.

## Accessibility

- Module toggles expose pressed state and readable names.
- Graph/Table and metric selectors use native buttons or radios with selected state.
- Tables use captions and semantic headers.
- First/second-rank highlights pair color with visible rank text or icons; color alone is never the only indicator.
- Atom rows are keyboard selectable.
- Every chart has a concise accessible name and exact selected-step values remain available outside SVG.
- Overlay text maintains readable contrast in light and dark VS Code themes.

## Verification

### Parser and model tests

- Known and unknown energy labels, raw-label preservation, aggregate classification, and deterministic absolute ranking.
- External pressure, Pulay stress, cell volume, tensor shape, sign, and unit preservation.
- Repeated and unknown effective parameter occurrences and typed-value safety.
- Profile aliases and rejected executable/ambiguous rules.
- Complete malformed blocks, non-finite values, incomplete tails, checkpoint serialization, and append resume.
- Dataset/cache/wire version rejection and migration behavior.

### Webview tests

- Collapsed-palette drag handle, separate expand action, pointer lifecycle, viewport re-clamping, and observer cleanup.
- Viewer-overlay contrast classes without changing axis identity colors.
- Toolbar/workspace ionic controls remain synchronized and chart-point button lists are absent.
- Initial Energy-only module state, multi-select persistence, unsupported-state normalization, and responsive equal-share wrapping.
- Independent metric and Graph/Table state for every module.
- Single-metric axes and null gaps.
- Complete selected-step energy, force, and stress tables; deterministic rank highlights; atom-row/viewer synchronization.
- Parameters interpreted/raw/search/filter behavior.

### Integration and release gates

- Full Python suite excluding opt-in corpus tests and Ruff.
- Full VS Code tests, typecheck, build, offline URL scan, VSIX packaging, and actual archived CommonJS entrypoint load.
- Wheel and sdist builds with installed-wheel CLI/stdio/no-implicit-browser smoke tests.
- Read-only configured real-corpus aggregate test and largest-file application-cache/append-resume test.
- Manual Linux Remote SSH installation and validation of editor handoff, lower/mixed-case OUTCAR opening, GPU rendering/fallback, module layout, detailed tables, and Parameters views.

## Git and Delivery

Work is added as scoped commits to the existing `agent/vasp-analyzer-v1` branch and public draft PR. The PR remains draft until the live Remote SSH acceptance checklist is recorded. Generated wheel, sdist, and VSIX files remain uncommitted build artifacts.
