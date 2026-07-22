import type { InitialStructure, IonicStep, Site } from "../../core/contracts.js";
import type { StructureComparison } from "./comparison.js";

const vector = (values: readonly number[]): string => `[${values.map((value) => value.toFixed(6)).join(", ")}]`;
const magnitude = (values: readonly number[]): string => Math.hypot(...values).toFixed(6);

export function ComparisonInspector({ site, sitePosition, initial, target, comparison, multiplier }: {
  readonly site: Site; readonly sitePosition: number; readonly initial: InitialStructure;
  readonly target: IonicStep; readonly comparison: StructureComparison; readonly multiplier: number;
}) {
  const detail = comparison.sites[sitePosition];
  if (!detail) return <aside role="status">Comparison data unavailable for this site</aside>;
  const summary = comparison.summary;
  return <aside className="atom-detail comparison-inspector" aria-label="Selected atom comparison details">
    <header><strong>{site.element} {site.siteIndex + 1}</strong><span>siteIndex {site.siteIndex}</span></header>
    <p>Initial fractional {vector(initial.fractionalPositions[sitePosition]!)}</p>
    <p>Target fractional {vector(target.fractionalPositions[sitePosition]!)}</p>
    <p>Initial Cartesian {vector(detail.initialCartesian)} Å</p>
    <p>Aligned target Cartesian {vector(detail.alignedTargetCartesian)} Å</p>
    <p>Raw displacement {vector(detail.rawDisplacement)} Å; |raw| = {magnitude(detail.rawDisplacement)} Å</p>
    <p>Display displacement {vector(detail.displacement)} Å; |d| = {magnitude(detail.displacement)} Å</p>
    <p>Removed drift {vector(comparison.removedDrift)} Å; |t| = {magnitude(comparison.removedDrift)} Å</p>
    <p>Periodic image shift {vector(detail.imageShift)}</p><p>Displacement rank {detail.rank}</p>
    <p>Displacement arrow multiplier {multiplier}×</p>
    <h3>Comparison summary</h3>
    <p>Maximum displacement {summary.largestDisplacement.toFixed(6)} Å</p><p>Mean displacement {summary.meanDisplacement.toFixed(6)} Å</p>
    <p>Cell vector changes {vector(summary.cellDeltaMagnitudes)} Å</p><p>Cell length changes {vector(summary.lengthChanges)} Å</p>
    <p>Cell angle changes {vector(summary.angleChanges)} degrees</p><p>Cell volume change {summary.volumeChange.toFixed(6)} Å³ ({(summary.relativeVolumeChange * 100).toFixed(6)}%)</p>
  </aside>;
}
