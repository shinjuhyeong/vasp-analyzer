import type { ReactElement } from "react";

import type { CalculationDataset, ForceMetric, ModuleMode, SelectiveMask, Vec3 } from "../../core/contracts.js";
import { forceDetailRows, type DetailRank } from "./detailRows.js";
import { metricAxis, metricSeries } from "./analysisSeries.js";
import { SeriesChart } from "./SeriesChart.js";
import { SelectedMetricValue } from "./SelectedMetricValue.js";

export interface ForceModuleProps {
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly metric: ForceMetric;
  readonly mode: ModuleMode;
  readonly onMetricChange: (metric: ForceMetric) => void;
  readonly onModeChange: (mode: ModuleMode) => void;
  readonly onSelectStep: (index: number) => void;
  readonly onSelectSite: (siteIndex: number) => void;
}

const labels: Record<ForceMetric, string> = { strongestFreeComponent: "Strongest free component", rmsFreeForce: "RMS free force" };
const vector = (value: Vec3 | null): string => value ? value.join(", ") : "Unavailable";
const selective = (mask: SelectiveMask): string => [mask.a, mask.b, mask.c].map((value) => value === null ? "?" : value ? "T" : "F").join(" ");
const component = (value: number, rank: DetailRank): ReactElement => <span className={rank ? `detail-rank-cell rank-${rank}` : undefined}>{value}{rank && <span className="detail-rank">Rank {rank}</span>}</span>;

export function ForceModule(props: ForceModuleProps): ReactElement {
  const step = props.dataset.ionicSteps[props.selectedIndex];
  const rows = step ? forceDetailRows(props.dataset, step) : [];
  return <><header className="convergence-module-header"><h3>Force</h3>
    <select aria-label="Force metric" value={props.metric} onChange={(event) => props.onMetricChange(event.target.value as ForceMetric)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <div className="convergence-mode-picker" aria-label="Force presentation mode">{(["graph", "table"] as const).map((mode) => <button key={mode} type="button" aria-label={`Force ${mode === "graph" ? "Graph" : "Table"} mode`} aria-pressed={props.mode === mode} onClick={() => props.onModeChange(mode)}>{mode === "graph" ? "Graph" : "Table"}</button>)}</div>
  </header>{props.mode === "graph" ?
    <><SelectedMetricValue ariaLabel="Force selected metric" dataset={props.dataset} selectedIndex={props.selectedIndex} metric={props.metric} /><SeriesChart ariaLabel={`${labels[props.metric]} graph`} series={[metricSeries(props.dataset, props.metric)]} xAxis={{ label: "Ionic step" }} yAxis={metricAxis(props.metric)} selectedIndex={props.selectedIndex} onSelect={props.onSelectStep} /></> :
    rows.length === 0 ? <p className="detail-unavailable" role="status">Force details unavailable for this ionic step.</p> :
    <div className="detail-table-scroll"><table className="detail-table force-detail-table" aria-label="Atomic positions and forces"><caption>Atomic positions and forces for ionic step {props.selectedIndex + 1} (Å, eV/Å)</caption><thead><tr><th>Atom</th><th>Position x,y,z (Å)</th><th>Raw force x,y,z (eV/Å)</th><th>Raw norm (eV/Å)</th><th>Selective a b c</th><th>Free x</th><th>Free y</th><th>Free z</th><th>Free norm (eV/Å)</th></tr></thead><tbody>{rows.map((row) =>
      <tr key={row.siteIndex} onClick={() => props.onSelectSite(row.siteIndex)}><th scope="row"><button type="button">{row.siteLabel}</button></th><td>{vector(row.position)}</td><td>{vector(row.rawForce)}</td><td>{row.rawForceNorm}</td><td>{selective(row.selective)}</td>{row.freeForce ? <>{row.freeForce.map((value, axis) => <td key={axis}>{component(value, row.componentRanks[axis]!)}</td>)}</> : <td colSpan={3}>Unavailable</td>}<td>{row.freeForceNorm ?? "Unavailable"}</td></tr>)}</tbody></table></div>}</>;
}
