import { describe, expect, it } from "vitest";

import { twoStepDataset } from "../test/fixtures.js";
import { analysisReducer, initialAnalysisState } from "./store.js";

const defaultLayout = {
  structurePercent: 60,
  inspectorWidth: 280,
  inspectorCollapsed: true,
  paletteX: 10,
  paletteY: 10,
  paletteCollapsed: true,
};

describe("analysis preferences", () => {
  it("starts with viewer-safe force and layout defaults", () => {
    expect(initialAnalysisState).toMatchObject({
      forceMode: "free",
      forceScale: 10,
      layout: defaultLayout,
    });
  });

  it("restores versioned force and layout preferences with a dataset", () => {
    const state = analysisReducer(initialAnalysisState, {
      type: "datasetLoaded",
      dataset: twoStepDataset,
      persisted: {
        version: 2,
        selectedStep: 1,
        selectedSite: 0,
        forceMode: "raw",
        forceScale: 250,
        layout: { ...defaultLayout, inspectorCollapsed: false, paletteX: 80 },
      },
    });

    expect(state).toMatchObject({
      selectedStep: 1,
      selectedSite: 0,
      forceMode: "raw",
      forceScale: 250,
      layout: { ...defaultLayout, inspectorCollapsed: false, paletteX: 80 },
    });
  });

  it.each([
    [0, 1],
    [1001, 1000],
  ])("clamps force scale %s to %s", (scale, expected) => {
    expect(analysisReducer(initialAnalysisState, { type: "setForceScale", scale }).forceScale).toBe(expected);
  });

  it("normalizes partial layout updates without changing unrelated preferences", () => {
    const state = analysisReducer(initialAnalysisState, {
      type: "setLayout",
      layout: {
        structurePercent: 100,
        inspectorWidth: 1,
        paletteX: -2,
        paletteY: Number.POSITIVE_INFINITY,
        paletteCollapsed: false,
      },
    });

    expect(state.layout).toEqual({
      ...defaultLayout,
      structurePercent: 95,
      inspectorWidth: 220,
      paletteX: 0,
      paletteY: 10,
      paletteCollapsed: false,
    });
  });

  it("resets all layout preferences to defaults", () => {
    const changed = analysisReducer(initialAnalysisState, {
      type: "setLayout",
      layout: { structurePercent: 30, inspectorCollapsed: false, paletteX: 80 },
    });

    expect(analysisReducer(changed, { type: "resetLayout" }).layout).toEqual(defaultLayout);
  });
});
