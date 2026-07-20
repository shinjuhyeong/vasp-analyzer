import type { CalculationDataset } from "../../core/contracts.js";

export interface PlotPoint {
  readonly arrayIndex: number;
  readonly displayedStep: number;
  readonly value: number | null;
  readonly ariaLabel: string;
}

export interface PlotSeries {
  /** Stable backend-agnostic key; future DOS/band series use the same contract. */
  readonly id: string;
  readonly label: string;
  readonly unit: "eV" | "eV/angstrom";
  readonly points: readonly PlotPoint[];
}

const points = (
  dataset: CalculationDataset,
  select: (step: CalculationDataset["ionicSteps"][number]) => number | null,
  label: string,
  spokenUnit: string,
): readonly PlotPoint[] =>
  dataset.ionicSteps.map((step, arrayIndex) => {
    const value = select(step);
    return Object.freeze({
      arrayIndex,
      displayedStep: arrayIndex + 1,
      value,
      ariaLabel: `${label} at ionic step ${arrayIndex + 1}: ${value === null ? "unavailable" : `${value} ${spokenUnit}`}`,
    });
  });

export const forceSeries = (dataset: CalculationDataset): readonly PlotPoint[] =>
  points(dataset, (step) => step.strongestFreeComponent?.magnitude ?? null, "Force", "eV per angstrom");

export const convergenceSeries = (dataset: CalculationDataset): readonly PlotSeries[] =>
  Object.freeze([
    Object.freeze({
      id: "total-energy" as const,
      label: "Total energy",
      unit: "eV" as const,
      points: points(dataset, (step) => step.totalEnergy, "Total energy", "eV"),
    }),
    Object.freeze({
      id: "delta-energy" as const,
      label: "Energy change",
      unit: "eV" as const,
      points: points(dataset, (step) => step.deltaEnergy, "Energy change", "eV"),
    }),
    Object.freeze({
      id: "strongest-force" as const,
      label: "Strongest free component",
      unit: "eV/angstrom" as const,
      points: forceSeries(dataset),
    }),
    Object.freeze({
      id: "rms-force" as const,
      label: "RMS free force",
      unit: "eV/angstrom" as const,
      points: points(dataset, (step) => step.rmsFreeForce, "RMS force", "eV per angstrom"),
    }),
  ]);
