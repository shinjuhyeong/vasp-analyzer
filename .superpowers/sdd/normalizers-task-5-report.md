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
- Restores the public parameter and Pulay-stress contracts through a separate
  bounded metadata reader. It streams OUTCAR once, delegates only individual
  recognized lines to the existing pure parameter/pressure parsers, preserves
  repeated and unknown occurrences in physical line order, and isolates malformed
  metadata as typed warnings. VaspParser remains the sole trajectory parser.
- Added parser/normalizer definition/hash/change-count/manifest provenance and
  advanced dataset/cache schemas.
- Cache identity includes the normalizer definition hash and rejects legacy
  dataset payloads closed.
- Refresh retains the last successful immutable dataset after an analyzer-owned
  parse/normalization failure, avoids re-parsing an unchanged failed fingerprint,
  and retries after the next change. Initial failures propagate.
- Cache reads are verified against a second source/normalizer identity, and new
  entries are keyed only from the source fingerprint and definition hash returned
  by a successful, stable assembly. Two bounded attempts handle concurrent file
  growth without ever storing a new dataset under a stale key.
- Converts VaspParser stress tensors from eV/Å³ to kB. Its `(steps, 3)`
  pressure array contains stress-row means; the scalar UI pressure is therefore
  computed as the physically hydrostatic `trace(stress)/3`, excluding shear.
  Cell volume is `abs(det(cell))` in Å³.

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

- Relevant calculation/normalizer/adapters/models plus the migrated authoritative
  dataset integration suite: `216 passed, 3 skipped` (Windows capability skips).
- Ruff: all checks passed.
- `git diff --check`: clean.
- No scanner/ASE/checkpoint references under `src/vasp_analyzer/calculation`.
- Real official OUTCAR: `200 steps`, `6 atoms`, `vaspparser`, `standard`,
  `0 changed lines`, `137 parameters`, first pressure `-5.99 kB`, first Pulay
  stress `0.0 kB`, first volume `280.63 Å³`.
- Real home OUTCAR: `35 steps`, `25 atoms`, `vaspparser`, `home-barrier`,
  `875 changed lines`, `106 parameters`, first pressure `-14.70 kB`, first
  Pulay stress `0.0 kB`, first volume `356.75 Å³`.
- Source files were copied to temporary acceptance directories; originals were
  not modified.

## Python Gate and Deferred Transport Migration

The Task 5-owned unit and dataset/session integration gate is green. A complete
Python run reports `599 passed, 6 skipped, 9 failed`; all nine remaining failures
are transport/CLI/web surfaces that still require wire schema 3 and/or synthetic
`NIONS = 2 ions` fixtures rejected by VaspParser 0.0.7. Their schema and fixture
migration belongs to planned Task 7. The obsolete scanner-specific dataset
integration assertions were replaced by equivalent authoritative-pipeline
coverage for discovery, reconciliation, constraints, pressure/volume, cache
identity/reuse, ordered effective/repeated/unknown parameters, append/replay
deduplication, Pulay stress, malformed-metadata isolation, growing-file
retention/recovery, and optional-file exclusion.
