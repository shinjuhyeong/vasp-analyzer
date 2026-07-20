import { describe, expect, it } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { convergenceSeries, forceSeries } from "./analysisSeries.js";

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
});
