import type { Mat3, Vec3 } from "../../core/contracts.js";
import type {
  CellAxis,
  ComparisonScene,
  CrystalFrame,
  DirectionSemantics,
  LatticeImage,
  LineSegment,
  PeriodicBond,
  RenderSite,
  SupercellRepeat,
} from "../../renderers/CrystalRenderer.js";
import type { StructureComparison } from "./comparison.js";

export interface SceneSiteInput {
  readonly siteIndex: number;
  readonly element: string;
  readonly fractionalPosition: Vec3;
  readonly cartesianPosition: Vec3;
}

/** Pair bonds are accepted up to r_cov(A) + r_cov(B) + this tolerance, in angstrom. */
export const BOND_TOLERANCE_ANGSTROM = 0.45;
const MIN_BOND_LENGTH_ANGSTROM = 0.1;

// Cordero-style single-bond covalent radii (angstrom). Unknown symbols intentionally have no fallback.
const COVALENT_RADII: Readonly<Record<string, number>> = Object.freeze({
  H: 0.31,
  He: 0.28,
  Li: 1.28,
  Be: 0.96,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  Ne: 0.58,
  Na: 1.66,
  Mg: 1.41,
  Al: 1.21,
  Si: 1.11,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Ar: 1.06,
  K: 2.03,
  Ca: 1.76,
  Sc: 1.7,
  Ti: 1.6,
  V: 1.53,
  Cr: 1.39,
  Mn: 1.39,
  Fe: 1.32,
  Co: 1.26,
  Ni: 1.24,
  Cu: 1.32,
  Zn: 1.22,
  Ga: 1.22,
  Ge: 1.2,
  As: 1.19,
  Se: 1.2,
  Br: 1.2,
  Kr: 1.16,
  Rb: 2.2,
  Sr: 1.95,
  Y: 1.9,
  Zr: 1.75,
  Nb: 1.64,
  Mo: 1.54,
  Tc: 1.47,
  Ru: 1.46,
  Rh: 1.42,
  Pd: 1.39,
  Ag: 1.45,
  Cd: 1.44,
  In: 1.42,
  Sn: 1.39,
  Sb: 1.39,
  Te: 1.38,
  I: 1.39,
  Xe: 1.4,
  Cs: 2.44,
  Ba: 2.15,
  La: 2.07,
  Ce: 2.04,
  Pr: 2.03,
  Nd: 2.01,
  Pm: 1.99,
  Sm: 1.98,
  Eu: 1.98,
  Gd: 1.96,
  Tb: 1.94,
  Dy: 1.92,
  Ho: 1.92,
  Er: 1.89,
  Tm: 1.9,
  Yb: 1.87,
  Lu: 1.87,
  Hf: 1.75,
  Ta: 1.7,
  W: 1.62,
  Re: 1.51,
  Os: 1.44,
  Ir: 1.41,
  Pt: 1.36,
  Au: 1.36,
  Hg: 1.32,
  Tl: 1.45,
  Pb: 1.46,
  Bi: 1.48,
  Po: 1.4,
  At: 1.5,
  Rn: 1.5,
  Fr: 2.6,
  Ra: 2.21,
  Ac: 2.15,
  Th: 2.06,
  Pa: 2.0,
  U: 1.96,
  Np: 1.9,
  Pu: 1.87,
  Am: 1.8,
  Cm: 1.69,
  Bk: 1.68,
  Cf: 1.68,
  Es: 1.65,
  Fm: 1.67,
  Md: 1.73,
  No: 1.76,
  Lr: 1.61,
  Rf: 1.57,
  Db: 1.49,
  Sg: 1.43,
  Bh: 1.41,
  Hs: 1.34,
  Mt: 1.29,
  Ds: 1.28,
  Rg: 1.21,
  Cn: 1.22,
  Nh: 1.36,
  Fl: 1.43,
  Mc: 1.62,
  Lv: 1.75,
  Ts: 1.65,
  Og: 1.57,
});

const ELEMENT_COLORS: Readonly<Record<string, string>> = Object.freeze({
  H: "#ffffff", O: "#ff0d0d", Cu: "#c88033", Y: "#94ffff", Ba: "#00c900",
});

export interface ElementVisual {
  readonly element: string;
  readonly color: string;
  readonly radius: number;
}

export function elementVisual(element: string): ElementVisual {
  return Object.freeze({
    element,
    color: ELEMENT_COLORS[element] ?? "#9aa0a6",
    radius: Math.min(0.52, Math.max(0.22, (COVALENT_RADII[element] ?? 1.2) * 0.25)),
  });
}

export function elementLegend(sites: readonly Pick<SceneSiteInput, "element">[]): readonly ElementVisual[] {
  return Object.freeze([...new Set(sites.map((site) => site.element))].map(elementVisual));
}

const freezeVec = (value: readonly number[]): Vec3 =>
  Object.freeze([value[0]!, value[1]!, value[2]!]);
const add = (left: Vec3, right: Vec3): Vec3 =>
  freezeVec([left[0] + right[0], left[1] + right[1], left[2] + right[2]]);
const scale = (value: Vec3, factor: number): Vec3 =>
  freezeVec(value.map((item) => item * factor));
const fractionalToCartesian = (
  fractional: readonly number[],
  lattice: Mat3,
): Vec3 =>
  freezeVec([
    fractional[0]! * lattice[0][0] +
      fractional[1]! * lattice[1][0] +
      fractional[2]! * lattice[2][0],
    fractional[0]! * lattice[0][1] +
      fractional[1]! * lattice[1][1] +
      fractional[2]! * lattice[2][1],
    fractional[0]! * lattice[0][2] +
      fractional[1]! * lattice[1][2] +
      fractional[2]! * lattice[2][2],
  ]);
const norm = (value: readonly number[]): number => Math.hypot(...value);

function determinant(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function inverse(m: Mat3): Mat3 {
  const d = determinant(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12)
    throw new Error("Lattice must be finite and non-singular");
  return Object.freeze([
    freezeVec([
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / d,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / d,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / d,
    ]),
    freezeVec([
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / d,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / d,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / d,
    ]),
    freezeVec([
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / d,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / d,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / d,
    ]),
  ]);
}

export function covalentRadius(element: string): number | null {
  return COVALENT_RADII[element] ?? null;
}

function latticeImagesWithinCutoff(
  rawDelta: Vec3,
  lattice: Mat3,
  cutoff: number,
  sameSite: boolean,
): readonly {
  readonly image: LatticeImage;
  readonly delta: Vec3;
  readonly distance: number;
}[] {
  const inv = inverse(lattice);
  const componentBounds = ([0, 1, 2] as const).map(
    (axis) => cutoff * Math.hypot(inv[0][axis], inv[1][axis], inv[2][axis]),
  );
  const lows = componentBounds.map((bound, axis) =>
    Math.ceil(-rawDelta[axis]! - bound - 1e-12),
  );
  const highs = componentBounds.map((bound, axis) =>
    Math.floor(-rawDelta[axis]! + bound + 1e-12),
  );
  const results: Array<{
    readonly image: LatticeImage;
    readonly delta: Vec3;
    readonly distance: number;
  }> = [];
  for (let x = lows[0]!; x <= highs[0]!; x++)
    for (let y = lows[1]!; y <= highs[1]!; y++)
      for (let z = lows[2]!; z <= highs[2]!; z++) {
        if (sameSite) {
          const firstNonZero = [x, y, z].find((value) => value !== 0);
          if (firstNonZero === undefined || firstNonZero < 0) continue;
        }
        const image: LatticeImage = Object.freeze([x, y, z]);
        const delta = freezeVec([
          rawDelta[0] + x,
          rawDelta[1] + y,
          rawDelta[2] + z,
        ]);
        const distance = norm(fractionalToCartesian(delta, lattice));
        if (distance >= MIN_BOND_LENGTH_ANGSTROM && distance <= cutoff + 1e-12)
          results.push(Object.freeze({ image, delta, distance }));
      }
  return Object.freeze(results);
}

export function replicateSites(
  inputs: readonly SceneSiteInput[],
  lattice: Mat3,
  repeat: SupercellRepeat,
): readonly RenderSite[] {
  if (
    repeat.some((value) => !Number.isInteger(value) || value < 1 || value > 8)
  )
    throw new Error("Supercell repeats must be integers from 1 to 8");
  const result: RenderSite[] = [];
  for (let a = 0; a < repeat[0]; a++)
    for (let b = 0; b < repeat[1]; b++)
      for (let c = 0; c < repeat[2]; c++) {
        const image: LatticeImage = Object.freeze([a, b, c]);
        const shift = fractionalToCartesian(image, lattice);
        for (const site of inputs)
          result.push(
            Object.freeze({
              ...site,
              image,
              role: "primary" as const,
              fractionalPosition: freezeVec([
                site.fractionalPosition[0] + a,
                site.fractionalPosition[1] + b,
                site.fractionalPosition[2] + c,
              ]),
              cartesianPosition: add(site.cartesianPosition, shift),
            }),
          );
      }
  return Object.freeze(result);
}

function cellGeometry(
  lattice: Mat3,
  repeat: SupercellRepeat,
): { edges: readonly LineSegment[]; axes: readonly CellAxis[] } {
  const vectors = lattice.map((vector, axis) =>
    scale(vector, repeat[axis]!),
  ) as unknown as Mat3;
  const origin: Vec3 = Object.freeze([0, 0, 0]);
  const corners = new Map<string, Vec3>();
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++)
        corners.set(
          `${x}${y}${z}`,
          fractionalToCartesian(
            [x * repeat[0], y * repeat[1], z * repeat[2]],
            lattice,
          ),
        );
  const edges: LineSegment[] = [];
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++)
        for (let axis = 0; axis < 3; axis++) {
          const state = [x, y, z];
          if (state[axis] === 1) continue;
          const next = [...state];
          next[axis] = 1;
          edges.push(
            Object.freeze({
              start: corners.get(state.join(""))!,
              end: corners.get(next.join(""))!,
            }),
          );
        }
  const axes = (["a", "b", "c"] as const).map((label, axis) =>
    Object.freeze({ label, start: origin, end: vectors[axis]! }),
  );
  return { edges: Object.freeze(edges), axes: Object.freeze(axes) };
}

function periodicBonds(
  inputs: readonly SceneSiteInput[],
  lattice: Mat3,
  repeat: SupercellRepeat,
): readonly PeriodicBond[] {
  const bonds: PeriodicBond[] = [];
  for (let first = 0; first < inputs.length; first++)
    for (let second = first; second < inputs.length; second++) {
      const left = inputs[first]!,
        right = inputs[second]!;
      const leftRadius = covalentRadius(left.element),
        rightRadius = covalentRadius(right.element);
      if (leftRadius === null || rightRadius === null) continue;
      const raw = freezeVec(
        right.fractionalPosition.map(
          (value, axis) => value - left.fractionalPosition[axis]!,
        ),
      );
      const neighbors = latticeImagesWithinCutoff(
        raw,
        lattice,
        leftRadius + rightRadius + BOND_TOLERANCE_ANGSTROM,
        first === second,
      );
      for (const neighbor of neighbors)
        for (let a = 0; a < repeat[0]; a++)
          for (let b = 0; b < repeat[1]; b++)
            for (let c = 0; c < repeat[2]; c++) {
              const fromImage: LatticeImage = Object.freeze([a, b, c]);
              const toImage: LatticeImage = Object.freeze([
                a + neighbor.image[0],
                b + neighbor.image[1],
                c + neighbor.image[2],
              ]);
              const start = add(
                left.cartesianPosition,
                fractionalToCartesian(fromImage, lattice),
              );
              const end = add(
                start,
                fractionalToCartesian(neighbor.delta, lattice),
              );
              bonds.push(
                Object.freeze({
                  start,
                  end,
                  fromSiteIndex: left.siteIndex,
                  toSiteIndex: right.siteIndex,
                  fromImage,
                  toImage,
                }),
              );
            }
    }
  return Object.freeze(bonds);
}

export function buildCrystalFrame(
  inputs: readonly SceneSiteInput[],
  lattice: Mat3,
  repeat: SupercellRepeat,
): CrystalFrame {
  const { edges, axes } = cellGeometry(lattice, repeat);
  const primarySites = replicateSites(inputs, lattice, repeat);
  const bonds = periodicBonds(inputs, lattice, repeat);
  const bySiteIndex = new Map(inputs.map((site) => [site.siteIndex, site]));
  const sites: RenderSite[] = [...primarySites];
  const siteKeys = new Set(
    sites.map((site) => `${site.siteIndex}:${site.image.join(",")}`),
  );
  for (const bond of bonds) {
    for (const endpoint of [
      {
        siteIndex: bond.fromSiteIndex,
        image: bond.fromImage,
        cartesianPosition: bond.start,
      },
      {
        siteIndex: bond.toSiteIndex,
        image: bond.toImage,
        cartesianPosition: bond.end,
      },
    ] as const) {
      const key = `${endpoint.siteIndex}:${endpoint.image.join(",")}`;
      if (siteKeys.has(key)) continue;
      const source = bySiteIndex.get(endpoint.siteIndex);
      if (!source)
        throw new Error(
          `Bond references missing siteIndex ${endpoint.siteIndex}`,
        );
      sites.push(
        Object.freeze({
          siteIndex: source.siteIndex,
          element: source.element,
          image: endpoint.image,
          role: "boundary" as const,
          fractionalPosition: freezeVec(
            source.fractionalPosition.map(
              (value, axis) => value + endpoint.image[axis]!,
            ),
          ),
          cartesianPosition: endpoint.cartesianPosition,
        }),
      );
      siteKeys.add(key);
    }
  }
  return Object.freeze({
    lattice,
    sites: Object.freeze(sites),
    cellEdges: edges,
    axes,
    bonds,
  });
}

export function buildComparisonScene(
  initialInputs: readonly SceneSiteInput[],
  targetInputs: readonly SceneSiteInput[],
  initialLattice: Mat3,
  targetLattice: Mat3,
  comparison: StructureComparison,
  repeat: SupercellRepeat,
  displacementScale: number,
): ComparisonScene {
  const bySite = new Map(comparison.sites.map((site) => [site.siteIndex, site]));
  const alignedTargets = targetInputs.map((input) => {
    const site = bySite.get(input.siteIndex);
    if (!site) throw new Error(`Comparison is missing siteIndex ${input.siteIndex}`);
    return Object.freeze({ ...input, cartesianPosition: site.alignedTargetCartesian });
  });
  const origin: Vec3 = Object.freeze([0, 0, 0]);
  return Object.freeze({
    initialFrame: buildCrystalFrame(initialInputs, initialLattice, repeat),
    targetFrame: buildCrystalFrame(alignedTargets, targetLattice, repeat),
    displacements: Object.freeze(comparison.sites.map((site) => Object.freeze({
      siteIndex: site.siteIndex,
      origin: site.initialCartesian,
      vector: site.displacement,
      strongestAxis: null,
      strongestValue: null,
    }))),
    displacementScale: Number.isFinite(displacementScale) ? Math.max(0, displacementScale) : 1,
    cellDeltas: Object.freeze(comparison.cellDeltas.map((delta, axis) => Object.freeze({
      label: (["a", "b", "c"] as const)[axis]!, start: origin, end: delta,
    }))),
  });
}

export function parseIntegerDirection(
  input: string,
): readonly [number, number, number] {
  const parts = input
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value)))
    throw new Error("Direction must contain exactly three integers");
  if (parts.every((value) => value === 0))
    throw new Error("Direction must be non-zero");
  return Object.freeze([parts[0]!, parts[1]!, parts[2]!]);
}

/** [uvw] uses direct lattice vectors; (hkl) uses reciprocal vectors without the irrelevant 2pi factor. */
export function crystallographicViewVector(
  direction: readonly [number, number, number],
  lattice: Mat3,
  semantics: DirectionSemantics,
): Vec3 {
  if (
    direction.every((value) => value === 0) ||
    direction.some((value) => !Number.isInteger(value))
  )
    throw new Error("Direction must be a non-zero integer triple");
  if (semantics === "direct") return fractionalToCartesian(direction, lattice);
  const inv = inverse(lattice);
  return freezeVec([
    direction[0] * inv[0][0] +
      direction[1] * inv[0][1] +
      direction[2] * inv[0][2],
    direction[0] * inv[1][0] +
      direction[1] * inv[1][1] +
      direction[2] * inv[1][2],
    direction[0] * inv[2][0] +
      direction[1] * inv[2][1] +
      direction[2] * inv[2][2],
  ]);
}
