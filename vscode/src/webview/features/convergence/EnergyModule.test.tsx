// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { twoStepDataset } from "../../test/fixtures.js";
import { EnergyModule } from "./EnergyModule.js";

const callbacks = { onMetricChange: vi.fn(), onModeChange: vi.fn(), onSelectStep: vi.fn() };

it("shows every selected-step term with distinct contribution ranks", () => {
  const dataset = {
    ...twoStepDataset,
    ionicSteps: [{
      ...twoStepDataset.ionicSteps[0]!,
      energyTerms: [
        { key: "toten", rawLabel: "TOTEN", value: -500, unit: "eV" as const, kind: "aggregate" as const },
        { key: "ewald", rawLabel: "Ewald", value: -120, unit: "eV" as const, kind: "contribution" as const },
        { key: "ts", rawLabel: "-TS", value: -60, unit: "eV" as const, kind: "contribution" as const },
      ],
    }, twoStepDataset.ionicSteps[1]!],
  };
  render(<EnergyModule dataset={dataset} selectedIndex={0} metric="totalEnergy" mode="table" {...callbacks} />);
  const aggregate = screen.getByRole("row", { name: /toten.*TOTEN.*aggregate.*-500/ });
  expect(aggregate).toBeVisible();
  expect(aggregate).toHaveAttribute("data-kind", "aggregate");
  expect(aggregate).toHaveClass("energy-term-aggregate");
  expect(screen.getByRole("row", { name: /Ewald.*contribution.*-120.*Rank 1/ })).toBeVisible();
  expect(screen.getByRole("row", { name: /-TS.*contribution.*-60.*Rank 2/ })).toBeVisible();
});

it.each([
  ["totalEnergy", 0, "Ionic step 1: -10 eV"],
  ["deltaEnergy", 1, "Ionic step 2: -1 eV"],
] as const)("shows the selected %s value outside the graph", (metric, selectedIndex, value) => {
  render(<EnergyModule dataset={twoStepDataset} selectedIndex={selectedIndex} metric={metric} mode="graph" {...callbacks} />);
  expect(screen.getByRole("status", { name: "Energy selected metric" })).toHaveTextContent(value);
});

it("marks a null selected energy metric unavailable outside the graph", () => {
  render(<EnergyModule dataset={twoStepDataset} selectedIndex={0} metric="deltaEnergy" mode="graph" {...callbacks} />);
  expect(screen.getByRole("status", { name: "Energy selected metric" })).toHaveTextContent("Ionic step 1: Unavailable");
});

it("renders only the chosen metric with its own axis and keeps null gaps", () => {
  render(<EnergyModule dataset={twoStepDataset} selectedIndex={0} metric="deltaEnergy" mode="graph" {...callbacks} />);
  expect(screen.getAllByText("Energy change (eV)")).toHaveLength(2);
  expect(screen.queryByText("Total energy (eV)")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Energy change graph").querySelectorAll("circle")).toHaveLength(1);
});

it("states when detailed terms are unavailable", () => {
  render(<EnergyModule dataset={twoStepDataset} selectedIndex={0} metric="totalEnergy" mode="table" {...callbacks} />);
  expect(screen.getByText("Energy breakdown unavailable for this ionic step.")).toBeVisible();
});
