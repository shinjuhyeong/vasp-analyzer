# Rigid AA′ MoS2 Moiré Bilayer Design

## Objective

Generate a SIESTA-compatible, rigid, commensurate MoS2 bilayer structure that
preserves the supplied monolayer geometry and interlayer separation while
introducing a twist angle close to 6 degrees. The cell must contain a complete
two-dimensional moiré period without lateral vacuum or finite-flake edges.

## Input Structure

The supplied structure uses atomic numbers 42 and 16, interpreted as Mo and S.
It contains two MoS2 monolayers in a hexagonal in-plane primitive cell:

- In-plane primitive lattice constant: approximately 3.1322 Å
- Out-of-plane cell length: 29.957801881 Å
- Mo-to-Mo layer separation: 5.723560607 Å
- Inner S-to-S interlayer gap: 2.977905117 Å
- Lower monolayer S-to-S thickness: 2.746357911 Å
- Upper monolayer S-to-S thickness: 2.746351979 Å

The small numerical difference between the two monolayer thicknesses is retained
from the supplied coordinates. No symmetrization or geometry relaxation is
applied.

## Moiré Construction

Use the commensurate hexagonal pair `(m, n) = (6, 5)`. This produces:

- Twist angle: approximately 6.009 degrees
- Primitive cells per layer: `m² + mn + n² = 91`
- Atoms per layer: 273
- Total atoms: 546
- Composition: Mo182S364
- In-plane moiré lattice-vector length: approximately 29.88 Å

The lower monolayer remains in its supplied orientation. The upper monolayer,
including its original 2H/AA′ orientation relative to the lower layer, is
rotated rigidly by the commensurate twist angle about a coincident AA′ reference
site. The rotation changes only in-plane coordinates. All relative z
coordinates, monolayer thicknesses, and interlayer separations remain unchanged.

The resulting structure is periodic in both in-plane directions. No x/y vacuum,
edge passivation, frozen boundary region, or strain is introduced. The supplied
z lattice length and its vacuum are retained.

## Outputs

Create:

1. A standalone SIESTA FDF geometry file containing:
   - `LatticeVectors`
   - two chemical species, Mo and S
   - 546 atoms in fractional coordinates
   - a descriptive system label
2. A concise validation report containing the realized twist angle, lattice
   dimensions, atom counts, composition, preserved layer distances, minimum
   interatomic distance, and periodic-boundary consistency checks.

No relaxation constraints are included because the requested deliverable is a
rigid initial structure. Constraints can be added later if a relaxation
workflow is requested.

## Validation

The generated structure must pass all of the following checks:

- Exactly 546 atoms: 182 Mo and 364 S
- No duplicate atoms, including across periodic boundaries
- Realized commensurate twist angle agrees with the `(6, 5)` construction
- Both layers tile the same moiré lattice periodically
- Mo-to-Mo separation remains 5.723560607 Å
- Inner S-to-S gap remains 2.977905117 Å
- Each supplied monolayer thickness is preserved
- The central reference stacking is AA′
- The minimum interatomic distance is physically consistent with the supplied
  monolayer geometry

## Scope

This design generates and validates the rigid structural input only. It does not
select pseudopotentials, basis sets, exchange-correlation settings, k-point
sampling, mesh cutoff, electronic convergence parameters, or relaxation
settings.
