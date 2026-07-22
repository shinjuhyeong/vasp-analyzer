import type { CalculationDataset, IonicStep, SelectiveMask, Vec3 } from "../../core/contracts.js";

export type DetailRank = 1 | 2 | null;

export interface RankedEnergyRow {
  readonly key: string;
  readonly rawLabel: string;
  readonly value: number;
  readonly unit: "eV";
  readonly kind: "contribution" | "aggregate";
  readonly rank: DetailRank;
}

export interface ForceDetailRow {
  readonly siteIndex: number;
  readonly siteLabel: string;
  readonly position: Vec3;
  readonly rawForce: Vec3;
  readonly rawForceNorm: number;
  readonly selective: SelectiveMask;
  readonly freeForce: Vec3 | null;
  readonly freeForceNorm: number | null;
  readonly componentRanks: readonly [DetailRank, DetailRank, DetailRank];
}

export function rankTopTwo<T>(
  values: readonly T[],
  eligible: (value: T) => boolean,
  magnitude: (value: T) => number,
): ReadonlyMap<number, 1 | 2> {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => eligible(value))
    .sort((left, right) => magnitude(right.value) - magnitude(left.value) || left.index - right.index)
    .slice(0, 2);
  return new Map(ordered.map(({ index }, rank) => [index, (rank + 1) as 1 | 2]));
}

export function energyDetailRows(step: IonicStep): readonly RankedEnergyRow[] {
  const ranks = rankTopTwo(
    step.energyTerms,
    (term) => term.kind === "contribution",
    (term) => Math.abs(term.value),
  );
  return step.energyTerms.map((term, index) => ({ ...term, rank: ranks.get(index) ?? null }));
}

interface ForceCandidate {
  readonly row: number;
  readonly component: 0 | 1 | 2;
  readonly value: number;
}

const maskValues = (mask: SelectiveMask): readonly (boolean | null)[] => [mask.a, mask.b, mask.c];

export function forceDetailRows(
  dataset: CalculationDataset,
  step: IonicStep,
): readonly ForceDetailRow[] {
  const candidates: ForceCandidate[] = [];
  dataset.sites.forEach((site, row) => {
    const force = step.freeForces?.[row];
    const mask = maskValues(site.selectiveDynamics);
    if (!force || mask.includes(null)) return;
    force.forEach((value, component) => {
      candidates.push({ row, component: component as 0 | 1 | 2, value });
    });
  });
  const ranks = rankTopTwo(candidates, () => true, ({ value }) => Math.abs(value));
  const rankByComponent = new Map<string, 1 | 2>(
    candidates.flatMap((candidate, index) => {
      const rank = ranks.get(index);
      return rank === undefined ? [] : [[`${candidate.row}:${candidate.component}`, rank] as const];
    }),
  );
  return dataset.sites.map((site, row) => ({
    siteIndex: site.siteIndex,
    siteLabel: `${site.element} ${site.siteIndex + 1}`,
    position: step.cartesianPositions[row]!,
    rawForce: step.rawForces[row]!,
    rawForceNorm: Math.hypot(...step.rawForces[row]!),
    selective: site.selectiveDynamics,
    freeForce: step.freeForces?.[row] ?? null,
    freeForceNorm: step.freeForceNorms?.[row] ?? null,
    componentRanks: [0, 1, 2].map((component) =>
      rankByComponent.get(`${row}:${component}`) ?? null,
    ) as [DetailRank, DetailRank, DetailRank],
  }));
}
