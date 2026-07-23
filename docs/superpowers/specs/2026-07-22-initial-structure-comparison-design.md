# Initial Structure and Ionic Comparison Design

## Scope

This change has two connected goals:

1. Assign OUTCAR detail records to ionic steps using VASP's `Iteration N(M)` evidence, while retaining structural section markers as validation boundaries.
2. Expose a true POSCAR-backed initial structure and an Initial-only viewer mode that compares it with ionic step N.

The implementation remains standalone and local/Remote-SSH compatible. It does not add a plugin API or make DOS, band, charge, or volumetric data part of this change.

## OUTCAR Iteration Ownership

The compatibility profile shall declare a bounded pattern for the VASP iteration banner. The built-in pattern recognizes:

```text
Iteration N(M)
```

where `N` is the one-based ionic iteration and `M` is the one-based electronic iteration within it. Home-version profiles may replace the pattern without providing executable code.

The scanner shall track the current ionic iteration and the maximum electronic iteration observed for it. Repeated banners with the same `N` update the SCF count; they do not create ionic steps. The first `Iteration 1(1)` separates initial header geometry from ionic-result details. A completed force record for VASP iteration `N` maps to analyzer index `N - 1`, and the scanner cross-checks that this agrees with its contiguous internal step sequence.

Iteration numbers may restart at 1 in a new OUTCAR; they are interpreted within that file, not as a global continuation counter. A decreasing number, a skipped ionic number at a completed force record, or an electronic counter that becomes invalid within one ionic iteration is a format error. An incomplete final iteration remains governed by the existing incomplete-tail profile rule.

Iteration evidence is the primary owner signal, but not the sole structural validator. `VOLUME and BASIS-vectors are now`, lattice, stress/pressure, and `POSITION/TOTAL-FORCE` markers constrain which details may cross a lattice boundary and when an ionic record is complete.

## Initial Header and Volume Ownership

An initial header volume and lattice before the first iteration describe the starting geometry; they are not ionic convergence results. The scanner may retain the lattice as the current geometry but must not attach the header volume to ionic step 1.

Within an active ionic iteration, the profile marker `VOLUME and BASIS-vectors are now` opens a bounded pre-force geometry section. Its volume and lattice belong to the active ionic iteration and may be combined with stress and pressure from that iteration before the force block. The section closes after its complete lattice block or when a force block consumes it.

The exact observed sequence must parse as one ionic record:

```text
initial volume
initial lattice
Iteration 1(1) ... Iteration 1(M)
stress
external pressure
VOLUME and BASIS-vectors are now
step volume
step lattice
POSITION / TOTAL-FORCE
```

Duplicate or conflicting volumes inside one active geometry section remain errors. Details crossing a lattice boundary without recognized iteration and section evidence remain errors.

## Initial Structure Contract

The calculation dataset shall expose an optional `initialStructure` object separate from `ionicSteps`:

```text
InitialStructure
  source: "POSCAR"
  lattice: Mat3
  fractionalPositions: Vec3[]
  cartesianPositions: Vec3[]
```

A real POSCAR is the only source labeled `Initial`. Selective Dynamics remains stored on the existing sites and applies to this frame. CONTCAR alone is not presented as an initial structure because it normally represents a final structure. If POSCAR is absent, `initialStructure` is unavailable; the application does not synthesize or mislabel the first OUTCAR force frame.

The wire schema version shall increase because this adds a dataset field. Python models, stdio/HTTP serialization, Webview contracts, packaged contract metadata, cache identity, validation, and migrations shall change together.

## Frame Selection

The structure frame selector contains:

```text
0 = Initial
1 = Ionic step 1
2 = Ionic step 2
...
```

The visible labels are `Initial / N` and `Step k / N`. Numeric input accepts 0 for Initial. Initial is offered only when `initialStructure` exists.

Persisted selection uses a discriminated frame value rather than overloading an array index:

```text
{ kind: "initial" }
{ kind: "ionic", index: zeroBasedIonicIndex }
```

Migration maps the existing persisted `selectedStep: n` to `{ kind: "ionic", index: n }`, so an existing user's selected ionic step does not silently become Initial after upgrade.

When Initial is selected, convergence modules retain their complete graphs but show an explicit initial-state detail message instead of inventing energy, force, pressure, or stress values. No selected ionic marker is drawn. Selecting an ionic step restores the existing synchronized structure/convergence behavior.

## Initial-Only Comparison Mode

Compare controls are enabled only while the selected frame is Initial. Turning Compare on adds a target ionic-step slider and numeric input. Leaving Initial turns Compare off. The target is always one real ionic step and never another synthetic frame.

The viewer uses the approved overlay presentation:

- Initial atoms and cell: muted/semitransparent atoms and dashed cell cage.
- Target atoms and cell: solid atoms and solid cell cage.
- Atomic displacement: cyan arrows.
- Cell-vector changes: orange `delta a`, `delta b`, and `delta c` arrows.
- Force vectors: hidden in comparison mode.
- Displacement arrows: primary-cell sites only, even when the structure is expanded as a supercell.

Normal rotation, zoom, atom selection, unit-cell display, and supercell rendering remain available.

## Periodic Mapping and Common Drift

Site identity follows stable site index order. For each target site, comparison chooses the periodic image that minimizes its Cartesian distance to the initial site under the initial and target lattices. The implementation shall use a deterministic nearest-image search and reject non-finite or singular cells rather than guessing.

For mapped target position `r_i,N` and initial position `r_i,0`:

```text
raw displacement d_i = r_i,N - r_i,0
common drift t = arithmetic mean of all d_i
display displacement d_i' = d_i - t
```

`t` is a three-component Cartesian translation vector in angstroms and is recomputed for each target step. It is not mass weighted. The target atomic overlay is translated by `-t`, so at displacement scale 1x every arrow ends exactly at its aligned target atom.

Every displacement arrow begins at the initial atom center. At scales above 1x the atom remains at its aligned physical position and only the arrow extends by the selected multiplier.

The displacement control reuses the force control's logarithmic `1x-1000x` slider, synchronized numeric input, clamping, and readable precision, but stores an independent persisted `displacementScale` value.

## Cell Comparison

Cell cages share a common origin; common atomic drift is not applied to lattice vectors. For initial lattice vectors `a0`, `b0`, `c0` and target vectors `aN`, `bN`, `cN`, the comparison provides:

```text
delta a = aN - a0
delta b = bN - b0
delta c = cN - c0
```

The viewer draws those vectors from the common cell origin. The summary reports vector components and magnitudes, changes in `|a|`, `|b|`, and `|c|`, changes in alpha/beta/gamma, absolute volume change, and relative volume change. The initial and target cages remain visible so expansion, contraction, and shear can be inspected directly.

## Selection and Detail Presentation

Clicking a target or initial atom selects the same stable site. The comparison inspector reports:

- element and one-based site number;
- initial and target fractional positions;
- initial and drift-aligned target Cartesian positions;
- raw displacement vector and norm;
- displayed drift-corrected displacement vector and norm;
- global removed drift vector and norm;
- selected periodic image shift;
- displacement rank among primary-cell sites;
- current displacement multiplier.

The comparison summary reports the largest and mean drift-corrected displacements plus cell length, angle, and volume changes. Ranking is deterministic, with site index as the tie-breaker.

## Error Handling

The parser remains fail closed for malformed iteration banners inside recognized iteration contexts, non-contiguous completed ionic iterations, contradictory detail ownership, incomplete required lattice rows, singular lattices, and mismatched atom counts.

Comparison controls are unavailable when POSCAR is absent or when no ionic steps exist. A target step with inconsistent site count, non-finite coordinates, or a singular cell produces a bounded viewer error and falls back to the existing data-table surface without crashing the Webview.

Persisted target step and displacement scale are clamped and migrated. Unknown wire fields and unsupported schema versions remain rejected.

## Testing

Parser tests shall cover:

- the reported initial-volume/initial-lattice/Iteration/stress/volume/lattice/force sequence;
- multiple `Iteration N(M)` banners producing one ionic record with the correct SCF count;
- transition from ionic N to N+1;
- malformed, decreasing, and skipped iteration evidence;
- incomplete-tail and append/resume behavior;
- marker-free ambiguous lattice crossings remaining rejected.

Dataset and transport tests shall cover optional POSCAR-backed `initialStructure`, absence without POSCAR, schema serialization, cache identity, and get-step compatibility.

Webview tests shall cover frame 0 selection, Initial availability, convergence empty-state behavior, Compare lifecycle, target slider/number synchronization, independent persisted scale, periodic minimum-image mapping, drift vector removal, 1x arrow endpoints, deterministic ranking, primary-cell-only arrows under supercell expansion, atom inspection, cell deltas, renderer cleanup, and malformed comparison fallback.

Full Python, Ruff, Webview tests, typecheck, production builds, wheel/sdist/VSIX contract verification, and a fresh installed-wheel stdio smoke test are required before publication. The real YBCO OUTCAR shall then be checked on the Remote SSH host, including `scfIterations`, initial frame, step 1 ownership, and comparison rendering.
