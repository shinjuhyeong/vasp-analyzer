# Normalizers Task 3 Report

## Scope

Implemented schema-1 typed OUTCAR field projection, line-preserving specialized
normalization sessions, and bounded manifests. No release-current or UI files were
changed.

## TDD Evidence

1. Added `tests/unit/normalizers/test_transform.py` and the two requested fixtures.
2. First focused run failed during collection because
   `vasp_analyzer.normalizers.fields` did not exist.
3. Implemented the minimal fields, manifest, and transform modules; focused suite
   passed 18 tests.
4. Added a failure-path SHA/cleanup regression. It failed because the injected
   transform error was re-raised without a post-failure source hash check.
5. Implemented failure-path hash verification; focused suite passed 19 tests.

## Implemented Contracts

- A typed field registry validates periodic-table element labels and configured
  suffixes, strict positive base-10 integers, finite decimal `E/e/D/d` floats,
  exact literals, text fields, and exact token counts.
- `NIONS` must be a validated positive integer encountered before a projected
  block.
- A rule begins only on its declared marker followed immediately by an exact
  dashed separator and stages exactly `atomCount` rows before writing them.
- Every original row and its original newline bytes (`CRLF`, `LF`, `CR`, or none)
  are preserved unless the row is projected; projected rows retain that row's
  newline bytes and source line number.
- Standard normalizers return the original source path without a copy or
  temporary directory.
- Specialized normalizers use a private system temporary directory and remove it
  on context exit and every exception path.
- SHA-256 is streamed before and after success, and again after failure before the
  original exception is propagated.
- Detailed manifests retain only changed-row excerpts, each bounded to 512
  characters. Normal transport summaries expose only changed count and first/last
  changed lines.
- Invalid UTF-8 is rejected with the original mapped line number.

## Bounded-Read Audit

Production transform code opens OUTCAR sources as binary streams and hashes in
64-KiB chunks. It does not call `Path.read_bytes()` or `Path.read_text()`.
`select_normalizer()` continues to slice its supplied detection prefix to 1 MiB.
The only `read_text()` in the normalizer package loads small JSON definition
resources, not an OUTCAR.

## Verification

- `python -m pytest tests/unit/normalizers/test_transform.py -q`
  - 19 passed
- `python -m pytest tests/unit/normalizers -q`
  - 71 passed
- `python -m ruff check src tests`
  - all checks passed
- `git diff --check`
  - exit 0
- `rg` audit across normalizers/calculation/parsing
  - no OUTCAR transform or detection whole-file read

## Concerns

The public Task 3 interface accepts an already selected `NormalizerMatch`.
Consequently, the future orchestration caller must open the source and read at most
1 MiB before calling `select_normalizer`; it must not use `read_bytes()` to create
that prefix. The transform implementation itself performs no detection.
