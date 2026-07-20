// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { DataTableFallback } from "./DataTableFallback.js";

it("shows positions, raw/free forces, and exact directional constraint states", () => {
  render(<DataTableFallback sites={twoStepDataset.sites} step={twoStepDataset.ionicSteps[0]!} reason="WebGL unavailable" />);
  expect(screen.getByRole("table", { name: "Atomic positions and forces" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "T F T" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "0.500000 0.500000 0.500000" })).toBeVisible();
  expect(screen.getByText(/WebGL unavailable/)).toBeVisible();
});

it("replaces rows for the selected step and preserves unknown free data", () => {
  const sites = twoStepDataset.sites.map((site, index) => index === 0
    ? { ...site, selectiveDynamics: { a: null, b: true, c: false } }
    : site);
  const { rerender } = render(<DataTableFallback sites={sites} step={twoStepDataset.ionicSteps[0]!} reason="failed" />);
  const changed = {
    ...twoStepDataset.ionicSteps[1]!,
    fractionalPositions: [[0.25, 0, 0], [0.5, 0.5, 0.5]] as const,
    cartesianPositions: [[0.75, 0, 0], [1.5, 1.5, 1.5]] as const,
    freeForces: null,
  };
  rerender(<DataTableFallback sites={sites} step={changed} reason="failed" />);
  expect(screen.getByRole("cell", { name: "0.250000 0.000000 0.000000" })).toBeVisible();
  expect(screen.getAllByRole("cell", { name: "Unavailable" })).toHaveLength(2);
  expect(screen.getByRole("cell", { name: "? T F" })).toBeVisible();
});
