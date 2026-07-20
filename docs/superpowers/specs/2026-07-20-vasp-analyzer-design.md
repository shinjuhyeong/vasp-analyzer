# Standalone VASP Analyzer Design

## 1. Purpose

Build an offline, standalone VASP analysis application for calculations opened through VS Code Remote SSH. After installation with `pip` or `pipx`, the user can analyze the current directory, a calculation directory, or an `OUTCAR` path with the `analyzer` command. The primary interface is a VS Code Webview editor tab; a browser interface remains an optional fallback.

The first release focuses on crystal structure inspection and ionic/electronic convergence. Its internal boundaries must allow later built-in DOS, band-structure, and charge-density analysis without redesigning the structure viewer or parser core. The application does not expose a third-party plugin API.

## 2. Scope

### 2.1 First release

- Install the Python analysis core with `pip install` or `pipx install`.
- Accept `analyzer`, `analyzer OUTCAR`, and `analyzer <calculation-directory>`.
- Open an `OUTCAR` from the VS Code Explorer context menu or Command Palette.
- Run in a VS Code Remote SSH session without an HTTP server or forwarded port.
- Parse structures, ionic steps, energies, forces, electronic iterations, and convergence state.
- Render a crystallography-specific ball-and-stick view with unit cell, crystal axes, periodic bonding, supercells, crystallographic view directions, rotation, pan, and zoom.
- Visualize force vectors and Selective Dynamics directions.
- Synchronize the selected ionic step across the structure, forces, convergence plots, and exact-value panel.
- Identify the atom and axis with the strongest unconstrained force component.
- Work offline after installation.

### 2.2 Deferred built-in modules

- Total and projected DOS.
- Band structures and projected bands.
- Charge density, charge-density difference, ELF, and electrostatic-potential analysis.
- Bader and Critic2 result integration.

These modules are not implemented in the first release, but the common data model, UI module boundary, atom identity, and volumetric rendering contract are part of the first-release design and tests.

### 2.3 Out of scope

- A public or third-party plugin API.
- Cloud services, user accounts, or remote data upload.
- A Qt/X11 native GUI.
- Requiring Node.js on the calculation host at runtime.

## 3. Architecture

The system has three independently testable layers:

```text
VS Code Webview
      <-> JSON messages
VS Code Extension
      <-> newline-delimited JSON over stdin/stdout
Python analyzer core
      <->
VASP calculation files
```

### 3.1 Python analyzer core

The Python package owns file discovery, parsing, normalization, derived quantities, cache management, and analysis operations. It does not depend on VS Code. Its feature boundaries are explicit:

```text
src/vasp_analyzer/
|- core/             immutable shared models, configuration, and errors
|- calculation/      discovery, calculation assembly, sessions, and cache
|- parsing/
|  |- adapters/      ASE and pymatgen integration
|  |- dialects/      format detection and built-in compatibility behavior
|  |- profiles/      versioned declarative user profiles
|  `- recovery/      incomplete-file recovery and incremental indexing
|- structure/        constraints, forces, bonds, and supercells
|- convergence/      ionic and electronic convergence analysis
|- transport/        editor and browser communication
`- cli/              command-line entry points
```

The future `electronic/` and `volumetric/` packages are added when their first features are implemented rather than created as empty placeholders. Their contracts are defined by this design so they can consume the same calculation and site identities later.

The CLI modes are:

- `analyzer`: discover a calculation in the current directory. In an integrated terminal registered by the VS Code extension, request a Webview tab from that extension; otherwise start the browser fallback.
- `analyzer <path>`: accept an `OUTCAR` path or calculation directory.
- `analyzer serve --stdio <path>`: provide the VS Code extension with newline-delimited JSON request/response messages.
- `analyzer --web [<path>]`: start the optional local browser fallback.
- `analyzer --port <port>`: select a fixed browser-fallback port.
- `analyzer --no-open`: print the browser-fallback URL without attempting to open it.
- `analyzer <path> --profile <profile.toml>`: force a validated compatibility profile.
- `analyzer dialect validate <path> --profile <profile.toml>`: validate a profile and show the rules it would apply without opening the UI.
- `analyzer corpus validate <path>`: run the local calculation-corpus validation suite and produce an aggregate report without copying source files.

### 3.2 VS Code extension

The extension contributes:

- An Explorer context-menu action for files named `OUTCAR` and calculation directories.
- A `VASP Analyzer: Open` Command Palette command.
- A Webview editor panel containing bundled renderer and chart assets.

In a Remote SSH workspace, the extension launches `analyzer serve --stdio` on the remote extension host. The Webview communicates through the extension's message channel. It does not contact a `localhost` server. The extension is a fixed presentation adapter for the standalone analyzer, not an analysis plugin system.

The extension also owns a small control endpoint on the remote host: a Unix-domain socket on Linux/macOS or named pipe on Windows. It injects the endpoint path and a per-session authentication token into new VS Code integrated terminals through the extension environment API. When `analyzer` is typed in such a terminal, the CLI sends only the canonical, readable calculation path and token to this endpoint, then exits. The extension verifies the token and path readability, opens the Webview, and starts the standard-input/output analysis process. This preserves the requested terminal command without relying on undocumented `code` command-line flags or an HTTP port. Stale or invalid endpoints fall back to the browser mode with a clear message.

### 3.3 Offline assets and renderer isolation

3Dmol.js and all frontend assets are bundled into the VS Code extension and browser-fallback package. Runtime CDN access is prohibited.

3Dmol.js is isolated behind a `CrystalRenderer` interface. The renderer consumes normalized atoms, bonds, lattice vectors, vector glyphs, and volumetric layers. Parsing and DOS/band plots do not depend on 3Dmol.js. This allows the volumetric layer to move to another renderer, such as vtk.js, without changing parser or analysis contracts.

## 4. Calculation Data Model

`CalculationDataset` is the shared, parser-independent representation of one VASP run. UI and analysis modules never receive ASE or pymatgen objects directly:

```text
CalculationDataset
|- metadata
|- source_files
|- sites
|- ionic_steps
|- convergence
|- electronic_structure
|  |- dos
|  `- band_structure
`- volumetric_fields
```

### 4.1 Stable atom identity

Each atom has a calculation-wide `site_index`, element, initial fractional and Cartesian positions, and Selective Dynamics mask. All structures, forces, PDOS, projected bands, volumetric annotations, and future charge analyses reference this identity. Replicated supercell atoms carry the original `site_index` plus a lattice-image vector; they do not become new calculation sites.

### 4.2 Ionic-step data

Each complete ionic step stores:

- Lattice vectors and cell parameters.
- Fractional and Cartesian coordinates.
- Raw Cartesian forces per atom.
- Selective-Dynamics-filtered forces per atom.
- Free-force norm per atom.
- Total energy, step-to-step energy change, and relevant energy terms when available.
- Electronic iteration count and electronic convergence state.
- Ionic convergence state when it can be determined.
- The strongest unconstrained force component.
- RMS free force.

Incomplete calculations expose every fully parsed ionic step. A trailing partial step is excluded rather than combined with data from the previous step.

### 4.3 Strongest-force definition

For atom `i` and direct-lattice direction `d` in `a`, `b`, `c`, a directional force is eligible only when the corresponding Selective Dynamics value is `T`. Selective flags always refer to direct directions, even when POSCAR coordinates are Cartesian. Among all eligible unit-vector projections, the strongest force is:

```text
argmax_(i,d) abs(dot(F_cartesian[i], unit(d)))
```

The result retains the site index, direct direction, signed force, and absolute force; ties use site order followed by `a`, `b`, `c`. The free Cartesian force is the Euclidean orthogonal projection onto the span of allowed direct vectors. Non-orthogonal directions may produce correlated directional values. Fixed (`F`) directions do not affect the maximum or RMS directional metrics. The UI still shows raw Cartesian `Fx/Fy/Fz` for comparison.

## 5. File Discovery and Parsing

### 5.1 Discovery

The parser discovers recognized files in the selected calculation directory. The first release uses `OUTCAR`, `POSCAR`, and `CONTCAR`; later modules may use `vasprun.xml`, `DOSCAR`, `EIGENVAL`, `PROCAR`, `CHGCAR`, `AECCAR*`, `ELFCAR`, and `LOCPOT`.

Optional files are parsed lazily when their analysis module is first opened. The core structure dataset and its cache identity include only `OUTCAR`, `POSCAR`, and `CONTCAR`; discovery may inventory optional filename/stat metadata but disabled capabilities do not read or hash optional contents. Each future analysis module owns its source fingerprints and cache. Cache identities also include the selected dialect, a canonical hash of the full validated profile, analyzer version, and explicit cache/parser schema versions. The default cache is private per user rather than shared temporary storage and uses same-directory unique temporary files plus atomic replacement.

### 5.2 Parser adapters

The analyzer uses existing libraries where they provide mature VASP support:

- pymatgen parses normalized `POSCAR` and `CONTCAR` files and later supplies `vasprun.xml`, DOS, band, and volumetric-file support.
- ASE streams `OUTCAR` lattice, coordinates, energies, and forces.
- A narrow analyzer-owned scanner extracts convergence markers not exposed consistently by those libraries, recovers complete records from interrupted files, and indexes large files incrementally.

Each ASE step is converted immediately into compact immutable arrays and the temporary `Atoms` object is released. Neither library's internal objects cross the adapter boundary. This keeps structure and convergence logic independent of parser choice and avoids retaining a second heavy object graph for long trajectories.

### 5.3 Dialects and user compatibility profiles

A *dialect* describes compatible VASP syntax, not a Python exception type. `standard` is the default built-in dialect. `home_barrier` is the first special implementation and detects the observed `vasp.5.4.1-barrier` header. Automatic detection uses deterministic, scored literal markers; a command-line profile can override it.

Users can define simple future variants in a versioned TOML profile. Profiles may declare literal detection markers, marker aliases, narrowly defined line normalization, block anchors, expected column counts, units, and incomplete-tail policy. They cannot import modules, execute Python, run shell commands, or supply unrestricted executable code. Complex layout changes that cannot be expressed safely become tested built-in dialects in the repository.

An illustrative profile is:

```toml
schema_version = 1
id = "my-home-vasp"
display_name = "My Home VASP"

[detection]
outcar_contains = ["vasp.5.4.1-barrier"]
priority = 100

[poscar]
drop_exact_line_after = "Selective dynamics"
drop_exact_line = "0"

[outcar.markers]
position_force = ["POSITION", "TOTAL-FORCE"]
total_energy = ["free energy", "TOTEN"]
converged = ["reached required accuracy"]

[validation]
expected_force_columns = 6
allow_incomplete_tail = true
```

Profile loading is fail-closed: an unknown schema version, unsupported operation, invalid type, ambiguous rule, or failed post-normalization validation prevents the profile from being used.

### 5.4 POSCAR compatibility rule

The parser accepts both standard POSCAR syntax and the home-VASP variant:

```text
Selective dynamics
0
Direct
```

The `home_barrier` normalizer handles the standalone `0` before handing the normalized content to pymatgen. After `Selective dynamics`, it identifies the coordinate-mode line semantically. A standalone integer metadata line may appear before `Direct` or `Cartesian` and is preserved as compatibility metadata but excluded from coordinates. The rule is deliberately narrow: arbitrary unrecognized lines are not silently skipped. A malformed file produces an error containing the line number and content.

### 5.5 OUTCAR recovery and incremental parsing

An interrupted OUTCAR is a supported state. A structure step is emitted only after its complete position/force block passes atom-count and column-count validation. A completed structure whose energy has not yet been written remains available with an explicit missing-energy value. An incomplete electronic iteration or partial force block at the physical end of the file is discarded with an `IncompleteTail` warning; data from a previous step is never reused to fill it.

Records are joined by explicit parser step identifiers rather than by padding arrays to equal length. The cache stores the source fingerprint and last verified byte offset. An appended running file resumes from that checkpoint. Replacement, truncation, or incompatible fingerprint changes invalidate the checkpoint and cause a clean reparse.

### 5.6 Structure reconciliation

The parser reconciles structures from `POSCAR`, `CONTCAR`, and `OUTCAR` only when atom counts and species ordering agree. It does not guess an atom mapping when they differ. Conflicts are reported with both source filenames and counts.

## 6. User Interface

The Webview uses a vertically split analysis workspace. The upper crystal viewer is the primary surface. The lower analysis area shows convergence details and hosts future built-in analysis tabs.

### 6.1 Crystal viewer

The viewer provides:

- Crystallographic ball-and-stick rendering rather than a generic 3D scatter plot.
- Unit-cell edges and an `a`/`b`/`c` orientation triad.
- `[100]`, `[010]`, and `[001]` presets plus an arbitrary `[hkl]` direction.
- Mouse rotation, pan, zoom, reset, and optional orthographic projection.
- `a x b x c` periodic supercell replication.
- Bonds across periodic boundaries and consistent original-site identity for replicated atoms.
- Independent visibility controls for cell, bonds, forces, Selective Dynamics, and future volumetric layers.
- Element colors, radii, and a compact legend.

### 6.2 Atom selection

Clicking an atom selects its original site, highlights every requested periodic image consistently, and opens a detail panel containing:

- Element and site index.
- Fractional and Cartesian coordinates.
- Raw `Fx`, `Fy`, `Fz`, and force norm.
- Filtered free-force components and norm.
- `T/F` Selective Dynamics values for direct directions `a`, `b`, and `c`.
- Whether the site and axis contain the current step's strongest free component.

The same selected-site state is shared with later site-PDOS, projected-band, and charge-analysis views.

### 6.3 Selective Dynamics rendering

`T` means motion is allowed and `F` means it is fixed along the corresponding direct lattice direction, regardless of POSCAR coordinate input mode. The selected or hovered atom shows the normalized current `a`/`b`/`c` vectors with direction-specific state. A global mode marks atoms that have at least one fixed direction, while detailed glyphs remain focused on selected or hovered sites. Without a Selective Dynamics section all flags are `T`; OUTCAR-only masks remain unknown.

### 6.4 Force rendering

Forces are arrows originating at their atoms. The default vector uses only free components. A control can display raw forces for comparison. A scale slider changes arrow length without changing values. The strongest free component is highlighted, and selecting its summary focuses the corresponding atom.

### 6.5 Ionic-step synchronization

One ionic-step state controls the structure, force arrows, energy curve, force curve, and exact-value panel. Moving the slider or selecting a graph point updates every view. Coordinate and vector transitions animate briefly and honor reduced-motion settings.

### 6.6 Convergence area

The lower area contains:

- Total energy and step-to-step energy change.
- Maximum unconstrained force component.
- Per-atom free-force norm and RMS free force.
- Electronic SCF iteration count.
- Electronic and ionic convergence state.
- Exact values for the selected ionic step.

The long-term tab layout is:

```text
Convergence | DOS/PDOS | Band | Charge
```

## 7. Volumetric and Charge-Density Extension Contract

The crystal scene is a composition of independent layers:

```text
unit cell and axes
atoms and bonds
force vectors
Selective Dynamics markers
volumetric isosurfaces
slice planes
```

The future Charge tab can select `CHGCAR`, charge-density differences, `AECCAR*`, `ELFCAR`, or `LOCPOT`; control positive and negative isovalues, colors, and opacity; toggle surfaces; and position lattice-aligned 2D slices.

Every volumetric field stores the source lattice, grid shape, units, field kind, and value range. The backend validates lattice compatibility before overlaying it on a structure. Supercell replication applies the same lattice-image transformation to atoms and volumetric data.

Large volumetric arrays are not repeatedly serialized to the Webview. The UI requests a downsampled grid, slice, or isosurface mesh. The backend caches products by source fingerprint and rendering parameters. Heavy mesh generation runs outside the interactive message loop so atom rotation and selection remain responsive.

## 8. Error Handling and Provenance

Failures are isolated by capability whenever the core structure dataset remains valid:

- With only `OUTCAR`, expose every available first-release feature.
- With a truncated `OUTCAR`, show the last fully completed ionic step and a nonfatal incomplete-run warning.
- On atom-count or species-order mismatch, do not combine structures; report the conflicting files and values.
- On an unsupported compatibility line, report the exact line and expected forms.
- When a deferred-module file is missing, disable only that module and list the required files.
- When a large or corrupt optional file fails, keep structure and convergence available.
- If WebGL rendering fails, provide parsed structure, force, and convergence tables as a fallback.
- When a Webview reloads, reconnect it to the Python dataset and restore the selected step and site when possible.

Parser failures have stable categories:

- `UnsupportedDialect`: no compatible dialect or forced profile can identify the source.
- `ProfileValidationError`: the profile schema or a declared rule is invalid.
- `MalformedBlock`: a required block has inconsistent atom or column counts.
- `IncompleteTail`: the file ends inside a record that may still be written.
- `DatasetConsistencyError`: sources or parsed step sequences cannot be reconciled safely.

`IncompleteTail` is nonfatal and preserves all earlier complete results. A malformed lattice, atom-count conflict, or inconsistent completed block suppresses the affected step instead of displaying a plausible but incorrect structure.

Every dataset records the adapter name and version, selected dialect and profile, normalization rules applied, ignored lines or incomplete blocks, source file size and modification time, and a cache fingerprint. Diagnostics refer to line numbers or byte offsets without copying whole blocks into logs.

Logs record source paths, parser stages, and concise causes. They do not dump full OUTCAR content, charge grids, or other large calculation data.

## 9. Testing

### 9.1 Parser fixtures

- Standard POSCAR.
- `Selective dynamics`, standalone `0`, then `Direct`.
- Direct and Cartesian coordinates.
- Selective Dynamics present and absent.
- Orthogonal and non-orthogonal lattices.
- Complete and truncated OUTCAR files.
- One and multiple ionic steps.
- Conflicting atom counts and species ordering.

### 9.2 Derived-data tests

- A fixed component whose magnitude exceeds every free component is excluded from the strongest-free-component result.
- Strongest-force site, axis, sign, and magnitude are retained.
- Free-force norms and RMS values respect all `T/F` masks.
- Stable site indices persist across ionic steps and supercell images.

### 9.3 Integration tests

- CLI input discovery for no argument, file path, and directory path.
- Integrated-terminal handoff through the authenticated extension control endpoint, including stale-endpoint fallback.
- Python-to-extension JSON request and response contracts.
- Ionic-step changes synchronize structure, forces, plots, and exact values.
- Atom selection returns the correct site data.
- Periodic bonds and supercell image identities remain correct.
- The Webview starts with network access disabled.
- Webview reload restores analysis state.
- Volumetric contracts preserve lattice alignment and reject incompatible grids.

### 9.4 Local OUTCAR corpus

The current development corpus contains 52 exact `OUTCAR` files under the user's local results tree, totaling 2,288,020,784 bytes. All currently identify themselves as `vasp.5.4.1-barrier`. Fifty contain ionic position/force blocks, with 12,909 blocks in total and between 1 and 3,000 blocks per file. Thirty-eight include the normal VASP timing footer and fourteen are running or otherwise incomplete. The corpus is an evolving opt-in local snapshot; these counts are the authoritative Task 14 acceptance baseline.

Raw corpus files and absolute local paths are never committed. `VASP_ANALYZER_CORPUS_DIR` selects the corpus for opt-in tests:

```text
pytest                          small, repository-safe fixtures
pytest -m corpus               local 52-file regression corpus
analyzer corpus validate PATH  aggregate validation report
```

Corpus acceptance requires:

- all 52 files are identified without a crash as `home_barrier`;
- the 38 complete and 14 incomplete calculations are distinguished;
- the 50 structural files expose every complete position/force block;
- parser step counts are compared with the 12,909 independently scanned block markers;
- atom, coordinate, force, and constraint dimensions agree at every completed step;
- invalid lattices, NaN, and infinite numerical values are rejected explicitly;
- selected numerical steps agree between the ASE adapter and the supplemental scanner; and
- interrupted tails preserve earlier complete steps and produce warnings rather than false success.

Repository fixtures contain only small, reviewed, sanitized cases needed for deterministic unit and adapter-contract tests. Corpus validation writes aggregate counts, timings, peak memory, warnings, and source fingerprints; it does not embed source content.

### 9.5 Performance regression tests

The 0.49 GB, 3,000-step case verifies that parsing does not duplicate the complete input in memory. The test records wall time and peak resident memory rather than imposing a machine-independent timing threshold. A second run verifies cache reuse, and an appended-file test verifies resumption from the last complete byte offset.

### 9.6 Visual and interaction tests

- Unit-cell and axis orientation for orthogonal and skewed lattices.
- Camera presets for crystallographic directions.
- Atom clicking, force scaling, step selection, and strongest-force focus.
- Layout at typical VS Code editor widths.
- A text/table fallback when WebGL initialization is forced to fail.

## 10. Acceptance Criteria

The first release is complete when:

1. The three supported CLI input forms work after `pip` or `pipx` installation; typing `analyzer` in a registered VS Code terminal opens the Webview tab.
2. A VS Code Remote SSH user can open an OUTCAR analysis tab without port forwarding or an external browser.
3. The supplied home-VASP POSCAR variant parses correctly without weakening validation of unrelated malformed files.
4. The viewer provides crystallographic axes, a unit cell, periodic bonds, supercells, rotation, zoom, and crystallographic view directions.
5. Clicking an atom shows positions, forces, and Selective Dynamics values.
6. Force arrows are scalable and the strongest unconstrained component is correctly identified and highlighted.
7. Structure, forces, convergence plots, and exact values remain synchronized across ionic steps.
8. A partially written OUTCAR remains inspectable through its last complete step.
9. The Webview works offline with bundled runtime assets.
10. DOS, band, and volumetric extension contracts are present and tested even though their full UIs are deferred.
11. The local 52-file corpus passes the dialect, completeness, dimensional-consistency, and interrupted-tail checks without committing calculation data.
12. User TOML profiles can validate and alias simple format changes without executing arbitrary code; unsupported complex variants fail with actionable diagnostics.

## 11. Selected Technology Direction

- Compact analyzer-owned immutable domain objects at every public package boundary.
- pymatgen adapters for normalized POSCAR/CONTCAR and future electronic/volumetric formats.
- ASE adapters for OUTCAR trajectory, lattice, energy, and force data.
- A narrow streaming scanner for convergence metadata, interrupted-tail recovery, and large-file indexing.
- Versioned declarative TOML profiles plus tested built-in dialects, beginning with `home_barrier`.
- A bundled VS Code Webview as the primary interface.
- 3Dmol.js behind a renderer adapter for crystal interaction, unit cells, supercells, clickable atoms, vector arrows, and initial volumetric isosurfaces.
- A chart component behind a separate plotting adapter for convergence and later DOS/band views.
- Newline-delimited JSON over standard input/output between the extension and Python core.

This direction preserves standalone operation, minimizes SSH-specific failure modes, and keeps future built-in electronic-structure and charge analyses independent of the first renderer implementation.
