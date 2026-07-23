# Task 2 Report: Iteration-Owned Recovery Scanner Details

## Status

Complete. Recovery scanning now owns stress, pressure, bounded geometry, lattice, volume, force, and SCF counts by the active one-based VASP ionic iteration while preserving legacy marker-free behavior.

## RED evidence

- Added `iteration-volume-basis-two-step.OUTCAR` with header geometry/volume, repeated `Iteration 1(M)`, stress/pressure, volume-basis markers, iteration geometry and force blocks, then iteration 2.
- Initial focused command: `python -m pytest tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py -q`.
- Observed 6 expected failures: the reported sequence raised the existing ambiguous-unconsumed-volume error; malformed iteration sequences did not raise; checkpoint iteration fields were absent.
- Added an old-payload rejection test and observed it fail because `ParserCheckpoint.model_validate(...)` accepted missing ownership fields.

## GREEN implementation

- Added active ionic iteration, maximum electronic iteration, bounded geometry-section, and header-volume scanner state.
- Parsed iterations only through `profile.outcar.details.iteration.parse(line)`, rejected malformed/decreasing counters, required contiguous completed ionic steps, and emitted `scf_iterations=max(M)`.
- Used `volume_basis_section` markers to open one active-iteration geometry section; duplicate volume and marker-free ambiguous lattice crossings remain errors.
- Prevented header volume from being consumed by iteration 1 while allowing the header lattice to initialize geometry.
- Persisted active iteration ownership state in `ParserCheckpoint`; made all new fields required so old payloads fail validation rather than guessing ownership.
- Preserved incomplete-tail behavior and append/resume from a checkpoint inside iteration 1.

## Files

- `src/vasp_analyzer/parsing/recovery/scanner.py`
- `src/vasp_analyzer/parsing/recovery/checkpoint.py`
- `tests/fixtures/outcar/iteration-volume-basis-two-step.OUTCAR`
- `tests/unit/parsing/recovery/test_scanner.py`
- `tests/unit/parsing/recovery/test_checkpoint.py`

## Final verification

- Focused recovery/adapter: `179 passed`.
- Full Python suite: `410 passed, 4 skipped, 1 warning`.
- Ruff: `All checks passed!`
- `git diff --check`: clean apart from Git's informational LF-to-CRLF worktree warnings.

## Self-review

- Confirmed no InitialStructure or schema-3 work was introduced.
- Confirmed legacy OUTCAR fixtures with iteration banners but without volume-basis markers remain supported when no ambiguous details cross a lattice.
- Confirmed checkpoint invariants reject partial/invalid ownership state and old serialized payloads.
- Confirmed the fixture is tracked in the intended OUTCAR fixture directory.

## Concerns

- The full suite retains one pre-existing Starlette/httpx deprecation warning.
- Four environment-dependent tests are skipped (local corpus unset and Windows symlink unavailable).

## Review Fix: Replay-State Alignment and Bounded Geometry

### RED evidence

- Added resume regression cuts after stress, volume, and lattice in iteration 1 and again in iteration 2 after one completed step.
- Added duplicate and conflicting second-lattice cases inside one `VOLUME and BASIS-vectors are now` section.
- RED command: `python -m pytest tests/unit/parsing/recovery/test_scanner.py tests/unit/parsing/recovery/test_checkpoint.py -q`.
- RED output: `4 failed, 82 passed`; the second-iteration resume cases failed with `electronic iteration decreased from 9 to 1`, and the second lattice did not raise.

### GREEN implementation

- Captured the lattice and iteration/geometry ownership snapshot at each verified replay boundary.
- When partial iteration evidence requires rewind, the checkpoint now serializes that boundary snapshot instead of future EOF state; clean EOF checkpoints still retain resumable active-iteration state.
- Added persisted volume/lattice consumption flags for active geometry sections and checkpoint consistency validation.
- Rejects a duplicate or conflicting lattice before parsing it, and rejects duplicate geometry-section volume consumption.

### Final review verification

- Command: `python -m pytest tests/unit/parsing/recovery tests/unit/parsing/adapters/test_outcar_ase.py -q`.
- Output: `188 passed in 2.13s`.
- Command: `python -m ruff check src/vasp_analyzer/parsing tests/unit/parsing`.
- Output: `All checks passed!`.
- Command: `git diff --check`.
- Output: clean; only informational LF-to-CRLF worktree warnings were printed.

### Fix self-review and concerns

- Verified checkpoint fields match the exact replay offset for zero-step and post-step partial iterations.
- Verified both identical and conflicting second lattices are rejected without overwriting the owned lattice.
- Existing old checkpoint payloads remain intentionally incompatible through required fields.
- No new concerns beyond the existing environment-dependent skips and deprecation warning above.
