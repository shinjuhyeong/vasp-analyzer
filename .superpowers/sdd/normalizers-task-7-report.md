# Task 7 Report: Transport, Warning, Report, and Diff UI

## Delivered

- Advanced dataset/Webview/release contracts to schema 4.
- Added session-owned `getNormalizationManifest` and `getNormalizedOutcar` operations.
- Validated manifest ownership, current source fingerprint, and recomputed manifest reference.
- Kept manifests and normalized text out of the initial dataset response.
- Bounded line excerpts at 512 characters and normalized virtual-document payloads at 64 MiB.
- Avoided reopening the standard source path by reading through the pinned normalizer handle.
- Added parser/normalizer status, a visible nonstandard warning, and a lazy line report.
- Added read-only `vasp-analyzer-normalized:` virtual documents and original/normalized VS Code diff commands.
- Disabled normalized views for unchanged standard OUTCARs with a clear message.
- Migrated synthetic integration fixtures to canonical blocks accepted by VaspParser while retaining scanner coverage.

## Verification

- `python -m pytest --import-mode=importlib -q`: 619 passed, 7 skipped.
- `python -m ruff check src tests scripts`: passed.
- `pnpm --dir vscode test`: 34 files, 338 tests passed.
- `pnpm --dir vscode typecheck`: passed.
- `pnpm --dir vscode build`: passed.
- `pnpm --dir vscode test:layout`: 2 Chromium tests passed; ionic control x remained 339.046875 px at both widths.
- `git diff --check`: passed.

The skipped Python tests are the optional local corpus and Windows filesystem capability cases already marked by their suites.
