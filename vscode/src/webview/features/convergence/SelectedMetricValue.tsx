import type { ReactElement } from "react";

import type {
  CalculationDataset,
  CellStressMetric,
  EnergyMetric,
  ForceMetric,
} from "../../core/contracts.js";
import { metricAxis, metricSeries } from "./analysisSeries.js";

export interface SelectedMetricValueProps {
  readonly ariaLabel: string;
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly metric: EnergyMetric | ForceMetric | CellStressMetric;
}

export function SelectedMetricValue({
  ariaLabel,
  dataset,
  selectedIndex,
  metric,
}: SelectedMetricValueProps): ReactElement {
  const step = dataset.ionicSteps[selectedIndex];
  const value = metricSeries(dataset, metric).points[selectedIndex]?.y ?? null;
  const unit = metricAxis(metric).unit;
  return (
    <p className="selected-metric-value" role="status" aria-label={ariaLabel}>
      Ionic step {step ? step.index + 1 : selectedIndex + 1}: {value === null ? "Unavailable" : `${value} ${unit}`}
    </p>
  );
}
