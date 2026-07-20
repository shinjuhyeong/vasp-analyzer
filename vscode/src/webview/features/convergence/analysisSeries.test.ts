import { describe, expect, it } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { convergenceSeries, forceSeries } from "./analysisSeries.js";

describe("convergence series", () => {
  it("uses displayed positions while preserving array indices for selection", () => {
    const dataset = {
      ...twoStepDataset,
      ionicSteps: twoStepDataset.ionicSteps.map((step, position) => ({
        ...step,
        index: position === 0 ? 10 : 20,
      })),
    };
    expect(forceSeries(dataset)[1]).toMatchObject({
      arrayIndex: 1,
      displayedStep: 2,
      ariaLabel: expect.stringContaining("ionic step 2"),
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
    expect(forceSeries(dataset)[0]!.value).toBeNull();
    expect(convergenceSeries(dataset).find((series) => series.id === "rms-force")!.points[0]!.value).toBeNull();
  });
});
