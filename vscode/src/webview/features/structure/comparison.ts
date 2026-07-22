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

const RELATIVE_SINGULAR_EPSILON = 1e-12;

const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];
const subtract = (a: Vec3, b: Vec3): Vec3 => vec(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const normSquared = (value: Vec3): number => value[0] ** 2 + value[1] ** 2 + value[2] ** 2;
const norm = (value: Vec3): number => Math.sqrt(normSquared(value));
const canonicalInteger = (value: number): number => value === 0 ? 0 : value;

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

function assertValid(structure: ComparisonStructure, label: string): void {
  for (const row of structure.lattice) {
    for (const value of row) if (!Number.isFinite(value)) throw new Error(`${label} lattice must be finite`);
  }
  for (const position of structure.fractionalPositions) {
    for (const value of position) if (!Number.isFinite(value)) throw new Error(`${label} positions must be finite`);
  }
  const lengths = structure.lattice.map(norm);
  if (lengths.some((length) => !Number.isFinite(length) || length === 0)) throw new Error(`${label} lattice is singular or overflows`);
  const unit: Mat3 = structure.lattice.map((row, index) => vec(row[0] / lengths[index]!, row[1] / lengths[index]!, row[2] / lengths[index]!)) as unknown as Mat3;
  if (Math.abs(determinant(unit)) < RELATIVE_SINGULAR_EPSILON) throw new Error(`${label} lattice is singular or ill-conditioned`);
}

function lexicographicallyBefore(a: Vec3, b: Vec3): boolean {
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function nearestImage(initialCartesian: Vec3, targetFractional: Vec3, targetLattice: Mat3): { shift: Vec3; cartesian: Vec3 } {
  const base = fractionalToCartesian(targetFractional, targetLattice);
  const wanted = subtract(initialCartesian, base);
  if (![...base, ...wanted].every(Number.isFinite)) throw new Error("Derived Cartesian coordinates must be finite");

  // QR factorization of the lattice-basis columns. The resulting triangular
  // closest-vector problem is enumerated exactly inside the Babai sphere.
  const q: Vec3[] = [];
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let column = 0; column < 3; column += 1) {
    let residual = targetLattice[column]!;
    for (let row = 0; row < column; row += 1) {
      r[row]![column] = dot(q[row]!, targetLattice[column]!);
      residual = subtract(residual, vec(q[row]![0] * r[row]![column]!, q[row]![1] * r[row]![column]!, q[row]![2] * r[row]![column]!));
    }
    r[column]![column] = norm(residual);
    if (!Number.isFinite(r[column]![column]) || r[column]![column] === 0) throw new Error("Target lattice is singular or derived QR values are non-finite");
    q.push(vec(residual[0] / r[column]![column]!, residual[1] / r[column]![column]!, residual[2] / r[column]![column]!));
  }
  const projected = vec(dot(q[0]!, wanted), dot(q[1]!, wanted), dot(q[2]!, wanted));
  const current = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let known = 0;
    for (let column = row + 1; column < 3; column += 1) known += r[row]![column]! * current[column]!;
    current[row] = canonicalInteger(Math.round((projected[row]! - known) / r[row]![row]!));
    if (!Number.isSafeInteger(current[row])) throw new Error("Periodic image shift overflows the safe integer range");
  }
  let bestShift = vec(current[0]!, current[1]!, current[2]!);
  let bestCartesian = fractionalToCartesian(vec(targetFractional[0] + bestShift[0], targetFractional[1] + bestShift[1], targetFractional[2] + bestShift[2]), targetLattice);
  let bestDistance = normSquared(subtract(bestCartesian, initialCartesian));
  if (!Number.isFinite(bestDistance)) throw new Error("Derived nearest-image distance must be finite");

  const enumerate = (row: number, partialDistance: number): void => {
    if (row < 0) {
      const candidate = vec(current[0]!, current[1]!, current[2]!);
      if (partialDistance < bestDistance || (partialDistance === bestDistance && lexicographicallyBefore(candidate, bestShift))) {
        bestShift = candidate;
        bestDistance = partialDistance;
      }
      return;
    }
    let known = 0;
    for (let column = row + 1; column < 3; column += 1) known += r[row]![column]! * current[column]!;
    const center = (projected[row]! - known) / r[row]![row]!;
    const outwardTolerance = Number.EPSILON * 64 * bestDistance;
    const radius = Math.sqrt(Math.max(0, bestDistance + outwardTolerance - partialDistance)) / Math.abs(r[row]![row]!);
    const lower = Math.ceil(center - radius);
    const upper = Math.floor(center + radius);
    if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper)) throw new Error("Periodic image enumeration overflows the safe integer range");
    for (let value = lower; value <= upper; value += 1) {
      current[row] = canonicalInteger(value);
      const residual = r[row]![row]! * value + known - projected[row]!;
      const nextDistance = partialDistance + residual * residual;
      if (Number.isFinite(nextDistance) && nextDistance <= bestDistance + Number.EPSILON * 64 * Math.max(1, bestDistance)) enumerate(row - 1, nextDistance);
    }
  };
  enumerate(2, 0);
  bestCartesian = fractionalToCartesian(vec(targetFractional[0] + bestShift[0], targetFractional[1] + bestShift[1], targetFractional[2] + bestShift[2]), targetLattice);
  if (![...bestCartesian].every(Number.isFinite)) throw new Error("Derived mapped target must be finite");
  return { shift: bestShift, cartesian: bestCartesian };
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
    if (![...initialCartesian].every(Number.isFinite)) throw new Error("Derived initial Cartesian coordinates must be finite");
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
    const alignedTargetCartesian = vec(
      site.initialCartesian[0] + displacement[0],
      site.initialCartesian[1] + displacement[1],
      site.initialCartesian[2] + displacement[2],
    );
    return { ...site, alignedTargetCartesian, displacement, rank: rankBySite.get(site.siteIndex)! };
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
  const derived = [removedDrift, ...cellDeltas, ...sites.flatMap((site) => [site.initialCartesian, site.mappedTargetCartesian, site.alignedTargetCartesian, site.rawDisplacement, site.displacement])].flat();
  if (![...derived, ...Object.values(summary).flatMap((value) => typeof value === "number" ? [value] : [...value])].every(Number.isFinite)) {
    throw new Error("Comparison arithmetic overflowed to a non-finite result");
  }
  return { sites, removedDrift, cellDeltas, summary };
}
