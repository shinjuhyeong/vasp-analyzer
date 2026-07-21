import type { ReactElement } from "react";

import type { CalculationDataset, CellStressMetric, ModuleMode } from "../../core/contracts.js";
import { metricAxis, metricSeries } from "./analysisSeries.js";
import { SeriesChart } from "./SeriesChart.js";

export interface CellStressModuleProps {
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly metric: CellStressMetric;
  readonly mode: ModuleMode;
  readonly onMetricChange: (metric: CellStressMetric) => void;
  readonly onModeChange: (mode: ModuleMode) => void;
  readonly onSelectStep: (index: number) => void;
}

const labels: Record<CellStressMetric, string> = { externalPressure: "External pressure", cellVolume: "Cell volume" };
const number = (value: number): string => Number.isInteger(value) ? String(value) : String(value);

export function CellStressModule(props: CellStressModuleProps): ReactElement {
  const step = props.dataset.ionicSteps[props.selectedIndex];
  const unavailable = !step || [step.externalPressureKb, step.pulayStressKb, step.cellVolume, step.stressTensorKb].every((value) => value === null);
  return <><header className="convergence-module-header"><h3>Cell &amp; Stress</h3>
    <select aria-label="Cell & Stress metric" value={props.metric} onChange={(event) => props.onMetricChange(event.target.value as CellStressMetric)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <div className="convergence-mode-picker" aria-label="Cell & Stress presentation mode">{(["graph", "table"] as const).map((mode) => <button key={mode} type="button" aria-label={`Cell & Stress ${mode === "graph" ? "Graph" : "Table"} mode`} aria-pressed={props.mode === mode} onClick={() => props.onModeChange(mode)}>{mode === "graph" ? "Graph" : "Table"}</button>)}</div>
  </header>{props.mode === "graph" ?
    <SeriesChart ariaLabel={`${labels[props.metric]} graph`} series={[metricSeries(props.dataset, props.metric)]} xAxis={{ label: "Ionic step" }} yAxis={metricAxis(props.metric)} selectedIndex={props.selectedIndex} onSelect={props.onSelectStep} /> :
    unavailable ? <p className="detail-unavailable" role="status">Cell and stress details unavailable for this ionic step.</p> : step && <div className="cell-stress-details"><p className="sign-convention">Pressure uses the VASP sign convention. 1 kB = 0.1 GPa.</p><dl>
      <dt>External pressure</dt><dd>{step.externalPressureKb === null ? "Unavailable" : <><span>{number(step.externalPressureKb)} kB</span> <span>{number(step.externalPressureKb * 0.1)} GPa</span></>}</dd>
      <dt>Pulay stress</dt><dd>{step.pulayStressKb === null ? "Unavailable" : <><span>{number(step.pulayStressKb)} kB</span> <span>{number(step.pulayStressKb * 0.1)} GPa</span></>}</dd>
      <dt>Cell volume</dt><dd>{step.cellVolume === null ? "Unavailable" : `${number(step.cellVolume)} Å³`}</dd>
    </dl>{step.stressTensorKb === null ? <p>Stress tensor unavailable.</p> : <table className="detail-table stress-tensor" aria-label="Stress tensor in kB"><caption>Stress tensor (kB)</caption><tbody>{step.stressTensorKb.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>)}</tbody></table>}</div>}</>;
}
