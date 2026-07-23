// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AnalysisTabs } from "./AnalysisTabs.js";

const reasons = {
  dos: "Requires DOSCAR",
  band: "Requires EIGENVAL",
  charge: "Requires CHGCAR",
} as const;

describe("AnalysisTabs", () => {
  it("starts on Convergence and switches to a labelled Parameters panel locally", async () => {
    render(<AnalysisTabs capabilityReasons={reasons} convergence={<p>Energy graph</p>} parameters={<p>ENCUT table</p>} />);

    expect(screen.getByRole("tab", { name: "Convergence" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("analysis-panel-convergence")).toBeInTheDocument();
    expect(document.getElementById("analysis-panel-parameters")).toBeInTheDocument();
    expect(document.getElementById("analysis-panel-parameters")).toHaveAttribute("hidden");
    expect(screen.getByRole("tabpanel", { name: "Convergence" })).toHaveTextContent("Energy graph");
    await userEvent.setup().click(screen.getByRole("tab", { name: "Parameters" }));
    expect(screen.getByRole("tab", { name: "Parameters" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("analysis-panel-convergence")).toHaveAttribute("hidden");
    expect(screen.getByRole("tabpanel", { name: "Parameters" })).toHaveTextContent("ENCUT table");
  });

  it("supports roving focus with Arrow, Home, and End across enabled tabs", () => {
    render(<AnalysisTabs capabilityReasons={reasons} convergence={<p>Convergence</p>} parameters={<p>Parameters</p>} />);
    const convergence = screen.getByRole("tab", { name: "Convergence" });
    const parameters = screen.getByRole("tab", { name: "Parameters" });

    convergence.focus();
    fireEvent.keyDown(convergence, { key: "ArrowRight" });
    expect(parameters).toHaveFocus();
    expect(parameters).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(parameters, { key: "Home" });
    expect(convergence).toHaveFocus();
    fireEvent.keyDown(convergence, { key: "End" });
    expect(parameters).toHaveFocus();
    fireEvent.keyDown(parameters, { key: "ArrowRight" });
    expect(convergence).toHaveFocus();
  });

  it("keeps future capability tabs disabled with exact reasons", () => {
    render(<AnalysisTabs capabilityReasons={reasons} convergence={null} parameters={null} />);
    expect(screen.getByRole("tab", { name: "DOS/PDOS" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "DOS/PDOS" })).toHaveAttribute("title", "Requires DOSCAR");
    expect(screen.getByRole("tab", { name: "Band" })).toHaveAttribute("title", "Requires EIGENVAL");
    expect(screen.getByRole("tab", { name: "Charge" })).toHaveAttribute("title", "Requires CHGCAR");
  });
});
