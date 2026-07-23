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

it.each([
  ["externalPressure", "Ionic step 1: 3 kB"],
  ["cellVolume", "Ionic step 1: 27 Å³"],
] as const)("shows the selected %s value outside the graph", (metric, value) => {
  const dataset = { ...twoStepDataset, ionicSteps: [{ ...twoStepDataset.ionicSteps[0]!, externalPressureKb: 3 }, twoStepDataset.ionicSteps[1]!] };
  render(<CellStressModule dataset={dataset} selectedIndex={0} metric={metric} mode="graph" {...callbacks} />);
  expect(screen.getByRole("status", { name: "Cell and stress selected metric" })).toHaveTextContent(value);
});

it("marks a null selected cell metric unavailable outside the graph", () => {
  render(<CellStressModule dataset={twoStepDataset} selectedIndex={0} metric="externalPressure" mode="graph" {...callbacks} />);
  expect(screen.getByRole("status", { name: "Cell and stress selected metric" })).toHaveTextContent("Ionic step 1: Unavailable");
});

it("formats ordinary pressure conversions without binary artifacts", () => {
  const dataset = { ...twoStepDataset, ionicSteps: [{ ...twoStepDataset.ionicSteps[0]!, externalPressureKb: 3, pulayStressKb: 3 }, twoStepDataset.ionicSteps[1]!] };
  render(<CellStressModule dataset={dataset} selectedIndex={0} metric="externalPressure" mode="table" {...callbacks} />);
  expect(screen.getAllByText("0.3 GPa")).toHaveLength(2);
  expect(screen.queryByText(/0\.30000000000000004/)).not.toBeInTheDocument();
});
