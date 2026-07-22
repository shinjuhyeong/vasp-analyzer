// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { twoStepDataset } from "../../test/fixtures.js";
import { compareStructures } from "./comparison.js";
import { ComparisonInspector } from "./ComparisonInspector.js";

it("shows per-site displacement, drift, ranking, multiplier, and cell summaries", () => {
  const target = twoStepDataset.ionicSteps[0]!;
  const initial = { source: "POSCAR" as const, lattice: target.lattice,
    fractionalPositions: target.fractionalPositions, cartesianPositions: target.cartesianPositions };
  const comparison = compareStructures(initial, target);
  render(<ComparisonInspector site={twoStepDataset.sites[0]!} sitePosition={0} initial={initial}
    target={target} comparison={comparison} multiplier={25} />);
  for (const text of ["Initial fractional", "Target fractional", "Initial Cartesian", "Aligned target Cartesian",
    "Raw displacement", "Display displacement", "Removed drift", "Periodic image shift", "Displacement rank",
    "Displacement arrow multiplier 25×", "Maximum displacement", "Mean displacement", "Cell vector changes",
    "Cell length changes", "Cell angle changes", "Cell volume change"])
    expect(screen.getByText(new RegExp(text))).toBeVisible();
  expect(screen.getByText(/Delta a vector \[/)).toBeVisible();
  expect(screen.getByText(/Delta b vector \[/)).toBeVisible();
  expect(screen.getByText(/Delta c vector \[/)).toBeVisible();
});
