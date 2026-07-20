import type { ReactElement } from "react";

import type { CalculationDataset, IonicStep } from "../../core/contracts.js";
import { convergenceSeries } from "./analysisSeries.js";
import { SeriesChart } from "./SeriesChart.js";

export interface ConvergencePanelProps {
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly onSelectStep: (arrayIndex: number) => void;
}

const metric = (value: number | null, unit: string): string =>
  value === null ? "Unavailable" : `${value.toFixed(6)} ${unit}`;

const convergence = (name: string, value: boolean | null): string =>
  `${name}: ${value === null ? "unavailable" : value ? "converged" : "not converged"}`;

function ExactStep({
  step,
  displayedStep,
}: {
  readonly step: IonicStep;
  readonly displayedStep: number;
}): ReactElement {
  const strongest = step.strongestFreeComponent;
  return (
    <section
      className="step-details"
      aria-label={`Ionic step ${displayedStep} exact values`}
    >
      <h3>Step {displayedStep}</h3>
      <dl>
        <div>
          <dt>Total energy</dt>
          <dd>{metric(step.totalEnergy, "eV")}</dd>
        </div>
        <div>
          <dt>Energy change</dt>
          <dd>{metric(step.deltaEnergy, "eV")}</dd>
        </div>
        <div>
          <dt>Strongest free component</dt>
          <dd>
            {strongest
              ? `${strongest.magnitude.toFixed(6)} eV/angstrom · site ${strongest.siteIndex + 1} ${strongest.axis.toUpperCase()}`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>RMS free force</dt>
          <dd>{metric(step.rmsFreeForce, "eV/angstrom")}</dd>
        </div>
        <div>
          <dt>SCF iterations</dt>
          <dd>
            {step.scfIterations === null
              ? "Unavailable"
              : `${step.scfIterations} iterations`}
          </dd>
        </div>
      </dl>
      <div className="convergence-flags">
        <span data-state={step.electronicConverged}>
          {convergence("Electronic", step.electronicConverged)}
        </span>
        <span data-state={step.ionicConverged}>
          {convergence("Ionic", step.ionicConverged)}
        </span>
      </div>
    </section>
  );
}

export function ConvergencePanel({
  dataset,
  selectedIndex,
  onSelectStep,
}: ConvergencePanelProps): ReactElement {
  const allSeries = convergenceSeries(dataset);
  const selected = dataset.ionicSteps[selectedIndex];
  if (!selected)
    return <p className="chart-unavailable">No ionic steps available</p>;
  return (
    <div className="convergence-panel">
      <div className="convergence-plots">
        <SeriesChart
          ariaLabel="Energy convergence"
          series={allSeries.slice(0, 2)}
          selectedIndex={selectedIndex}
          onSelect={onSelectStep}
        />
        <SeriesChart
          ariaLabel="Force convergence"
          series={allSeries.slice(2)}
          selectedIndex={selectedIndex}
          onSelect={onSelectStep}
        />
      </div>
      <ExactStep step={selected} displayedStep={selectedIndex + 1} />
    </div>
  );
}
