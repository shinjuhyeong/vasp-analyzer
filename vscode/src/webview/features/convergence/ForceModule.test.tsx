// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { ForceModule } from "./ForceModule.js";

it("shows complete atom force data, ranks components, and selects a zero-based site", async () => {
  const select = vi.fn();
  const dataset = {
    ...twoStepDataset,
    ionicSteps: [{
      ...twoStepDataset.ionicSteps[0]!,
      freeForces: [[0.3, 0.2, 0.1], [0.4, 0, 0]] as const,
      freeForceNorms: [0.374, 0.4] as const,
    }, twoStepDataset.ionicSteps[1]!],
  };
  render(<ForceModule dataset={dataset} selectedIndex={0} metric="strongestFreeComponent" mode="table" onMetricChange={vi.fn()} onModeChange={vi.fn()} onSelectStep={vi.fn()} onSelectSite={select} />);
  const row = screen.getByRole("row", { name: /O 2/ });
  expect(row).toHaveTextContent("1.5, 1.5, 1.5");
  expect(row).toHaveTextContent("0, -0.2, 0");
  expect(row).toHaveTextContent("T F T");
  expect(screen.getByText("Rank 1")).toBeVisible();
  expect(screen.getByText("Rank 2")).toBeVisible();
  await userEvent.setup().click(row);
  expect(select).toHaveBeenCalledWith(1);
});

it("shows unavailable free values explicitly", () => {
  const dataset = { ...twoStepDataset, ionicSteps: [{ ...twoStepDataset.ionicSteps[0]!, freeForces: null, freeForceNorms: null }, twoStepDataset.ionicSteps[1]!] };
  render(<ForceModule dataset={dataset} selectedIndex={0} metric="rmsFreeForce" mode="table" onMetricChange={vi.fn()} onModeChange={vi.fn()} onSelectStep={vi.fn()} onSelectSite={vi.fn()} />);
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
});
