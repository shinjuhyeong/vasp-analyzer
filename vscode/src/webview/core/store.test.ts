import { describe, expect, it } from "vitest";

import { twoStepDataset } from "../test/fixtures.js";
import { analysisReducer, DEFAULT_CONVERGENCE, initialAnalysisState } from "./store.js";

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
      convergence: DEFAULT_CONVERGENCE,
    });
  });

  it("restores versioned force and layout preferences with a dataset", () => {
    const state = analysisReducer(initialAnalysisState, {
      type: "datasetLoaded",
      dataset: twoStepDataset,
      persisted: {
        version: 4,
        selectedFrame: { kind: "ionic", index: 1 },
        comparisonTarget: 0,
        displacementScale: 25,
        selectedSite: 0,
        forceMode: "raw",
        forceScale: 250,
        layout: { ...defaultLayout, inspectorCollapsed: false, paletteX: 80 },
        convergence: {
          selectedModules: ["force", "energy"],
          metrics: { energy: "deltaEnergy", force: "rmsFreeForce", cellStress: "cellVolume" },
          modes: { energy: "table", force: "graph", cellStress: "table" },
        },
      },
    });

    expect(state).toMatchObject({
      selectedFrame: { kind: "ionic", index: 1 },
      comparisonTarget: 0,
      displacementScale: 25,
      selectedSite: 0,
      forceMode: "raw",
      forceScale: 250,
      layout: { ...defaultLayout, inspectorCollapsed: false, paletteX: 80 },
      convergence: {
        selectedModules: ["energy", "force"],
        metrics: { energy: "deltaEnergy", force: "rmsFreeForce", cellStress: "cellVolume" },
        modes: { energy: "table", force: "graph", cellStress: "table" },
      },
    });
  });

  it("selects Initial only when requested and POSCAR is available", () => {
    const dataset = { ...twoStepDataset, initialStructure: {
      source: "POSCAR" as const,
      lattice: twoStepDataset.ionicSteps[0]!.lattice,
      fractionalPositions: twoStepDataset.ionicSteps[0]!.fractionalPositions,
      cartesianPositions: twoStepDataset.ionicSteps[0]!.cartesianPositions,
    } };
    const selected = analysisReducer(initialAnalysisState, { type: "datasetLoaded", dataset,
      persisted: { version: 4, selectedFrame: { kind: "initial" }, comparisonTarget: 1,
        displacementScale: 10, selectedSite: null, forceMode: "free", forceScale: 10,
        layout: defaultLayout, convergence: DEFAULT_CONVERGENCE } });

    expect(selected.selectedFrame).toEqual({ kind: "initial" });
    expect(analysisReducer(selected, { type: "selectFrame", frame: { kind: "ionic", index: 1 } }).selectedFrame)
      .toEqual({ kind: "ionic", index: 1 });
  });

  it("clamps unavailable Initial and ionic comparison target to the dataset", () => {
    const state = analysisReducer(initialAnalysisState, { type: "datasetLoaded", dataset: twoStepDataset,
      persisted: { version: 4, selectedFrame: { kind: "initial" }, comparisonTarget: 99,
        displacementScale: 10, selectedSite: null, forceMode: "free", forceScale: 10,
        layout: defaultLayout, convergence: DEFAULT_CONVERGENCE } });

    expect(state.selectedFrame).toEqual({ kind: "ionic", index: 0 });
    expect(state.comparisonTarget).toBe(1);
  });

  it("enables Compare only on Initial and disables it when leaving Initial", () => {
    const dataset = { ...twoStepDataset, initialStructure: {
      source: "POSCAR" as const, lattice: twoStepDataset.ionicSteps[0]!.lattice,
      fractionalPositions: twoStepDataset.ionicSteps[0]!.fractionalPositions,
      cartesianPositions: twoStepDataset.ionicSteps[0]!.cartesianPositions } };
    const initial = analysisReducer({ ...initialAnalysisState, dataset }, { type: "selectFrame", frame: { kind: "initial" } });
    const compared = analysisReducer(initial, { type: "setCompareEnabled", enabled: true });
    const ionic = analysisReducer(compared, { type: "selectFrame", frame: { kind: "ionic", index: 0 } });

    expect(compared.compareEnabled).toBe(true);
    expect(ionic.compareEnabled).toBe(false);
  });

  it("clamps displacement scale independently of force scale", () => {
    const current = { ...initialAnalysisState, forceScale: 250 };
    expect(analysisReducer(current, { type: "setDisplacementScale", scale: 0 })).toMatchObject({ displacementScale: 1, forceScale: 250 });
    expect(analysisReducer(current, { type: "setDisplacementScale", scale: 1001 })).toMatchObject({ displacementScale: 1000, forceScale: 250 });
  });

  it.each([
    [[], ["energy"]],
    [["force", "energy", "force", "cellStress"], ["energy", "force", "cellStress"]],
    [["unknown", "force"], ["force"]],
    [["unknown"], ["energy"]],
  ])("normalizes module selection %j", (modules, expected) => {
    const next = analysisReducer(initialAnalysisState, { type: "setModules", modules } as never);
    expect(next.convergence.selectedModules).toEqual(expected);
  });

  it("updates valid metrics and modes while ignoring invalid values", () => {
    const metric = analysisReducer(initialAnalysisState, { type: "setModuleMetric", module: "energy", metric: "deltaEnergy" } as never);
    const invalidMetric = analysisReducer(metric, { type: "setModuleMetric", module: "energy", metric: "cellVolume" } as never);
    const mode = analysisReducer(invalidMetric, { type: "setModuleMode", module: "force", mode: "table" } as never);
    const invalidMode = analysisReducer(mode, { type: "setModuleMode", module: "force", mode: "cards" } as never);
    const unknownModule = analysisReducer(invalidMode, { type: "setModuleMode", module: "unknown", mode: "table" } as never);

    expect(unknownModule.convergence.metrics.energy).toBe("deltaEnergy");
    expect(unknownModule.convergence.modes.force).toBe("table");
    expect(unknownModule.convergence.modes).not.toHaveProperty("unknown");
  });

  it.each([
    [0, 1],
    [1001, 1000],
  ])("clamps force scale %s to %s", (scale, expected) => {
    expect(analysisReducer(initialAnalysisState, { type: "setForceScale", scale }).forceScale).toBe(expected);
  });

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])(
    "retains the safe current force scale for non-finite input %s",
    (scale) => {
      const current = { ...initialAnalysisState, forceScale: 250 };

      const next = analysisReducer(current, { type: "setForceScale", scale });

      expect(next.forceScale).toBe(250);
      expect(Number.isFinite(next.forceScale)).toBe(true);
    },
  );

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
