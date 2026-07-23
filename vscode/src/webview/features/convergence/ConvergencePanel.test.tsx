// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { DEFAULT_CONVERGENCE } from "../../core/store.js";
import { twoStepDataset } from "../../test/fixtures.js";
import { ConvergencePanel } from "./ConvergencePanel.js";

it("exposes the controlled modular convergence workspace", () => {
  render(
    <ConvergencePanel
      dataset={twoStepDataset}
      selectedIndex={1}
      preferences={{ ...DEFAULT_CONVERGENCE, selectedModules: ["energy", "force"] }}
      onSelectStep={vi.fn()}
      onPreferencesChange={vi.fn()}
      onSelectSite={vi.fn()}
    />,
  );

  expect(screen.getByRole("spinbutton", { name: "Convergence ionic step number" })).toHaveValue(2);
  expect(screen.getByRole("region", { name: "Energy analysis" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Force analysis" })).toBeVisible();
});
