# Normalizers Task 2 Report

## Scope

Implemented the built-in and XDG JSON normalizer registry only. No
`release-current` or UI files were modified.

## Delivered

- Added immutable `NormalizerSource` and `NormalizerMatch` registry records.
- Added deterministic built-in resource discovery and sorted XDG/home user discovery.
- Added strict UTF-8, JSON, and `NormalizerDefinition` validation with path-bearing,
  fail-closed errors.
- Added duplicate-ID rejection across all discovered definitions.
- Added canonical model-JSON SHA-256 identity hashes.
- Added byte-oriented `all`/`any`/`none` selection bounded to the first 1 MiB,
  deterministic priority handling, equal-priority ambiguity rejection, and standard
  fallback.
- Added exact `standard.json` and canonical `home_barrier.json` packaged resources.
- Exported the registry API from `vasp_analyzer.normalizers`.

## TDD Evidence

RED:

`python -m pytest tests/unit/normalizers/test_registry.py -q`

Failed during collection with
`ModuleNotFoundError: No module named 'vasp_analyzer.normalizers.registry'`.

GREEN:

`python -m pytest tests/unit/normalizers/test_registry.py -q`

Result: `11 passed`.

Final verification:

`python -m pytest tests/unit/normalizers/test_registry.py tests/unit/normalizers/test_models.py -q`

Result: `52 passed in 1.54s`.

`python -m ruff check src/vasp_analyzer/normalizers tests/unit/normalizers`

Result: `All checks passed!`

`git diff --check`

Result: exit code 0 (only a Git LF-to-CRLF working-copy warning).

## Concerns

- `release-current/` was already untracked in this worktree and was deliberately left
  untouched and excluded from the commit.
- Registry selection accepts an already-read byte prefix and defensively truncates it
  to 1 MiB; the eventual caller remains responsible for bounded source-file reading.
