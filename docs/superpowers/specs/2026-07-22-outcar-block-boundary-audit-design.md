# OUTCAR Block Boundary Audit Design

## Scope

This change fixes two scanner ownership defects found by auditing the supplied full OUTCAR files:

- `OUTCAR_homever`: 6,648,614 bytes, 35 ionic iterations, 35 force blocks, and 35 energy blocks.
- `OUTCAR_official`: 9,859,581 bytes, 200 ionic iterations, 200 force blocks, and 200 energy blocks.

The defects are common scanner problems rather than home-version-only syntax:

1. The energy section remains active after its closing separator and misclassifies later optimizer assignments as energy terms.
2. More than one complete volume/lattice header may appear before `Iteration N(M)`, notably a primitive-cell block followed by the calculation-cell block.

This change does not add new wire fields or expose optimizer diagnostics in the UI.

## Bounded Energy Block

The scanner shall replace the unbounded Boolean energy-section behavior with an explicit block phase:

```text
closed
  -> marker seen
awaiting opening separator
  -> hyphen separator
body
  -> closing hyphen separator
closed
```

Blank lines do not close the body. A structural marker that cannot legally occur in an energy body closes or rejects the block according to existing fail-closed ownership rules.

The body may contain:

- `free energy TOTEN`;
- `energy without entropy` plus `energy(sigma->0)`;
- valid single energy assignments, including profile-declared and preserved unknown contributions;
- VASP ionic-optimizer diagnostic rows beginning with `d Force =`.

`d Force` rows are not energy contributions. The standard and home files both contain `d Energy` and `d Ewald` variants with signed numbers either separated or concatenated. The scanner shall recognize the bounded diagnostic prefix within the energy body, validate that the complete row matches the supported numeric diagnostic grammar, and omit it from `energy_terms`.

After the closing separator, `forcemax`, steepest-descent output, timing output, and other assignments must not reach `parse_energy_line`.

Malformed single energy assignments inside the body remain errors. Unknown or multiple assignments are not ignored globally.

## Repeated Pre-Iteration Header Geometry

Before the first recognized `Iteration N(M)`, a complete volume/lattice block describes header geometry and never an ionic result. Multiple complete header blocks are permitted.

For each complete pre-iteration block:

- the lattice becomes the current scanner lattice;
- its volume may replace the previous header volume for checkpoint continuity;
- neither volume is attached to ionic step 1;
- an incomplete or contradictory lattice block remains an error.

This covers the official file's primitive-cell block followed by its calculation-cell block. Once an ionic iteration is active, repeated geometry is permitted only inside the explicit `VOLUME and BASIS-vectors are now` section and retains the existing duplicate/conflict checks.

## Profile Extensibility

Compatibility profiles remain declarative and non-executable. The optimizer diagnostic marker shall be a bounded literal prefix collection, defaulting to `d Force`. A home-version profile may replace or extend the marker without supplying arbitrary regular expressions or Python code.

The numeric grammar is analyzer-owned. Profile markers select a diagnostic family; they do not weaken numeric validation or generic energy assignment validation.

## Checkpoint and Resume

Energy block phase is transient detail state. A checkpoint may advance past a stable completed force record as before. If EOF occurs inside an energy block or before pending details are fully representable, resume rewinds to the verified record boundary rather than persisting a partial block.

Repeated pre-iteration header geometry must produce the same final lattice and no ionic volume whether parsed fresh or through an append/resume cut after either complete header lattice.

## Error Handling

The scanner remains fail closed for:

- missing opening or closing energy separators when a subsequent owned record requires completion;
- malformed `d Force` diagnostic rows inside a bounded energy body;
- malformed single energy assignments;
- duplicate/conflicting volume or lattice inside an active ionic geometry section;
- incomplete lattice, stress, force, and required iteration records.

Text after the closing energy separator is outside the energy grammar and is not validated as energy.

## Testing and Acceptance

Focused fixtures shall cover:

- `d Force / d Energy` with separated and concatenated signed deltas;
- `d Force / d Ewald` with separated and concatenated signed deltas;
- closing the energy block before `forcemax`;
- retaining strict rejection of malformed energy assignments inside the body;
- two complete pre-iteration volume/lattice blocks;
- header volumes never appearing on ionic step 1;
- append/resume at energy and header-geometry boundaries.

The supplied full files are local audit inputs and are not committed. Acceptance requires:

- home file parses 35 contiguous ionic steps and 35 force/energy records;
- official file parses 200 contiguous ionic steps and 200 force/energy records;
- every step has the expected `scf_iterations` derived from `Iteration N(M)`;
- fresh and append/resume results are equivalent at selected boundaries;
- no optimizer diagnostic appears in `energy_terms`;
- full Python tests and Ruff pass;
- a fresh wheel installed in an isolated environment parses both files through the installed `analyzer` entrypoint.
