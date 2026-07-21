import type { ReactElement } from "react";

import type { CalculationDataset, EnergyMetric, ModuleMode } from "../../core/contracts.js";
import { energyDetailRows } from "./detailRows.js";
import { metricAxis, metricSeries } from "./analysisSeries.js";
import { SeriesChart } from "./SeriesChart.js";
import { SelectedMetricValue } from "./SelectedMetricValue.js";

export interface EnergyModuleProps {
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly metric: EnergyMetric;
  readonly mode: ModuleMode;
  readonly onMetricChange: (metric: EnergyMetric) => void;
  readonly onModeChange: (mode: ModuleMode) => void;
  readonly onSelectStep: (index: number) => void;
}

const labels: Record<EnergyMetric, string> = { totalEnergy: "Total energy", deltaEnergy: "Energy change" };

function Controls(props: EnergyModuleProps): ReactElement {
  return <header className="convergence-module-header"><h3>Energy</h3>
    <select aria-label="Energy metric" value={props.metric} onChange={(event) => props.onMetricChange(event.target.value as EnergyMetric)}>
      {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <div className="convergence-mode-picker" aria-label="Energy presentation mode">{(["graph", "table"] as const).map((mode) =>
      <button key={mode} type="button" aria-label={`Energy ${mode === "graph" ? "Graph" : "Table"} mode`} aria-pressed={props.mode === mode} onClick={() => props.onModeChange(mode)}>{mode === "graph" ? "Graph" : "Table"}</button>)}</div>
  </header>;
}

export function EnergyModule(props: EnergyModuleProps): ReactElement {
  const step = props.dataset.ionicSteps[props.selectedIndex];
  const rows = step ? energyDetailRows(step) : [];
  return <><Controls {...props} />{props.mode === "graph" ?
    <><SelectedMetricValue ariaLabel="Energy selected metric" dataset={props.dataset} selectedIndex={props.selectedIndex} metric={props.metric} /><SeriesChart ariaLabel={`${labels[props.metric]} graph`} series={[metricSeries(props.dataset, props.metric)]} xAxis={{ label: "Ionic step" }} yAxis={metricAxis(props.metric)} selectedIndex={props.selectedIndex} onSelect={props.onSelectStep} /></> :
    rows.length === 0 ? <p className="detail-unavailable" role="status">Energy breakdown unavailable for this ionic step.</p> :
    <div className="detail-table-scroll"><table className="detail-table" aria-label="Energy terms"><thead><tr><th>Key</th><th>OUTCAR label</th><th>Kind</th><th>Value</th><th>Rank</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={`${row.key}:${index}`} className={row.kind === "aggregate" ? "energy-term-aggregate" : undefined} data-kind={row.kind} data-rank={row.rank ?? undefined}><th scope="row">{row.key}</th><td>{row.rawLabel}</td><td>{row.kind}</td><td>{row.value} {row.unit}</td><td>{row.rank ? <span className={`detail-rank rank-${row.rank}`}>Rank {row.rank}</span> : "—"}</td></tr>)}
    </tbody></table></div>}</>;
}
