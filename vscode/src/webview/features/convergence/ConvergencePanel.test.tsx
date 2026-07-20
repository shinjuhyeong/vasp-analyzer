// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { ConvergencePanel } from "./ConvergencePanel.js";

it("selecting a force point dispatches its array index and updates exact values", async () => {
  const select = vi.fn();
  const { rerender } = render(<ConvergencePanel dataset={twoStepDataset} selectedIndex={0} onSelectStep={select} />);
  await userEvent.setup().click(screen.getByLabelText("Force at ionic step 2: 0.1 eV per angstrom"));
  expect(select).toHaveBeenCalledWith(1);
  rerender(<ConvergencePanel dataset={twoStepDataset} selectedIndex={1} onSelectStep={select} />);
  expect(screen.getByText("-11.000000 eV")).toBeVisible();
  expect(screen.getByText("8 iterations")).toBeVisible();
  expect(screen.getByText("Ionic: converged")).toBeVisible();
});

it("labels unavailable values without inventing zeroes", () => {
  const dataset = {
    ...twoStepDataset,
    ionicSteps: [{
      ...twoStepDataset.ionicSteps[0]!, totalEnergy: null, deltaEnergy: null,
      strongestFreeComponent: null, rmsFreeForce: null, scfIterations: null,
      electronicConverged: null, ionicConverged: null,
    }],
  };
  render(<ConvergencePanel dataset={dataset} selectedIndex={0} onSelectStep={() => undefined} />);
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(4);
  expect(screen.getByText("Electronic: unavailable")).toBeVisible();
});
