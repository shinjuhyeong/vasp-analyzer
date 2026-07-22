import { describe, expect, it } from "vitest";

import {
  buildCrystalFrame,
  buildComparisonScene,
  covalentRadius,
  crystallographicViewVector,
  elementLegend,
  parseIntegerDirection,
  replicateSites,
} from "./scene.js";
import { compareStructures } from "./comparison.js";

const skew = [
  [2, 0, 0],
  [1, 2, 0],
  [0, 0, 3],
] as const;

describe("crystallographic scene", () => {
  const sites = [
    {
      siteIndex: 0,
      element: "Cu",
      fractionalPosition: [0, 0, 0] as const,
      cartesianPosition: [0, 0, 0] as const,
    },
    {
      siteIndex: 1,
      element: "O",
      fractionalPosition: [0.9, 0, 0] as const,
      cartesianPosition: [1.8, 0, 0] as const,
    },
  ];

  it("builds a deduplicated renderer-agnostic Y/Ba/Cu/O legend", () => {
    const legend = elementLegend([
      { element: "Y" }, { element: "Ba" }, { element: "Cu" }, { element: "O" }, { element: "O" },
    ]);
    expect(legend.map(({ element }) => element)).toEqual(["Y", "Ba", "Cu", "O"]);
    expect(legend.every(({ color, radius }) => color.startsWith("#") && radius > 0)).toBe(true);
  });

  it("preserves original identity and records lattice images in supercells", () => {
    expect(
      replicateSites(sites, skew, [2, 1, 1]).map(({ siteIndex, image }) => [
        siteIndex,
        image,
      ]),
    ).toEqual([
      [0, [0, 0, 0]],
      [1, [0, 0, 0]],
      [0, [1, 0, 0]],
      [1, [1, 0, 0]],
    ]);
  });

  it("builds skew unit-cell edges and direct lattice axes", () => {
    const frame = buildCrystalFrame(sites, skew, [1, 1, 1]);
    expect(frame.cellEdges).toHaveLength(12);
    expect(frame.axes.map((axis) => axis.end)).toEqual([
      [2, 0, 0],
      [1, 2, 0],
      [0, 0, 3],
    ]);
  });

  it("creates a minimum-image periodic bond across a cell boundary", () => {
    const frame = buildCrystalFrame(sites, skew, [1, 1, 1]);
    expect(frame.bonds).toContainEqual(
      expect.objectContaining({ fromSiteIndex: 0, toSiteIndex: 1 }),
    );
    const bond = frame.bonds
      .filter(
        (candidate) =>
          candidate.fromSiteIndex === 0 && candidate.toSiteIndex === 1,
      )
      .sort(
        (left, right) =>
          Math.hypot(
            ...left.end.map((value, axis) => value - left.start[axis]!),
          ) -
          Math.hypot(
            ...right.end.map((value, axis) => value - right.start[axis]!),
          ),
      )[0]!;
    expect(
      Math.hypot(...bond.end.map((value, axis) => value - bond.start[axis]!)),
    ).toBeCloseTo(0.2);
  });

  it("retains symmetry-equivalent minimum images at a periodic boundary", () => {
    const cubic = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ] as const;
    const boundary = [
      {
        siteIndex: 0,
        element: "O",
        fractionalPosition: [0, 0, 0] as const,
        cartesianPosition: [0, 0, 0] as const,
      },
      {
        siteIndex: 1,
        element: "O",
        fractionalPosition: [0.5, 0, 0] as const,
        cartesianPosition: [1, 0, 0] as const,
      },
    ];
    const pair = buildCrystalFrame(boundary, cubic, [1, 1, 1]).bonds.filter(
      (bond) => bond.fromSiteIndex === 0 && bond.toSiteIndex === 1,
    );
    expect(pair.map((bond) => bond.toImage)).toEqual(
      expect.arrayContaining([
        [0, 0, 0],
        [-1, 0, 0],
      ]),
    );
  });

  it("materializes and deduplicates boundary ghost atoms for every bond endpoint", () => {
    const frame = buildCrystalFrame(sites, skew, [1, 1, 1]);
    const keys = frame.sites.map(
      (site) => `${site.siteIndex}:${site.image.join(",")}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const bond of frame.bonds) {
      expect(keys).toContain(
        `${bond.fromSiteIndex}:${bond.fromImage.join(",")}`,
      );
      expect(keys).toContain(`${bond.toSiteIndex}:${bond.toImage.join(",")}`);
    }
    expect(
      frame.sites.filter((site) => site.role === "boundary").length,
    ).toBeGreaterThan(0);
    expect(frame.sites.filter((site) => site.role === "primary")).toHaveLength(
      2,
    );
  });

  it("canonicalizes chemically eligible same-site periodic bonds", () => {
    const cubic = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const;
    const frame = buildCrystalFrame([sites[1]!], cubic, [1, 1, 1]);
    expect(frame.bonds.length).toBeGreaterThan(0);
    const imageKeys = frame.bonds.map((bond) => bond.toImage.join(","));
    expect(new Set(imageKeys).size).toBe(imageKeys.length);
    expect(
      frame.bonds.every((bond) => bond.fromSiteIndex === bond.toSiteIndex),
    ).toBe(true);
    expect(
      frame.bonds.every(
        (bond) => bond.toImage.find((value) => value !== 0)! > 0,
      ),
    ).toBe(true);
  });

  it("uses vetted pair radii for YBCO elements and skips unknown elements", () => {
    expect(["Y", "Ba", "Cu", "O"].map(covalentRadius)).toEqual([
      1.9, 2.15, 1.32, 0.66,
    ]);
    expect(covalentRadius("Xx")).toBeNull();
    const unknown = [
      {
        siteIndex: 0,
        element: "Xx",
        fractionalPosition: [0, 0, 0] as const,
        cartesianPosition: [0, 0, 0] as const,
      },
      {
        siteIndex: 1,
        element: "O",
        fractionalPosition: [0.1, 0, 0] as const,
        cartesianPosition: [0.2, 0, 0] as const,
      },
    ];
    expect(buildCrystalFrame(unknown, skew, [1, 1, 1]).bonds).toEqual([]);
  });

  it("interprets [uvw] through direct vectors and (hkl) as a reciprocal normal", () => {
    expect(crystallographicViewVector([0, 1, 0], skew, "direct")).toEqual([
      1, 2, 0,
    ]);
    const normal = crystallographicViewVector([1, 0, 0], skew, "plane-normal");
    expect(normal[0]).toBeCloseTo(0.5);
    expect(normal[1]).toBeCloseTo(-0.25);
    expect(normal[0] * skew[1][0] + normal[1] * skew[1][1]).toBeCloseTo(0);
  });

  it("accepts signed integer triples and rejects zero or non-integer directions", () => {
    expect(parseIntegerDirection("1 -2 3")).toEqual([1, -2, 3]);
    expect(() => parseIntegerDirection("0 0 0")).toThrow(/non-zero/i);
    expect(() => parseIntegerDirection("1 0.5 0")).toThrow(/integers/i);
  });

  it("builds comparison frames but emits displacements only for primary sites", () => {
    const initial = { lattice: skew, fractionalPositions: [[0, 0, 0], [0.9, 0, 0]] as const };
    const target = {
      lattice: [[2.2, 0, 0], [1, 2.1, 0], [0, 0, 3.2]] as const,
      fractionalPositions: [[0.05, 0, 0], [0.85, 0, 0]] as const,
    };
    const comparison = compareStructures(initial, target);
    const targetSites = sites.map((site, index) => ({ ...site, fractionalPosition: target.fractionalPositions[index]! }));
    const result = buildComparisonScene(sites, targetSites, initial.lattice, target.lattice, comparison, [2, 2, 1], 3);

    expect(result.initialFrame.sites.filter(({ role }) => role === "primary")).toHaveLength(8);
    expect(result.targetFrame.sites.filter(({ role }) => role === "primary")).toHaveLength(8);
    expect(result.displacements).toHaveLength(2);
    expect(result.displacements[0]).toMatchObject({ siteIndex: 0, origin: comparison.sites[0]!.initialCartesian, vector: comparison.sites[0]!.displacement });
    expect(result.displacementScale).toBe(3);
    expect(result.cellDeltas.map(({ label, start, end }) => [label, start, end])).toEqual([
      ["a", [0, 0, 0], comparison.cellDeltas[0]],
      ["b", [0, 0, 0], comparison.cellDeltas[1]],
      ["c", [0, 0, 0], comparison.cellDeltas[2]],
    ]);
  });
});
