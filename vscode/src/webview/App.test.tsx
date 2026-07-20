// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import { App, type AnalysisRegionProps } from "./App.js";
import { MemoryHost, twoStepDataset } from "./test/fixtures.js";

const FakeStructure: ComponentType<AnalysisRegionProps> = ({ selectedStep, selectedSite, onSelectSite }) => (
  <div>
    <span data-testid="structure-step">{selectedStep.index}</span>
    <button type="button" onClick={() => onSelectSite(1)}>select O</button>
    <span>{selectedSite ? `${selectedSite.element} ${selectedSite.siteIndex + 1}` : "No atom selected"}</span>
  </div>
);

const FakeConvergence: ComponentType<AnalysisRegionProps> = ({ selectedStep }) => (
  <span data-testid="convergence-step">{selectedStep.index}</span>
);

describe("analysis workspace", () => {
  it("uses one selected step across both layout regions", async () => {
    const user = userEvent.setup();
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");

    await user.selectOptions(screen.getByLabelText("Ionic step"), "1");

    expect(screen.getByLabelText("Ionic step")).toHaveValue("1");
    expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
    expect(screen.getByTestId("convergence-step")).toHaveTextContent("1");
  });

  it("restores and clamps persisted step/site before rendering the dataset", async () => {
    const host = new MemoryHost(twoStepDataset, { selectedStep: 99, selectedSite: 1 });
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);

    expect(await screen.findByLabelText("Ionic step")).toHaveValue("1");
    expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
    expect(screen.getByText("O 2")).toBeVisible();
    await waitFor(() => expect(host.state).toEqual({ selectedStep: 1, selectedSite: 1 }));
  });

  it("clears a persisted site that is not present in the loaded dataset", async () => {
    const host = new MemoryHost(twoStepDataset, { selectedStep: 0, selectedSite: 42 });
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);

    expect(await screen.findByText("No atom selected")).toBeVisible();
    await waitFor(() => expect(host.state).toEqual({ selectedStep: 0, selectedSite: null }));
  });

  it("persists only the selected step and site", async () => {
    const user = userEvent.setup();
    const host = new MemoryHost();
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");

    await user.selectOptions(screen.getByLabelText("Ionic step"), "1");
    await user.click(screen.getByRole("button", { name: "select O" }));

    expect(host.state).toEqual({ selectedStep: 1, selectedSite: 1 });
  });

  it("shows one active analysis tab and capability-aware disabled future tabs", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("convergence-step");

    expect(screen.getByRole("tab", { name: "Convergence" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "DOS/PDOS" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "DOS/PDOS" })).toHaveAttribute("title", expect.stringContaining("DOSCAR"));
    expect(screen.getByRole("tab", { name: "Band" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Charge" })).toBeDisabled();
  });

  it("resizes the vertical split by keyboard while clamping its bounds", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    const separator = await screen.findByRole("separator", { name: "Resize structure and analysis regions" });

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "80");
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(separator).toHaveAttribute("aria-valuenow", "75");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "30");
  });

  it("exposes force display controls as workspace state seams", async () => {
    const user = userEvent.setup();
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");

    await user.selectOptions(screen.getByLabelText("Force components"), "raw");
    fireEvent.change(screen.getByLabelText("Force vector scale"), { target: { value: "2.5" } });

    expect(screen.getByLabelText("Force components")).toHaveValue("raw");
    expect(screen.getByLabelText("Force vector scale")).toHaveValue("2.5");
  });
});
