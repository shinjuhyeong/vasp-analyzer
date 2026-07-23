# Effective OUTCAR Parameters Design

## Goal

Replace annotation-heavy parameter value parsing with a tolerant parser that
extracts useful typed values and units. Parameter metadata is optional:
structure, force, energy, cell, and stress data must remain usable when all or
part of the parameter scan fails.

## Scope

- Keep VaspParser as the only authoritative trajectory parser.
- Keep the existing `ParameterOccurrence` wire contract and the Raw Parameters
  view for compatibility and diagnosis.
- Make the Interpreted Parameters view use the final occurrence of each
  canonical key, as it does today.
- Do not require source line numbers for interpretation. Retain them when
  cheaply available for the Raw view.
- Do not infer whether a value originated in INCAR or from a VASP default.

## Parsing Rules

Each assignment retains `rawKey` and the complete `rawValue`. Its interpreted
value is derived from the leading value expression:

1. Recognize case-insensitive `T` and `F` as booleans.
2. Recognize signed integers.
3. Recognize finite decimal or scientific numbers, including Fortran `D`
   exponents and forms such as `-.1E-01`.
4. Recognize a whitespace-separated numeric vector as a numeric tuple.
5. Stop an interpreted scalar or vector before explanatory prose, option
   legends, comments, or secondary unit conversions.
6. Recognize an immediately adjacent supported unit token. Normalize known
   spellings to the analyzer's display units, including `eV`, `eV/angstrom`,
   `K`, `fs`, and `kB`.
7. Apply semantic units from known parameter metadata when VASP omits the unit:
   for example, positive `EDIFFG` is `eV`, negative `EDIFFG` is
   `eV/angstrom`, and `ENCUT` is `eV`.
8. Preserve an unrecognized leading value as a bounded string rather than
   rejecting the assignment.
9. Reject non-finite numeric tokens as metadata failures; never place NaN or
   infinity in the dataset.

Examples:

| OUTCAR assignment | Interpreted result |
| --- | --- |
| `ISPIN = 1 spin polarized?` | `1`, no unit |
| `ENCUT = 600.0 eV 44.10 Ry ...` | `600.0`, `eV` |
| `EDIFFG = -.1E-01 stopping-criterion` | `-0.01`, `eV/angstrom` |
| `LREAL = F real-space projection` | `false`, no unit |
| `MAGMOM = 1 1 0 0` | `(1.0, 1.0, 0.0, 0.0)`, no unit |

Repeated keys remain ordered occurrences. The final occurrence is the
effective value shown by default.

## Failure Isolation

Parameter metadata is best-effort and must never veto a valid trajectory.

- A malformed assignment produces one bounded `MetadataParseFailure` warning
  and scanning continues with later lines.
- An oversized or undecodable metadata line is skipped with a bounded warning.
- Failure to open or scan the metadata stream produces a bounded warning and an
  empty parameter list; the normalizer and VaspParser trajectory pipeline still
  run.
- Unexpected ordinary exceptions at the metadata boundary are converted to a
  bounded warning. Control-flow and memory exceptions are not swallowed.
- Pulay metadata follows the same non-fatal policy. A pressure-record count
  mismatch leaves all Pulay values unavailable instead of shifting them between
  ionic steps.

Warnings must not include unbounded source text or sensitive full paths.

## UI and Compatibility

No wire-schema change is required.

- Interpreted view: final typed value, normalized unit, category, and
  description.
- Raw view: every occurrence and its unmodified raw value. A line number is
  shown when available and `Unavailable` otherwise.
- If parameter scanning yields no values, the Parameters tab shows a clear
  non-fatal empty state. The structure and convergence panels remain available.
- Existing saved datasets and extension contracts continue to validate.

## Verification

Tests must be written before implementation and cover:

- annotated integer, float, boolean, Fortran exponent, and numeric-vector
  extraction;
- known explicit and semantic units;
- option legends and secondary conversion text excluded from the typed value;
- repeated-key effective selection;
- unknown home-version values preserved as strings;
- malformed, oversized, undecodable, and stream-level metadata failures
  becoming warnings without blocking dataset construction;
- both real audit OUTCAR files opening with unchanged structure/step counts and
  materially fewer annotation-heavy string values;
- Python, transport, Webview, build, Chromium layout, installed-wheel, and
  release-artifact regression gates.

