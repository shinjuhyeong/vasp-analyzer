import type { CalculationDataset } from "../../core/contracts.js";
import type { ChartPoint, ChartSeries } from "./SeriesChart.js";

export interface PlotPoint extends ChartPoint {
  readonly stepId: number;
  readonly selectionIndex: number;
  readonly displayLabel: string;
}

export interface PlotSeries extends ChartSeries {
  readonly points: readonly PlotPoint[];
}

const points = (
  dataset: CalculationDataset,
  select: (step: CalculationDataset["ionicSteps"][number]) => number | null,
  label: string,
  spokenUnit: string,
): readonly PlotPoint[] =>
  dataset.ionicSteps.map((step, selectionIndex) => {
    const y = select(step);
    const displayLabel = String(step.index + 1);
    return Object.freeze({
      id: `${label}-${step.index}-${selectionIndex}`,
      x: step.index,
      y,
      stepId: step.index,
      selectionIndex,
      displayLabel,
      ariaLabel: `${label} at ionic step ${displayLabel}: ${y === null ? "unavailable" : `${y} ${spokenUnit}`}`,
    });
  });

export const forceSeries = (
  dataset: CalculationDataset,
): readonly PlotPoint[] =>
  points(
    dataset,
    (step) => step.strongestFreeComponent?.magnitude ?? null,
    "Force",
    "eV per angstrom",
  );

export const convergenceSeries = (
  dataset: CalculationDataset,
): readonly PlotSeries[] =>
  Object.freeze([
    Object.freeze({
      id: "total-energy",
      label: "Total energy",
      points: points(
        dataset,
        (step) => step.totalEnergy,
        "Total energy",
        "eV",
      ),
    }),
    Object.freeze({
      id: "delta-energy",
      label: "Energy change",
      points: points(
        dataset,
        (step) => step.deltaEnergy,
        "Energy change",
        "eV",
      ),
    }),
    Object.freeze({
      id: "strongest-force",
      label: "Strongest free component",
      points: forceSeries(dataset),
    }),
    Object.freeze({
      id: "rms-force",
      label: "RMS free force",
      points: points(
        dataset,
        (step) => step.rmsFreeForce,
        "RMS force",
        "eV per angstrom",
      ),
    }),
  ]);
