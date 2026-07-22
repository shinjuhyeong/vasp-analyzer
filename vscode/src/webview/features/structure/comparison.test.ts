import { describe, expect, it } from "vitest";

import type { Mat3, Vec3 } from "../../core/contracts.js";
import { compareStructures } from "./comparison.js";

const cubic: Mat3 = [[10, 0, 0], [0, 10, 0], [0, 0, 10]];
const structure = (lattice: Mat3, fractionalPositions: readonly Vec3[]) => ({ lattice, fractionalPositions });

describe("compareStructures", () => {
  it("maps an orthogonal boundary crossing to its nearest periodic image", () => {
    const result = compareStructures(
      structure(cubic, [[0.95, 0, 0]]),
      structure(cubic, [[0.05, 0, 0]]),
    );

    expect(result.sites[0]).toMatchObject({ imageShift: [1, 0, 0], rawDisplacement: [1, 0, 0] });
  });

  it("searches skew-cell images and breaks equal-distance shifts lexicographically", () => {
    const skew: Mat3 = [[1, 0, 0], [0.9, 0.1, 0], [0, 0, 1]];
    const nearest = compareStructures(
      structure(skew, [[0.49, 0.49, 0]]),
      structure(skew, [[0, 0, 0]]),
    );
    expect(nearest.sites[0]!.imageShift).toEqual([0, 1, 0]);

    const tie = compareStructures(
      structure(cubic, [[0.5, 0, 0]]),
      structure(cubic, [[0, 0, 0]]),
    );
    expect(tie.sites[0]!.imageShift).toEqual([0, 0, 0]);
  });

  it("finds the exact closest image beyond a fixed neighborhood in an adversarial skew cell", () => {
    const adversarial: Mat3 = [[1, 0, 0], [100, 0.01, 0], [0, 0, 1]];
    const result = compareStructures(
      structure(adversarial, [[0.49, 0.49, 0]]),
      structure(adversarial, [[0, 0, 0]]),
    );
    expect(result.sites[0]!.imageShift).toEqual([49, 0, 0]);

    const changedCell = compareStructures(
      structure([[101, 0, 0], [0, 0.01, 0], [0, 0, 1]], [[0.49, 0.49, 0]]),
      structure(adversarial, [[0, 0, 0]]),
    );
    expect(changedCell.sites[0]!.imageShift).toEqual([49, 0, 0]);
  });

  it("removes arithmetic-mean drift and makes displayed endpoints equal aligned targets", () => {
    const result = compareStructures(
      structure(cubic, [[0, 0, 0], [0.4, 0, 0], [0.8, 0, 0]]),
      structure(cubic, [[0.1, 0, 0], [0.7, 0, 0], [0.6, 0, 0]]),
    );

    expect(result.removedDrift[0]).toBeCloseTo(2 / 3);
    expect(result.sites.reduce((sum, site) => sum + site.displacement[0], 0)).toBeCloseTo(0);
    for (const site of result.sites) {
      expect(site.initialCartesian.map((value, axis) => value + site.displacement[axis]!))
        .toEqual(site.alignedTargetCartesian);
    }
  });

  it("ranks norms descending and ties by ascending site index", () => {
    const result = compareStructures(
      structure(cubic, [[0, 0, 0], [0.3, 0, 0], [0.6, 0, 0]]),
      structure(cubic, [[0.1, 0, 0], [0.3, 0, 0], [0.5, 0, 0]]),
    );
    expect(result.sites.map(({ siteIndex, rank }) => [siteIndex, rank])).toEqual([[0, 1], [1, 3], [2, 2]]);
  });

  it("reports cell vector, length, angle, and volume changes without drift", () => {
    const initial: Mat3 = [[2, 0, 0], [0, 3, 0], [0, 0, 4]];
    const target: Mat3 = [[3, 0, 0], [1, 3, 0], [0, 0, 5]];
    const result = compareStructures(structure(initial, [[0, 0, 0]]), structure(target, [[0, 0, 0]]));

    expect(result.cellDeltas).toEqual([[1, 0, 0], [1, 0, 0], [0, 0, 1]]);
    expect(result.summary.lengthChanges[0]).toBeCloseTo(1);
    expect(result.summary.lengthChanges[1]).toBeCloseTo(Math.sqrt(10) - 3);
    expect(result.summary.lengthChanges[2]).toBeCloseTo(1);
    expect(result.summary.angleChanges[0]).toBeCloseTo(0);
    expect(result.summary.angleChanges[1]).toBeCloseTo(0);
    expect(result.summary.angleChanges[2]).toBeCloseTo(-Math.atan(1 / 3) * 180 / Math.PI);
    expect(result.summary.volumeChange).toBeCloseTo(21);
    expect(result.summary.relativeVolumeChange).toBeCloseTo(21 / 24);
  });

  it("rejects count mismatches, non-finite values, and singular lattices", () => {
    expect(() => compareStructures(structure(cubic, []), structure(cubic, [[0, 0, 0]]))).toThrow(/site count/i);
    expect(() => compareStructures(structure(cubic, [[Number.NaN, 0, 0]]), structure(cubic, [[0, 0, 0]]))).toThrow(/finite/i);
    expect(() => compareStructures(structure([[1, 0, 0], [2, 0, 0], [0, 0, 1]], [[0, 0, 0]]), structure(cubic, [[0, 0, 0]]))).toThrow(/singular/i);
  });

  it("accepts tiny well-conditioned cells and rejects non-finite derived arithmetic", () => {
    const tiny: Mat3 = [[1e-20, 0, 0], [0, 1e-20, 0], [0, 0, 1e-20]];
    expect(compareStructures(structure(tiny, [[0, 0, 0]]), structure(tiny, [[0, 0, 0]])).sites).toHaveLength(1);

    const huge: Mat3 = [[1e308, 0, 0], [0, 1e308, 0], [0, 0, 1e308]];
    expect(() => compareStructures(structure(huge, [[2, 0, 0]]), structure(huge, [[0, 0, 0]]))).toThrow(/finite|overflow/i);
  });
});
