import { describe, expect, it } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { convergenceSeries, forceSeries, metricAxis, metricSeries } from "./analysisSeries.js";

describe("convergence series", () => {
  it("uses parser step IDs for labels while preserving array indices for selection", () => {
    const dataset = {
      ...twoStepDataset,
      ionicSteps: twoStepDataset.ionicSteps.map((step, position) => ({
        ...step,
        index: position === 0 ? 10 : 20,
      })),
    };
    expect(forceSeries(dataset)[1]).toMatchObject({
      stepId: 20,
      selectionIndex: 1,
      displayLabel: "21",
      x: 20,
      ariaLabel: expect.stringContaining("ionic step 21"),
    });
  });

  it("keeps missing constraint-aware metrics as real chart gaps", () => {
    const dataset = {
      ...twoStepDataset,
      ionicSteps: [
        {
          ...twoStepDataset.ionicSteps[0]!,
          strongestFreeComponent: null,
          rmsFreeForce: null,
        },
      ],
    };
    expect(forceSeries(dataset)[0]!.y).toBeNull();
    expect(convergenceSeries(dataset).find((series) => series.id === "rms-force")!.points[0]!.y).toBeNull();
  });

  it("builds one metric-specific pressure series without filling missing values", () => {
    const series = metricSeries(twoStepDataset, "externalPressure");
    expect(series.label).toBe("External pressure");
    expect(series.points.map(({ y }) => y)).toEqual([null, null]);
    expect(metricAxis("externalPressure")).toEqual({ label: "External pressure", unit: "kB" });
  });

  it("publishes exact axes for energy, force, and volume metrics", () => {
    expect(metricAxis("totalEnergy")).toEqual({ label: "Total energy", unit: "eV" });
    expect(metricAxis("strongestFreeComponent")).toEqual({ label: "Strongest free component", unit: "eV/Å" });
    expect(metricAxis("cellVolume")).toEqual({ label: "Cell volume", unit: "Å³" });
  });
});
