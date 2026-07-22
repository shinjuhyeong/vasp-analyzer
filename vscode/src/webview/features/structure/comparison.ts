import type { Mat3, Vec3 } from "../../core/contracts.js";

export interface ComparisonStructure {
  readonly lattice: Mat3;
  readonly fractionalPositions: readonly Vec3[];
}

export interface ComparisonSummary {
  readonly largestDisplacement: number;
  readonly meanDisplacement: number;
  readonly cellDeltaMagnitudes: Vec3;
  readonly lengthChanges: Vec3;
  /** Changes in alpha, beta, and gamma, in degrees. */
  readonly angleChanges: Vec3;
  readonly volumeChange: number;
  readonly relativeVolumeChange: number;
}

export interface SiteComparison {
  readonly siteIndex: number;
  readonly imageShift: readonly [number, number, number];
  readonly initialCartesian: Vec3;
  readonly mappedTargetCartesian: Vec3;
  readonly alignedTargetCartesian: Vec3;
  readonly rawDisplacement: Vec3;
  readonly displacement: Vec3;
  readonly rank: number;
}

export interface StructureComparison {
  readonly sites: readonly SiteComparison[];
  readonly removedDrift: Vec3;
  readonly cellDeltas: readonly [Vec3, Vec3, Vec3];
  readonly summary: ComparisonSummary;
}

const SINGULAR_EPSILON = 1e-12;
const SEARCH_RADIUS = 2;

const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];
const subtract = (a: Vec3, b: Vec3): Vec3 => vec(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const normSquared = (value: Vec3): number => value[0] ** 2 + value[1] ** 2 + value[2] ** 2;
const norm = (value: Vec3): number => Math.sqrt(normSquared(value));

function determinant(matrix: Mat3): number {
  const [a, b, c] = matrix;
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function fractionalToCartesian(fractional: Vec3, lattice: Mat3): Vec3 {
  return vec(
    fractional[0] * lattice[0][0] + fractional[1] * lattice[1][0] + fractional[2] * lattice[2][0],
    fractional[0] * lattice[0][1] + fractional[1] * lattice[1][1] + fractional[2] * lattice[2][1],
    fractional[0] * lattice[0][2] + fractional[1] * lattice[1][2] + fractional[2] * lattice[2][2],
  );
}

function cartesianToFractional(cartesian: Vec3, lattice: Mat3): Vec3 {
  const [a, b, c] = lattice;
  const det = determinant(lattice);
  return vec(
    (cartesian[0] * (b[1] * c[2] - b[2] * c[1]) + cartesian[1] * (b[2] * c[0] - b[0] * c[2]) + cartesian[2] * (b[0] * c[1] - b[1] * c[0])) / det,
    (cartesian[0] * (c[1] * a[2] - c[2] * a[1]) + cartesian[1] * (c[2] * a[0] - c[0] * a[2]) + cartesian[2] * (c[0] * a[1] - c[1] * a[0])) / det,
    (cartesian[0] * (a[1] * b[2] - a[2] * b[1]) + cartesian[1] * (a[2] * b[0] - a[0] * b[2]) + cartesian[2] * (a[0] * b[1] - a[1] * b[0])) / det,
  );
}

function assertValid(structure: ComparisonStructure, label: string): void {
  for (const row of structure.lattice) {
    for (const value of row) if (!Number.isFinite(value)) throw new Error(`${label} lattice must be finite`);
  }
  for (const position of structure.fractionalPositions) {
    for (const value of position) if (!Number.isFinite(value)) throw new Error(`${label} positions must be finite`);
  }
  if (Math.abs(determinant(structure.lattice)) < SINGULAR_EPSILON) throw new Error(`${label} lattice is singular`);
}

function lexicographicallyBefore(a: Vec3, b: Vec3): boolean {
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
}

function nearestImage(initialCartesian: Vec3, targetFractional: Vec3, targetLattice: Mat3): { shift: Vec3; cartesian: Vec3 } {
  const implied = subtract(cartesianToFractional(initialCartesian, targetLattice), targetFractional);
  const center = vec(Math.round(implied[0]), Math.round(implied[1]), Math.round(implied[2]));
  let bestShift: Vec3 | undefined;
  let bestCartesian: Vec3 | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = -SEARCH_RADIUS; i <= SEARCH_RADIUS; i += 1) {
    for (let j = -SEARCH_RADIUS; j <= SEARCH_RADIUS; j += 1) {
      for (let k = -SEARCH_RADIUS; k <= SEARCH_RADIUS; k += 1) {
        const shift = vec(center[0] + i, center[1] + j, center[2] + k);
        const cartesian = fractionalToCartesian(vec(
          targetFractional[0] + shift[0], targetFractional[1] + shift[1], targetFractional[2] + shift[2],
        ), targetLattice);
        const distance = normSquared(subtract(cartesian, initialCartesian));
        const tolerance = Number.EPSILON * 32 * Math.max(1, distance, Number.isFinite(bestDistance) ? bestDistance : 0);
        if (!bestShift || distance < bestDistance - tolerance || (Math.abs(distance - bestDistance) <= tolerance && lexicographicallyBefore(shift, bestShift))) {
          bestDistance = distance;
          bestShift = shift;
          bestCartesian = cartesian;
        }
      }
    }
  }
  return { shift: bestShift!, cartesian: bestCartesian! };
}

function angleDegrees(a: Vec3, b: Vec3): number {
  const cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function cellAngles(lattice: Mat3): Vec3 {
  return vec(angleDegrees(lattice[1], lattice[2]), angleDegrees(lattice[0], lattice[2]), angleDegrees(lattice[0], lattice[1]));
}

export function compareStructures(initial: ComparisonStructure, target: ComparisonStructure): StructureComparison {
  assertValid(initial, "Initial");
  assertValid(target, "Target");
  if (initial.fractionalPositions.length !== target.fractionalPositions.length || initial.fractionalPositions.length === 0) {
    throw new Error("Structure site counts must match and be non-zero");
  }

  const rawSites = initial.fractionalPositions.map((fractional, siteIndex) => {
    const initialCartesian = fractionalToCartesian(fractional, initial.lattice);
    const mapped = nearestImage(initialCartesian, target.fractionalPositions[siteIndex]!, target.lattice);
    return { siteIndex, imageShift: mapped.shift, initialCartesian, mappedTargetCartesian: mapped.cartesian,
      rawDisplacement: subtract(mapped.cartesian, initialCartesian) };
  });
  const count = rawSites.length;
  const removedDrift = vec(
    rawSites.reduce((sum, site) => sum + site.rawDisplacement[0], 0) / count,
    rawSites.reduce((sum, site) => sum + site.rawDisplacement[1], 0) / count,
    rawSites.reduce((sum, site) => sum + site.rawDisplacement[2], 0) / count,
  );
  // Ranking is based on the displayed, drift-corrected displacement.
  const ranks = [...rawSites].sort((a, b) => normSquared(subtract(b.rawDisplacement, removedDrift)) - normSquared(subtract(a.rawDisplacement, removedDrift)) || a.siteIndex - b.siteIndex);
  const rankBySite = new Map(ranks.map((site, index) => [site.siteIndex, index + 1]));
  const sites: readonly SiteComparison[] = rawSites.map((site) => {
    const displacement = subtract(site.rawDisplacement, removedDrift);
    return { ...site, alignedTargetCartesian: subtract(site.mappedTargetCartesian, removedDrift), displacement, rank: rankBySite.get(site.siteIndex)! };
  });
  const cellDeltas: readonly [Vec3, Vec3, Vec3] = [
    subtract(target.lattice[0], initial.lattice[0]), subtract(target.lattice[1], initial.lattice[1]), subtract(target.lattice[2], initial.lattice[2]),
  ];
  const initialAngles = cellAngles(initial.lattice);
  const targetAngles = cellAngles(target.lattice);
  const magnitudes = sites.map((site) => norm(site.displacement));
  const initialVolume = Math.abs(determinant(initial.lattice));
  const volumeChange = Math.abs(determinant(target.lattice)) - initialVolume;
  const summary: ComparisonSummary = {
    largestDisplacement: Math.max(...magnitudes),
    meanDisplacement: magnitudes.reduce((sum, value) => sum + value, 0) / count,
    cellDeltaMagnitudes: vec(norm(cellDeltas[0]), norm(cellDeltas[1]), norm(cellDeltas[2])),
    lengthChanges: vec(norm(target.lattice[0]) - norm(initial.lattice[0]), norm(target.lattice[1]) - norm(initial.lattice[1]), norm(target.lattice[2]) - norm(initial.lattice[2])),
    angleChanges: subtract(targetAngles, initialAngles),
    volumeChange,
    relativeVolumeChange: volumeChange / initialVolume,
  };
  return { sites, removedDrift, cellDeltas, summary };
}
