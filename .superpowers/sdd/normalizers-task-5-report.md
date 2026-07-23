# Task 5 Report: Dataset Orchestration and Growing Files

## Outcome

- Replaced the application calculation path with the single authoritative pipeline:
  registry selection → secure normalization context → `parse_vaspparser_outcar`.
- Normalizer detection opens OUTCAR in binary mode and requests exactly 1 MiB; no
  `Path.read_bytes()` is used.
- Removed all scanner, ASE trajectory, and checkpoint call sites from
  `vasp_analyzer.calculation`.
- Reconciles OUTCAR header species/count with POSCAR and CONTCAR; POSCAR or
  CONTCAR provides immutable site order and selective-dynamics masks.
- Maps all eleven VaspParser free-energy components from the final electronic
  iteration into named analyzer energy terms.
- Added parser/normalizer definition/hash/change-count/manifest provenance and
  advanced dataset/cache schemas.
- Cache identity includes the normalizer definition hash and rejects legacy
  dataset payloads closed.
- Refresh retains the last successful immutable dataset after an analyzer-owned
  parse/normalization failure, avoids re-parsing an unchanged failed fingerprint,
  and retries after the next change. Initial failures propagate.

## TDD Evidence

- Initial focused RED: 4/4 failures because dataset orchestration had no
  `parse_vaspparser_outcar` boundary.
- Added focused tests for virtual normalized paths, provenance, bounded prefix
  reads, no fallback, retention/no-retry/recovery, initial failure propagation,
  cache schema/hash identity, and legacy cache rejection.
- Real home acceptance exposed a pre-existing transformer defect:
  `number of dos ... number of ions NIONS = 25` was rejected by an incorrectly
  whole-line-anchored expression. Added the exact regression first, observed RED,
  then safely accepted exactly one bounded positive `NIONS = <integer>`
  assignment per logical line while retaining ambiguity/nonpositive/oversize
  rejection.

## Verification

- Relevant calculation/normalizer/adapters/models:
  `200 passed, 3 skipped` (Windows capability skips).
- Ruff: all checks passed.
- `git diff --check`: clean.
- No scanner/ASE/checkpoint references under `src/vasp_analyzer/calculation`.
- Real official OUTCAR: `200 steps`, `6 atoms`, `vaspparser`, `standard`,
  `0 changed lines`.
- Real home OUTCAR: `35 steps`, `25 atoms`, `vaspparser`, `home-barrier`,
  `875 changed lines`.
- Source files were copied to temporary acceptance directories; originals were
  not modified.

## Deferred Existing Tests

Full unit collection with importlib mode has three transport-only failures.
Those tests still require wire schema 3 and synthetic `NIONS = 2 ions` fixtures
that VaspParser 0.0.7 rejects. Transport schema/fixture migration belongs to
planned Task 7; Task 5 relevant suites are green.
