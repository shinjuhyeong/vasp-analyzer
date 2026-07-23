# VASP Analyzer

VASP Analyzer is a standalone, offline-first viewer for VASP calculations. It opens a crystal-specific 3D structure view above synchronized ionic-convergence details. Atom selection, periodic images, unit-cell/supercell controls, force vectors, Selective Dynamics constraints, and strongest free-force metrics share one stable site and step identity.

This 0.1.0 repository is **UNLICENSED**: no permission to copy, modify, or redistribute is granted unless the copyright holder grants it separately.

## Install and open

Use Python 3.11 or newer on the machine that holds the calculation:

```text
pipx install vasp-analyzer
analyzer
analyzer OUTCAR                              # VS Code editor handoff only
analyzer /path/to/calculation                # VS Code editor handoff only
analyzer OUTCAR --profile ~/profiles/home.toml
```

The default command requires an authenticated VS Code extension handoff; it does not silently start a browser server. In a Remote SSH window, perform this sequence on the remote side:

```text
python3 -m pip install --user --force-reinstall ./vasp_analyzer-0.1.0-py3-none-any.whl
code --install-extension ./vasp-analyzer-0.1.0.vsix --force
# Reload the Remote SSH window, then open a new integrated terminal.
command -v analyzer
analyzer OUTCAR
```

`command -v analyzer` must print the remote executable path. Opening a **new integrated terminal** after reload is required so it receives the handoff endpoint. The Explorer `OUTCAR` context menu and `VASP Analyzer: Open Calculation` Command Palette entry use the same stdio protocol and do not open a network port.

Explicit browser fallback forms are:

```text
analyzer OUTCAR --web
analyzer . --web --no-open
analyzer . --web --port 8765
analyzer . --profile home-example.toml --web
analyzer dialect validate OUTCAR
analyzer dialect validate OUTCAR --profile home-example.toml
analyzer corpus validate /path/to/corpus
```

Browser mode prints a URL, binds only `127.0.0.1`, rejects foreign Host headers, serves bundled assets with no CDN dependency, and exposes no CORS permission. It never binds `0.0.0.0` or `::`. Anyone with local access to the loopback URL can view the currently selected calculation, so close the process when finished and do not forward the port from a shared host.

`--port` and `--no-open` imply browser mode. The HTTP protocol accepts only `application/json` and rejects a supplied Origin unless it exactly matches the active loopback URL. A failed automatic browser launch leaves the ready server running and prints the URL; stop it with Ctrl+C.

## Structure and convergence workspace

The upper structure region is synchronized with the lower analysis workspace. Both the compact structure toolbar and the convergence workspace provide a slider plus integer input for the same ionic-step selection. Changing either control updates the crystal, selected-step values, graphs, and tables together. The draggable `Crystal tools` palette remains movable while collapsed, and atom overlays use high-contrast labels without changing the colored `a`/`b`/`c` axes.

Convergence starts with **Energy** only. Select **Energy**, **Force**, and **Cell & Stress** in any combination; the lower region divides equally between the selected modules and wraps on narrow views. Each module independently selects one metric and switches between Graph and Table:

- Energy graphs total energy or energy change. Its selected-step table preserves contribution and aggregate rows reported by OUTCAR, including unknown finite labels, and ranks the two largest absolute non-aggregate contributions.
- Force graphs strongest or RMS free force. Its selected-step table shows every atom's Cartesian position, raw force, Selective Dynamics state, projected free force, and norms; the two largest eligible free components are ranked, and selecting a row selects the same atom in the crystal viewer.
- Cell & Stress graphs external pressure or cell volume. Its selected-step table preserves VASP's pressure/stress sign convention in kB, shows the exact `1 kB = 0.1 GPa` conversion, and includes Pulay stress, volume, and the full 3x3 stress tensor when available.

Module selection, metric selection, and Graph/Table modes are restored after reopening. The initial or normalized-empty state remains Energy-only.

The **Parameters** analysis tab is optional metadata supplied by an
analyzer-owned OUTCAR reader; VaspParser remains the sole parser for trajectory
structures, forces, energies, cells, and stresses. Interpreted mode categorizes
recognized keys, uses the final repeated occurrence as the effective value,
converts supported values to booleans/numbers/tuples, and normalizes known
units. EDIFFG is interpreted conservatively by its parsed scalar sign: positive
values are energy-change criteria in eV, negative values are force criteria in
eV/angstrom, zero is disabled, and untyped values receive no asserted unit.
Raw mode retains every source occurrence, including its annotated text and
repeated or unknown home-version keys. Neither view claims whether a value was
explicitly present in INCAR or chosen by a VASP default. A malformed or
unreadable parameter record produces a warning (and may leave Parameters empty)
but never blocks an otherwise valid OUTCAR trajectory from opening.

## JSON OUTCAR normalizers

VASP Analyzer uses `vaspparser==0.0.7` as its authoritative OUTCAR parser. A
normalizer is a strict, data-only JSON definition for a home VASP build whose
OUTCAR adds columns that standard VaspParser does not accept. It may project a
recognized whitespace-delimited position/force row into VASP's six numeric
columns; it cannot execute code, run regular expressions, delete arbitrary
text, or redefine analyzer domain types.

Packaged definitions are loaded first from
`vasp_analyzer/normalizers/definitions/*.json`. Add personal definitions as
individual `.json` files in:

- `$XDG_CONFIG_HOME/vasp-analyzer/normalizers/` when `XDG_CONFIG_HOME` is set;
- otherwise `~/.config/vasp-analyzer/normalizers/`.

Files and packaged resources are sorted by filename. Duplicate IDs are fatal;
a user file never silently replaces a packaged definition. Invalid JSON,
unknown fields, unsupported schema versions, bad types, and registry conflicts
fail closed with CLI exit status 2.

### Definition schema

The complete public vocabulary is below. JSON property names are
case-sensitive. Unknown properties are rejected.

| Path/property | JSON type | Presence/default | Exact value or constraint |
|---|---|---|---|
| `schemaVersion` | integer | Required | Exactly `1` (not `1.0`, `true`, or `"1"`) |
| `id` | string | Required | Length 1-64; `^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$` |
| `displayName` | string | Required | Length 1-128 |
| `priority` | integer | Required | `-10000` through `10000`; booleans rejected |
| `detect` | object | Required | Strict object containing only `all`, `any`, and `none` |
| `detect.all` | array of strings | Optional; default `[]` | Unique, nonempty printable ASCII (`0x20`-`0x7e`) literals; every literal must occur in the first 1 MiB |
| `detect.any` | array of strings | Optional; default `[]` | Same literal rules; empty passes, otherwise at least one must occur |
| `detect.none` | array of strings | Optional; default `[]` | Same literal rules; no listed literal may occur |
| `rules` | array | Required; may be `[]` | Projection rules with unique `id` values |
| `rules[].id` | string | Required | Length 1-64; `^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$` |
| `rules[].scope` | object | Required | Strict `start`/`after`/`rowCount` object |
| `rules[].scope.start.containsAll` | array of strings | Required; at least one | Unique, nonempty printable ASCII literals; every literal must occur on the block header line |
| `rules[].scope.after.type` | string | Required | Exactly `"dashedSeparator"` |
| `rules[].scope.rowCount.source` | string | Required | Exactly `"atomCount"`; obtained from validated `NIONS` |
| `rules[].input` | object | Required | Strict `tokenizer`/`columns` object |
| `rules[].input.tokenizer` | string | Required | Exactly `"whitespace"` |
| `rules[].input.columns` | array | Required; at least one | Ordered typed columns with unique names |
| `columns[].name` | string | Required | Length 1-64; `^[a-z][A-Za-z0-9]*(?:_[a-z0-9]+)*$` |
| `columns[].type` | string | Required | One of the five column types below |
| `elementLabel.allowedSuffixes` | array of strings | Optional; default `[]` | Unique nonempty values matching `^[A-Za-z0-9_+-]+$` |
| `literal.value` | string | Required for `literal` | Length 1-128 and exactly one non-whitespace token (`^\S+$`) |
| `rules[].output` | object | Required | Strict `emit`/`separator` object |
| `rules[].output.emit` | array of strings | Required; at least one | Unique names matching the column-name grammar and referencing declared non-`text` columns; runtime OUTCAR projection requires exactly six `finiteFloat` fields |
| `rules[].output.separator` | string | Optional; default `"  "` | Exactly two spaces |

All definition, detection, rule, scope, input, output, and column objects are
strict: properties not listed above are errors. Arrays have no additional
maximum item count beyond the stated minimum/uniqueness rules. Detection and
`containsAll` literals have no additional maximum string length; suffix values
have no additional maximum length. There are no implicit defaults other than
the three empty detection arrays, empty `allowedSuffixes`, and the two-space
output separator shown above.

Column types are interpreted by the analyzer, not invented by each JSON file:

| Type | Meaning |
|---|---|
| `elementLabel` | A chemical element symbol, optionally followed by one declared suffix |
| `positiveInteger` | A base-10 integer greater than zero |
| `finiteFloat` | A finite VASP-style numeric token; NaN and infinity are rejected |
| `literal` | One exact token equal to the column's `value` |
| `text` | A consumed token that cannot be emitted |

Detection is an exact, case-sensitive byte-literal check over at most the first
1 MiB. Of the matching non-standard definitions, the unique highest
`priority` wins. Equal highest priorities are an ambiguity error. If none
matches, the packaged `standard` normalizer is selected and copies nothing.

The built-in home-barrier definition is:

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
  "rules": [
    {
      "id": "named-position-force-row",
      "scope": {
        "start": {"containsAll": ["POSITION", "TOTAL-FORCE"]},
        "after": {"type": "dashedSeparator"},
        "rowCount": {"source": "atomCount"}
      },
      "input": {
        "tokenizer": "whitespace",
        "columns": [
          {"name": "species", "type": "elementLabel", "allowedSuffixes": ["_"]},
          {"name": "localIndex", "type": "positiveInteger"},
          {"name": "x", "type": "finiteFloat"},
          {"name": "y", "type": "finiteFloat"},
          {"name": "z", "type": "finiteFloat"},
          {"name": "fx", "type": "finiteFloat"},
          {"name": "fy", "type": "finiteFloat"},
          {"name": "fz", "type": "finiteFloat"}
        ]
      },
      "output": {
        "emit": ["x", "y", "z", "fx", "fy", "fz"],
        "separator": "  "
      }
    }
  ]
}
```

### Inspect, validate, and test

All three commands print deterministic JSON. `list` includes the canonical
definition hash and the actual packaged or user source path:

```text
analyzer normalizer list
analyzer normalizer validate ~/.config/vasp-analyzer/normalizers/my-home.json
analyzer normalizer test ~/.config/vasp-analyzer/normalizers/my-home.json /path/to/OUTCAR
```

`validate` checks the supplied file and conflicts against the active packaged
and user registry. `test` is deliberately isolated: it loads only the supplied
definition plus the packaged standard fallback, applies it to the named
OUTCAR, invokes the real VaspParser adapter, and verifies step/atom/array
invariants. Its JSON includes the parser summary, source and definition
SHA-256 values, changed-line counts per rule, bounded first/last changed-line
locations, warnings, source-hash verification, and temporary-cleanup status.
Warnings are never hidden; errors go to stderr and return status 2.

The source OUTCAR is opened read-only as one pinned regular-file identity.
Detection reads its bounded prefix from that same descriptor. Symlinks and
non-regular files are rejected. The source is hashed through the pinned
descriptor before and after normalization; a changed path identity or content
aborts the command before any result is returned. Specialized output exists
only in a private temporary directory that is removed on success and failure.
No normalizer edits an OUTCAR in place.

VaspParser 0.0.7 accepts a path rather than an existing descriptor. For a
no-copy definition (including the packaged standard normalizer in ordinary
analysis), it therefore opens the original path while the pinned descriptor
remains the audit authority. If the pathname is replaced or its content is
mutated during that parse, the final descriptor hash/path-identity audit fails
closed and the parsed result is discarded. A projection-rule definition gives
VaspParser only the analyzer-owned temporary normalized path.

To develop a custom normalizer without polluting the active registry:

```text
mkdir -p /tmp/vasp-normalizer-work
cp /path/to/example/OUTCAR /tmp/vasp-normalizer-work/OUTCAR
cp ~/.config/vasp-analyzer/normalizers/my-home.json \
  /tmp/vasp-normalizer-work/candidate.json
analyzer normalizer validate /tmp/vasp-normalizer-work/candidate.json
analyzer normalizer test \
  /tmp/vasp-normalizer-work/candidate.json \
  /tmp/vasp-normalizer-work/OUTCAR
mkdir -p ~/.config/vasp-analyzer/normalizers
cp /tmp/vasp-normalizer-work/candidate.json \
  ~/.config/vasp-analyzer/normalizers/my-home.json
analyzer normalizer list
```

Start by copying the full home-barrier JSON above, choose a unique ID and
specific detection literals, then describe every input token in order. Keep
the candidate outside the active directory until both `validate` and `test`
succeed. A JSON normalizer is intentionally limited to safe row projection; a
home format requiring semantic reconstruction needs an analyzer release with
a new typed transformation, not an executable hook.

## Declarative compatibility profiles

Profiles are data-only TOML, schema-versioned, snake_case, strict, and fail closed. Unknown keys, aliases, types, versions, executable hooks, regex deletion, or partial normalization rules are rejected. Supported 0.1.0 fields are shown completely here:

```toml
schema_version = 1
id = "home-example"
display_name = "Home VASP barrier build"

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

[outcar.details]
energy_section = ["FREE ENERGIE OF THE ION-ELECTRON SYSTEM"]
stress_section = ["FORCE on cell =-STRESS"]
external_pressure = ["external pressure"]
cell_volume = ["volume of cell"]
parameter_sections = ["INCAR:", "Startparameter for this Run"]
parameter_section_end = ["VRHFIN", "ions per type", "NIONS", "direct lattice vectors", "------------------------------"]

[[outcar.energy_terms]]
key = "home_correction"
labels = ["home correction"]
kind = "contribution"

[validation]
expected_force_columns = 6
force_prefix_columns = 2
allow_incomplete_tail = true
```

The special POSCAR rule removes only the declared standalone integer immediately after `Selective dynamics`; any different line is an error with location context. `force_prefix_columns` is restricted to `0` or `2`, and `expected_force_columns` to `6`.

All detail marker defaults are shown above. Marker and energy-label aliases are bounded literal, case-insensitive substring/label matches; they are not regular expressions. The colon-free `Startparameter for this Run` literal accepts capitalization and optional-colon variants, while the dash marker closes that standard effective block. `parameter_sections` opens a recognized parameter region and `parameter_section_end` closes it, so unknown home-version keys are retained only inside an explicitly bounded region. Profiles replace these tuples explicitly; extend standard behavior by retaining the defaults and appending home aliases, as in `tests/fixtures/profiles/home-example.toml`. Standard VASP energy rules remain available when custom rules are added; a custom rule must declare a bounded canonical `key`, one or more literal `labels`, and `kind = "contribution"` or `"aggregate"`.

## Recovery and interpretation

OUTCAR scanning emits only complete, dimensionally valid position/force blocks. A complete structure whose trailing energy is missing remains visible; a physically truncated lattice, force row, or energy tail produces an incomplete-tail warning and the last valid step is retained. Append-only files resume only from a verified checkpoint; replacement or prefix change triggers a rebuild.

Selective Dynamics uses `T` for motion allowed along the direct lattice directions `a`, `b`, and `c`, and `F` for fixed directions, following the [official POSCAR definition](https://vasp.at/wiki/index.php/POSCAR). This meaning is unchanged when POSCAR positions are entered in Cartesian mode; when `Selective dynamics` is absent, VASP treats all three flags as `T`. Raw OUTCAR `Fx/Fy/Fz` values remain Cartesian. The displayed free-force vector is the Euclidean orthogonal projection of that Cartesian force onto the span of the allowed direct vectors. Strongest and RMS convergence metrics use the dot product with each allowed unit direct vector. In a skew cell these directional values can be correlated, and they are not Cartesian components. Ties are resolved deterministically by site order and then `a`, `b`, `c`. If constraints are unavailable (an OUTCAR-only calculation), constraint-derived force metrics remain unknown.

The core structure cache fingerprints only `OUTCAR`, `POSCAR`, and `CONTCAR`, plus the complete selected parser profile, dialect, analyzer version, and cache schema. Optional DOS/band/charge files are inventoried but never read or hashed until their future capability is requested, and will own separate caches. The default cache is private per user (`LOCALAPPDATA` on Windows, `XDG_CACHE_HOME` or `~/.cache` on POSIX), not a shared temporary directory.

## Corpus and privacy

The opt-in development gate currently covers 52 home-dialect OUTCAR files (2,288,020,784 bytes): 50 structural files, 12,909 complete force blocks, 38 complete and 14 incomplete calculations, and a maximum of 3,000 ionic steps. Configure the location only in the process environment:

```text
set VASP_ANALYZER_CORPUS_DIR=D:\private\vasp-corpus
python -m pytest -m corpus tests/corpus -v
```

On POSIX shells use `export` instead of `set`. Raw calculations, cache files, corpus reports, and absolute corpus paths are ignored and must never be committed or emitted in checked-in reports.

The detailed opt-in gate additionally reports only aggregate counts for schema 2 energy terms, stress tensors, and effective-parameter occurrences. It consumes analyzed datasets one at a time and retains no source paths or calculation content in its report. Its five feature counters must all be nonzero. For reproducible private-corpus regression floors, store a path-free JSON file outside the repository and set `VASP_ANALYZER_CORPUS_DETAIL_BASELINE` to it:

```text
{
  "files_with_energy_terms": <measured-positive-integer>,
  "files_with_stress": <measured-positive-integer>,
  "files_with_parameters": <measured-positive-integer>,
  "energy_terms": <measured-positive-integer>,
  "parameter_occurrences": <measured-positive-integer>
}
```

Replace every placeholder with an aggregate count measured from the configured corpus; no private path or OUTCAR content belongs in the file. The gate treats them as minimums and also compares cached/append-resumed detail identities against stable or fresh results.

## Planned analysis seams

DOS, band structure, charge analysis, and volumetric charge isosurfaces are intentionally unavailable in 0.1.0. Their immutable capability/request contracts and plot/renderer seams are reserved so future implementations can reuse the same selected site/step state without coupling parsers to the UI. `getVolumetric` therefore returns a typed `capability_unavailable` response rather than a placeholder surface.

## Development

```text
python -m pip install -e ".[dev]"
python -m pytest -m "not corpus"
python -m ruff check src tests scripts
cd vscode
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Build the Webview before `python -m build`; the wheel and sdist package the resulting offline files. CI performs this ordering and checks wheel, sdist, and VSIX contents.
