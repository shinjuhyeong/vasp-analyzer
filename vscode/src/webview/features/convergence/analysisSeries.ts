import type { CalculationDataset, CellStressMetric, EnergyMetric, ForceMetric } from "../../core/contracts.js";
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

const metricDefinitions = {
  totalEnergy: { id: "total-energy", label: "Total energy", unit: "eV", select: (step: CalculationDataset["ionicSteps"][number]) => step.totalEnergy },
  deltaEnergy: { id: "delta-energy", label: "Energy change", unit: "eV", select: (step: CalculationDataset["ionicSteps"][number]) => step.deltaEnergy },
  strongestFreeComponent: { id: "strongest-force", label: "Strongest free component", unit: "eV/Å", select: (step: CalculationDataset["ionicSteps"][number]) => step.strongestFreeComponent?.magnitude ?? null },
  rmsFreeForce: { id: "rms-force", label: "RMS free force", unit: "eV/Å", select: (step: CalculationDataset["ionicSteps"][number]) => step.rmsFreeForce },
  externalPressure: { id: "external-pressure", label: "External pressure", unit: "kB", select: (step: CalculationDataset["ionicSteps"][number]) => step.externalPressureKb },
  cellVolume: { id: "cell-volume", label: "Cell volume", unit: "Å³", select: (step: CalculationDataset["ionicSteps"][number]) => step.cellVolume },
} as const;

export function metricSeries(
  dataset: CalculationDataset,
  metric: EnergyMetric | ForceMetric | CellStressMetric,
): PlotSeries {
  const definition = metricDefinitions[metric];
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    points: points(dataset, definition.select, definition.label, definition.unit),
  });
}

export const metricAxis = (metric: EnergyMetric | ForceMetric | CellStressMetric) => {
  const { label, unit } = metricDefinitions[metric];
  return Object.freeze({ label, unit });
};

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
