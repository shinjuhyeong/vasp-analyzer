# VASP Analyzer

VASP Analyzer is a standalone, offline-first viewer for VASP calculations. It opens a crystal-specific 3D structure view above synchronized ionic-convergence details. Atom selection, periodic images, unit-cell/supercell controls, force vectors, Selective Dynamics constraints, and strongest free-force metrics share one stable site and step identity.

This 0.1.0 repository is **UNLICENSED**: no permission to copy, modify, or redistribute is granted unless the copyright holder grants it separately.

## Install and open

Use Python 3.11 or newer on the machine that holds the calculation:

```text
pipx install vasp-analyzer
analyzer
analyzer OUTCAR
analyzer /path/to/calculation
```

The default command first attempts an authenticated VS Code extension handoff. In a Remote SSH window, install the VSIX on the remote extension host, reload VS Code, and **open a new integrated terminal** so it receives the handoff endpoint. The Explorer `OUTCAR` context menu and `VASP Analyzer: Open Calculation` Command Palette entry use the same stdio protocol and do not open a network port.

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

[validation]
expected_force_columns = 6
force_prefix_columns = 2
allow_incomplete_tail = true
```

The special POSCAR rule removes only the declared standalone integer immediately after `Selective dynamics`; any different line is an error with location context. `force_prefix_columns` is restricted to `0` or `2`, and `expected_force_columns` to `6`.

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

## Planned analysis seams

DOS, band structure, charge analysis, and volumetric charge isosurfaces are intentionally unavailable in 0.1.0. Their immutable capability/request contracts and plot/renderer seams are reserved so future implementations can reuse the same selected site/step state without coupling parsers to the UI. `getVolumetric` therefore returns a typed `capability_unavailable` response rather than a placeholder surface.

## Development

```text
python -m pip install -e ".[dev]"
python -m pytest -m "not corpus"
python -m ruff check src tests
cd vscode
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Build the Webview before `python -m build`; the wheel and sdist package the resulting offline files. CI performs this ordering and checks wheel, sdist, and VSIX contents.
