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

---

## Review-Finding Remediation

### Root Cause and TDD Record

The review findings traced to two shared assumptions in the first implementation:
pathname reopening was treated as stable source identity, and Python binary-file
iteration was treated as supporting every OUTCAR newline convention.

The first review regression run produced 9 expected failures: lone-CR lines,
noncanonical or unanchored `NIONS`, repeated/stale metadata, short separators,
nonstandard custom emits, and standard-session mutation detection. After those
reached green, a separate injected hash-audit regression failed because raw
`OSError` escaped; that audit failure is now mapped.

### Source and Line Invariants

- One read-only descriptor is pinned for the session. `lstat` and `fstat` identity
  must agree; symlinks and non-regular files are rejected.
- Initial hash, transform, metadata, success/failure audit, and close audit all use
  that descriptor. Normalization never reopens the source pathname.
- Close compares current pathname identity with the pinned identity, detecting
  replacement/removal and in-place mutation.
- The streaming logical-line reader handles LF, CRLF, lone CR, chunk-boundary
  delimiters, and an unterminated final row while preserving exact endings.

### Metadata and Projection Invariants

- Metadata must match the full logical line:
  `^\s*NIONS\s*=\s*([1-9][0-9]*)\s+ions\s*$`.
- Zero, signs, leading zeroes, malformed values, prefixes, suffixes, and repeated
  declarations are rejected.
- One validated count applies to later ionic blocks, matching real OUTCAR ownership
  where one header precedes many steps; every block requires it to occur first.
- Separators require at least ten pure dashes after surrounding whitespace.
- Each rule must emit exactly six declared `finiteFloat` columns, and row parsing
  independently validates every value.

### Failure Composition

Audit, cleanup, and descriptor close are attempted independently. Source audit
errors remain primary when cleanup also fails; cleanup is attached as a note.
Transform/write errors remain primary when audit succeeds. Injected hash failures
are mapped and failure audit is attempted on the standard path.

### Review Verification

- Initial RED focused run: 9 failed, 24 passed, 2 skipped.
- Hash-audit RED focused run: 1 failed, 37 passed, 2 skipped.
- Final focused: `38 passed, 2 skipped`.
- Final normalizers: `90 passed, 2 skipped`.
- `python -m ruff check src tests`: all checks passed.
- `git diff --check`: exit 0.
- `rg -n "read_bytes\(|read_text\(" src/vasp_analyzer/normalizers`: only registry
  JSON loading uses `read_text`; source OUTCAR code uses neither API.

### Platform Limitations

The verification host is Windows. Symlink creation requires an unavailable
privilege, so the real symlink test is capability-skipped; non-regular rejection
runs. Windows also prevents replacing this pinned open source file, so that real
replacement test is skipped. A portable injected `fstat` mismatch still exercises
descriptor identity-race rejection. Both real tests run on permitting platforms.

---

## Final Memory-Bound and Context-Exit Remediation

The earlier pass counts above are retained as historical RED/GREEN evidence. The
current final verification numbers are recorded at the end of this section.

### Bounded Memory

- Logical-row content is capped at `1 MiB`, excluding its line terminator. This is
  deliberately far above ordinary OUTCAR rows while preventing an unterminated or
  adversarial row from growing without bound.
- The streaming reader checks each segment before extending its row buffer. Tests
  cover the exact accepted boundary, a rejection crossing several read chunks, and
  oversized terminated and unterminated rows with original line mapping.
- Validated `NIONS` is capped at `100,000` atoms, a practical ceiling well above
  supported interactive analysis sizes.
- Emitted rows staged for all-or-nothing block projection are additionally capped
  at `64 MiB`. This independently bounds memory even when many maximum-size input
  rows project to valid six-column output.

### Context-Manager Exception Policy

When no body exception exists, close-time security audit or cleanup failures are
raised normally. When parser/body code is already failing, that original exception
remains primary. Any source mutation/identity audit failure and temporary cleanup
failure are attached as exception notes. This prevents a secondary cleanup problem
from hiding the parser diagnosis while retaining security-audit evidence.

Tests cover a body error plus cleanup failure and a body error combined with source
mutation audit and cleanup failures.

### Final TDD and Verification

- Final-findings RED:
  `python -m pytest tests/unit/normalizers/test_transform.py -q`
  - 8 failed, 38 passed, 2 skipped.
- Current focused:
  `python -m pytest tests/unit/normalizers/test_transform.py -q`
  - 46 passed, 2 skipped.
- Current all normalizers:
  `python -m pytest tests/unit/normalizers -q`
  - 98 passed, 2 skipped.
- `python -m ruff check src tests`
  - all checks passed.
- `git diff --check`
  - exit 0.

The two skips remain the previously documented Windows capability limitations;
they are unrelated to these final findings.

### Final NIONS Conversion Boundary

A 5,000-digit canonical `NIONS` regression first reproduced Python's raw
integer-string conversion `ValueError`. The transformer now compares digit count
and, for equal widths, lexicographic value against the canonical
`MAX_ATOM_COUNT` string before integer conversion. Consequently, conversion only
receives a short already-bounded value, and oversized metadata raises a mapped
`OutcarNormalizationError` at the original line.

- RED: 1 failed with raw conversion `ValueError`.
- Current focused: 47 passed, 2 documented platform skips.
- Current all normalizers: 99 passed, 2 skips.
- Ruff and diff checks: clean.
