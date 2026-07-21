// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { CellStressModule } from "./CellStressModule.js";

const callbacks = { onMetricChange: vi.fn(), onModeChange: vi.fn(), onSelectStep: vi.fn() };

it("shows canonical kB, exact GPa conversion, VASP sign and the full tensor", () => {
  const dataset = { ...twoStepDataset, ionicSteps: [{
    ...twoStepDataset.ionicSteps[0]!, externalPressureKb: -2.5, pulayStressKb: 1.25,
    cellVolume: 27, stressTensorKb: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] as const,
  }, twoStepDataset.ionicSteps[1]!] };
  render(<CellStressModule dataset={dataset} selectedIndex={0} metric="externalPressure" mode="table" {...callbacks} />);
  expect(screen.getByText("-2.5 kB")).toBeVisible();
  expect(screen.getByText("-0.25 GPa")).toBeVisible();
  expect(screen.getByText("1.25 kB")).toBeVisible();
  expect(screen.getByText(/VASP sign convention/)).toBeVisible();
  expect(screen.getByRole("table", { name: "Stress tensor in kB" }).querySelectorAll("tbody tr")).toHaveLength(3);
  expect(screen.getByRole("table", { name: "Stress tensor in kB" }).querySelectorAll("tbody td")).toHaveLength(9);
});

it("uses metric-specific graph axes and preserves unavailable pressure gaps", () => {
  render(<CellStressModule dataset={twoStepDataset} selectedIndex={0} metric="externalPressure" mode="graph" {...callbacks} />);
  expect(screen.getAllByText("External pressure (kB)")).toHaveLength(2);
  expect(screen.queryByText("Cell volume (Å³)")).not.toBeInTheDocument();
  expect(screen.getByText("No values available")).toBeVisible();
});

it("states when every selected-step cell and stress detail is unavailable", () => {
  const dataset = { ...twoStepDataset, ionicSteps: [{ ...twoStepDataset.ionicSteps[0]!, cellVolume: null }, twoStepDataset.ionicSteps[1]!] };
  render(<CellStressModule dataset={dataset} selectedIndex={0} metric="cellVolume" mode="table" {...callbacks} />);
  expect(screen.getByText("Cell and stress details unavailable for this ionic step.")).toBeVisible();
});
