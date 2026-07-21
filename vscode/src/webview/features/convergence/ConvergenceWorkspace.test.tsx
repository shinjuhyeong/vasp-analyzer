// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { ConvergencePreferences } from "../../core/contracts.js";
import { DEFAULT_CONVERGENCE } from "../../core/store.js";
import { twoStepDataset } from "../../test/fixtures.js";
import { ConvergenceWorkspace } from "./ConvergenceWorkspace.js";

function renderWorkspace(preferences: ConvergencePreferences = DEFAULT_CONVERGENCE) {
  const change = vi.fn();
  render(
    <ConvergenceWorkspace
      dataset={twoStepDataset}
      selectedIndex={0}
      preferences={preferences}
      onSelectStep={vi.fn()}
      onPreferencesChange={change}
      onSelectSite={vi.fn()}
    />,
  );
  return change;
}

it("starts with only the Energy module and prevents removing the final module", async () => {
  const change = renderWorkspace();
  const energy = screen.getByRole("button", { name: "Energy module" });
  expect(energy).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Force module" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("region", { name: "Energy analysis" })).toBeVisible();

  await userEvent.setup().click(energy);
  expect(change).not.toHaveBeenCalled();
});

it("adds modules in canonical order and reports the equal-share count", async () => {
  const change = renderWorkspace({
    ...DEFAULT_CONVERGENCE,
    selectedModules: ["cellStress", "energy"],
  });
  const regions = screen.getAllByRole("region").filter((region) => region.getAttribute("aria-label")?.endsWith("analysis"));
  expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
    "Energy analysis",
    "Cell & Stress analysis",
  ]);
  expect(screen.getByTestId("convergence-module-grid")).toHaveAttribute("data-count", "2");

  await userEvent.setup().click(screen.getByRole("button", { name: "Force module" }));
  expect(change).toHaveBeenCalledWith(expect.objectContaining({
    selectedModules: ["energy", "force", "cellStress"],
  }));
});

it.each([
  [["energy"], "1"],
  [["energy", "force"], "2"],
  [["energy", "force", "cellStress"], "3"],
] as const)("reports %s as a responsive module grid", (selectedModules, count) => {
  renderWorkspace({ ...DEFAULT_CONVERGENCE, selectedModules });
  expect(screen.getByTestId("convergence-module-grid")).toHaveAttribute("data-count", count);
  expect(screen.getByTestId("convergence-module-grid")).toHaveClass("convergence-module-grid");
});

it("updates only the selected module metric and mode", async () => {
  const change = renderWorkspace({
    ...DEFAULT_CONVERGENCE,
    selectedModules: ["energy", "force"],
    metrics: { ...DEFAULT_CONVERGENCE.metrics, energy: "deltaEnergy" },
    modes: { ...DEFAULT_CONVERGENCE.modes, force: "table" },
  });
  expect(screen.getByRole("combobox", { name: "Energy metric" })).toHaveValue("deltaEnergy");
  expect(screen.getByRole("button", { name: "Force Table mode" })).toHaveAttribute("aria-pressed", "true");

  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Force metric" }), "rmsFreeForce");
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({
    metrics: { ...DEFAULT_CONVERGENCE.metrics, energy: "deltaEnergy", force: "rmsFreeForce" },
  }));
  await userEvent.setup().click(screen.getByRole("button", { name: "Energy Table mode" }));
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({
    modes: { ...DEFAULT_CONVERGENCE.modes, force: "table", energy: "table" },
  }));
});
