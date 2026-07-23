# VaspParser JSON Normalizers and Fixed Step Control Design

## Goal

Replace the analyzer-owned OUTCAR trajectory parser with `vaspparser` as the authoritative parser, while safely adapting known home-VASP formats through declarative JSON normalizers. Allow users to add normalizers without editing the installed package. Fix the ionic-step control at a content-independent horizontal position.

## Verified Feasibility

`vaspparser 0.0.7` parsed the supplied official OUTCAR directly as 200 ionic steps. It initially rejected the supplied `vasp.5.4.1-barrier` OUTCAR because each `POSITION ... TOTAL-FORCE` row begins with an element label and element-local site index. A read-only prototype removed only those two prefix columns from 875 rows (35 steps by 25 atoms), after which `vaspparser` returned 35 energies, positions `(35, 25, 3)`, forces `(35, 25, 3)`, cells `(35, 3, 3)`, stresses `(35, 3, 3)`, pressures `(35, 3)`, and 35 SCF-energy groups.

The product implementation must reproduce this result without modifying the source OUTCAR.

## Package Boundaries

The Python package is divided into four relevant boundaries:

- `normalizers/`: JSON schema, built-in normalizer definitions, registry, detection, transformation, and manifest types.
- `parsing/adapters/vaspparser_outcar.py`: the only module that imports `vaspparser` and converts its plain parse dictionary into analyzer-owned immutable contracts.
- `calculation/`: discovery, snapshot refresh, last-successful dataset retention, POSCAR/CONTCAR reconciliation, and dataset assembly.
- `transport/` and the VS Code Webview: expose parser provenance and normalization warnings without depending on `vaspparser` objects.

No `vaspparser`, NumPy, or ASE object crosses the adapter boundary.

## Normalizer Discovery

The registry loads normalizers from two locations:

1. Built-ins shipped as package resources under `vasp_analyzer/normalizers/definitions/*.json`.
2. User definitions under `$XDG_CONFIG_HOME/vasp-analyzer/normalizers/*.json`, falling back to `~/.config/vasp-analyzer/normalizers/*.json` when `XDG_CONFIG_HOME` is unset.

Remote SSH uses the remote analyzer process and therefore the remote user's configuration directory.

Every discovered file is validated before detection begins. Duplicate IDs across or within locations are errors; user definitions cannot override built-ins. Invalid JSON, an unsupported schema version, an unknown field type or operation, or an ambiguous rule prevents parsing and reports the definition path.

## Detection and Selection

Each normalizer declares:

```json
{
  "schemaVersion": 1,
  "id": "home-barrier",
  "displayName": "Home VASP Barrier",
  "priority": 100,
  "detect": {
    "all": ["vasp.5.4.1-barrier"],
    "any": ["POSITION", "TOTAL-FORCE"],
    "none": []
  },
  "rules": []
}
```

Detection reads at most the first 1 MiB of the OUTCAR. `all` literals must all occur, at least one `any` literal must occur when the array is nonempty, and no `none` literal may occur. The matching definition with the highest priority is selected. A tie at the highest priority is an ambiguity error. If no specialized definition matches, the built-in `standard` definition is selected and the original OUTCAR is passed directly to `vaspparser` without a temporary copy.

Literal detection is case-sensitive and byte-oriented in schema version 1. Regex detection is not supported.

## Typed JSON Transformation Language

Column names do not imply their types. Every input column has a user-defined name and a built-in field type:

```json
{
  "id": "named-position-force-row",
  "scope": {
    "start": { "containsAll": ["POSITION", "TOTAL-FORCE"] },
    "after": { "type": "dashedSeparator" },
    "rowCount": { "source": "atomCount" }
  },
  "input": {
    "tokenizer": "whitespace",
    "columns": [
      { "name": "species", "type": "elementLabel", "allowedSuffixes": ["_"] },
      { "name": "localIndex", "type": "positiveInteger" },
      { "name": "x", "type": "finiteFloat" },
      { "name": "y", "type": "finiteFloat" },
      { "name": "z", "type": "finiteFloat" },
      { "name": "fx", "type": "finiteFloat" },
      { "name": "fy", "type": "finiteFloat" },
      { "name": "fz", "type": "finiteFloat" }
    ]
  },
  "output": {
    "emit": ["x", "y", "z", "fx", "fy", "fz"],
    "separator": "  "
  }
}
```

Schema version 1 exposes only these field types:

- `elementLabel`: a periodic-table symbol optionally followed by one suffix explicitly listed in that column's `allowedSuffixes`; the list defaults to empty and each suffix must contain only ASCII letters, digits, `_`, `+`, or `-`. The parsed value retains its original token for manifest reporting.
- `positiveInteger`: a base-10 integer greater than zero.
- `finiteFloat`: a finite decimal value supporting `E`, `e`, `D`, and `d` exponents.
- `literal`: the exact token supplied by that column's required `value` property.
- `text`: a nonempty whitespace-delimited token, usable only when omitted from output.

Names must be unique within a rule. `output.emit` may reference only declared names. Schema version 1 supports only whitespace tokenization, exact dashed-separator recognition, literal `containsAll` block starts, `atomCount` row counts, and column projection. It cannot execute Python, import modules, invoke shell commands, contain arbitrary replacement regexes, delete lines, reorder blocks, or change the number of lines.

## Transformation Invariants

The source is opened read-only. A specialized normalizer writes a virtual OUTCAR into a private temporary directory and preserves line count and line order exactly.

A scoped block is transformed only if:

- its start and separator match exactly;
- atom count has already been established from validated VASP metadata;
- exactly `atomCount` rows satisfy the declared column schema;
- every emitted number is finite;
- the rule consumes no additional rows; and
- the transformed output row satisfies the expected standard six-float position/force grammar.

Partial matches fail the entire normalization. Unknown rows are never silently removed. The original file is not modified, renamed, truncated, or opened for writing. A source SHA-256 computed before and after normalization must match.

The temporary normalized file is deleted when the parse session ends. A detailed manifest may be retained in the analyzer cache, keyed by source fingerprint and normalizer-definition hash, but it never contains unrelated source blocks.

## Manifest and Source Mapping

Every specialized normalization produces:

- normalizer ID, display name, schema version, and definition SHA-256;
- source path, source SHA-256, size, and modification time;
- rule IDs and changed-line counts;
- first and last changed original line;
- a line-preserving list of original and emitted row excerpts for detailed inspection; and
- warnings suitable for transport to the viewer.

Because line count and order are invariant, virtual line `N` always maps to original line `N`. `vaspparser` exceptions that expose a line or recognizable row are reported against the original OUTCAR and accompanied by the selected normalizer and rule. Errors without a recoverable line include the normalization summary and original source path.

## Parser Adapter and Dataset Assembly

`vaspparser.vasp.parser.outcar.Outcar.from_file()` is authoritative for:

- positions and forces;
- ionic cells;
- total energies and energy components;
- stresses and pressures;
- SCF-energy groups;
- Fermi level and other supported OUTCAR properties.

The analyzer adapter converts arrays and values into analyzer-owned immutable models and validates:

- every numeric value is finite;
- positions and forces have shape `(steps, atoms, 3)`;
- cells and stresses have shape `(steps, 3, 3)`;
- energy, cell, position, force, stress, and pressure step counts agree when the quantity is available;
- atom counts agree with the reconciled POSCAR/CONTCAR structure; and
- step IDs are contiguous and stable.

POSCAR/CONTCAR remains authoritative for element ordering, initial structure, and Selective Dynamics. The adapter joins these fields by validated atom order and count.

The current analyzer recovery scanner is removed from the authoritative dataset path. During one transition release it remains available only through an explicit diagnostic comparison command; it is never an automatic fallback. A `vaspparser` failure therefore remains visible rather than being hidden by the old parser.

## Growing and Incomplete OUTCAR Files

On file change, the calculation session takes a new source fingerprint, re-runs normalization, and re-runs `vaspparser`. If the newest snapshot is incomplete and cannot be parsed, the application retains the last successfully parsed immutable dataset and shows a nonfatal warning that the OUTCAR is still being written. It retries only after a source change.

The normalizer does not trim or repair an incomplete final ionic block. If no successful dataset exists, the parse error is shown. If the same unchanged source repeatedly fails, the application does not spin or retry on a timer.

## Viewer Behavior

The viewer displays concise provenance near the calculation status:

```text
Parser: vaspparser 0.0.7
Normalizer: Home VASP Barrier
Normalized: 875 lines
```

Any non-standard transformation produces a visible warning. A normalization report view shows rule summaries and line-level before/after excerpts. Commands allow the user to open the normalized OUTCAR read-only and open a VS Code diff between original and normalized files. Temporary-file lifetime must extend through an open report/diff session and end when the owning session closes.

## Fixed Ionic-Step Position

The primary toolbar row uses a content-independent grid:

```css
.toolbar-primary-row {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) auto;
  column-gap: 12px;
}
```

The title occupies exactly 200 px and truncates with an ellipsis. The ionic-step control begins at the same x-coordinate for Initial and every ionic step; its position does not depend on `Initial / N`, `1 / N`, comparison state, title content, or control intrinsic width. Expand/Restore occupies the final column. At narrow widths only the middle step column scrolls horizontally; no control moves to another row.

## CLI and Documentation

`README.md` documents:

- installation and normal execution;
- built-in and user normalizer locations;
- automatic detection, priority, and ambiguity behavior;
- the complete JSON schema and built-in field types;
- scope, tokenizer, column, emit, and atom-count semantics;
- a complete `home_barrier.json` example;
- validation failures and source-safety guarantees;
- manifest and viewer warning behavior; and
- the normalizer development workflow.

CLI commands:

```text
analyzer normalizer list
analyzer normalizer validate PATH
analyzer normalizer test PATH OUTCAR
```

`list` reports built-in and user definitions with source paths. `validate` performs schema and registry-conflict validation without reading an OUTCAR. `test` normalizes a source into a temporary file, runs `vaspparser`, checks dataset invariants, prints a deterministic JSON summary and manifest, verifies the source hash is unchanged, and removes the temporary file.

## Testing and Acceptance

Acceptance requires:

- direct `vaspparser 0.0.7` parsing of the supplied official OUTCAR as exactly 200 steps;
- normalized parsing of the supplied home OUTCAR as exactly 35 steps and 25 atoms, including the verified array shapes;
- value-level comparison of positions, forces, cells, energies, stresses, and pressures against independently extracted fixture expectations;
- source SHA-256 unchanged after success and every failure path;
- JSON schema, unknown-key, unsupported-version, duplicate-ID, priority-tie, invalid-type, invalid-emit, partial-block, wrong-row-count, nonfinite-number, and malformed-element tests;
- built-in and XDG user registry tests on Linux-compatible paths;
- temporary-file cleanup and last-successful-snapshot behavior tests;
- installed-wheel execution of all three normalizer CLI commands and both supplied OUTCAR cases;
- Webview tests for warning/provenance/report behavior;
- a layout-capable browser test proving the ionic-step slider has the same x-coordinate for Initial, ionic, and comparison states; and
- full Python, Ruff, Webview, typecheck, production build, wheel, and VSIX gates.

The supplied full OUTCAR files remain local test inputs and are never committed.

## Out of Scope

- Executable Python normalizer plugins.
- Arbitrary regex replacements or line deletion.
- Automatic installation or downloading of user normalizers.
- Silent fallback to the analyzer-owned OUTCAR parser.
- DOS, band, PROCAR, volumetric, and Bader UI implementation; the adapter boundary must permit those later additions without redesigning normalizer discovery.
