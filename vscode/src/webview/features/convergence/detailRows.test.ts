import { describe, expect, it } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { energyDetailRows, forceDetailRows } from "./detailRows.js";

describe("energyDetailRows", () => {
  it("ranks the two greatest absolute contributions and excludes aggregates", () => {
    const rows = energyDetailRows({
      ...twoStepDataset.ionicSteps[0]!,
      energyTerms: [
        { key: "toten", rawLabel: "TOTEN", value: -500, unit: "eV", kind: "aggregate" },
        { key: "ewald", rawLabel: "Ewald", value: -120, unit: "eV", kind: "contribution" },
        { key: "xc", rawLabel: "XC", value: 40, unit: "eV", kind: "contribution" },
        { key: "entropy_ts", rawLabel: "-TS", value: -60, unit: "eV", kind: "contribution" },
      ],
    });
    expect(rows.map(({ key, rank }) => [key, rank])).toEqual([
      ["toten", null], ["ewald", 1], ["xc", null], ["entropy_ts", 2],
    ]);
  });

  it("breaks equal-magnitude ties by source order", () => {
    const rows = energyDetailRows({
      ...twoStepDataset.ionicSteps[0]!,
      energyTerms: [
        { key: "first", rawLabel: "First", value: -4, unit: "eV", kind: "contribution" },
        { key: "second", rawLabel: "Second", value: 4, unit: "eV", kind: "contribution" },
        { key: "third", rawLabel: "Third", value: -4, unit: "eV", kind: "contribution" },
      ],
    });
    expect(rows.map(({ rank }) => rank)).toEqual([1, 2, null]);
  });
});

describe("forceDetailRows", () => {
  it("returns every position/raw/free/norm field and ranks eligible free components", () => {
    const dataset = {
      ...twoStepDataset,
      sites: twoStepDataset.sites.map((site, index) => index === 1
        ? { ...site, selectiveDynamics: { a: true, b: false, c: true } }
        : site),
    };
    const step = {
      ...dataset.ionicSteps[0]!,
      freeForces: [[0.5, 0.4, 0.3], [0.2, 99, -0.6]] as const,
      freeForceNorms: [Math.sqrt(0.5), Math.sqrt(0.4)] as const,
    };
    const rows = forceDetailRows(dataset, step);
    expect(rows[1]).toMatchObject({
      siteIndex: 1, siteLabel: "O 2", position: [1.5, 1.5, 1.5],
      rawForce: [0, -0.2, 0], selective: { a: true, b: false, c: true },
      freeForce: [0.2, 99, -0.6], freeForceNorm: Math.sqrt(0.4),
      componentRanks: [null, null, 1],
    });
    expect(rows[0]?.componentRanks).toEqual([2, null, null]);
  });

  it("does not rank any component when selective dynamics are unknown", () => {
    const dataset = {
      ...twoStepDataset,
      sites: twoStepDataset.sites.map((site, index) => index === 0
        ? { ...site, selectiveDynamics: { a: null, b: true, c: true } }
        : site),
    };
    const rows = forceDetailRows(dataset, dataset.ionicSteps[0]!);
    expect(rows[0]?.componentRanks).toEqual([null, null, null]);
  });
});
