// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

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

class DeferredHost extends MemoryHost {
  readonly setStateCalls: Array<unknown> = [];
  private resolveDataset!: (dataset: typeof twoStepDataset) => void;
  private rejectDataset!: (error: Error) => void;
  readonly pending = new Promise<typeof twoStepDataset>((resolve, reject) => {
    this.resolveDataset = resolve;
    this.rejectDataset = reject;
  });

  override async request(method: "getDataset" | "getStep", params: Readonly<Record<string, unknown>>) {
    if (method === "getDataset") return await this.pending;
    return await super.request(method, params);
  }

  resolve(dataset = twoStepDataset): void { this.resolveDataset(dataset); }
  reject(error = new Error("load failed")): void { this.rejectDataset(error); }
  override setState(state: { readonly selectedStep: number; readonly selectedSite: number | null }): void {
    this.setStateCalls.push(state);
    super.setState(state);
  }
}

describe("analysis workspace", () => {
  it("keeps parsed data and the ionic-step control usable after WebGL construction fails", async () => {
    render(<App host={new MemoryHost()} rendererFactory={() => { throw new Error("WebGL unavailable"); }} />);
    expect(await screen.findByRole("table", { name: "Atomic positions and forces" })).toBeVisible();
    expect(screen.getByLabelText("Ionic step")).toBeEnabled();
    expect(screen.getByText(/WebGL unavailable/)).toBeVisible();
  });

  it("synchronizes a convergence point with the single control and structure region", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} />);
    await userEvent.setup().click(await screen.findByLabelText("Force at ionic step 2: 0.1 eV per angstrom"));
    expect(screen.getByLabelText("Ionic step")).toHaveValue("1");
    expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
    expect(screen.getByText("-11.000000 eV")).toBeVisible();
  });

  it("reports an empty ionic trajectory instead of remaining in loading state", async () => {
    render(<App host={new MemoryHost({ ...twoStepDataset, ionicSteps: [] })} />);
    expect(await screen.findByText("No ionic steps are available in this calculation.")).toBeVisible();
    expect(screen.queryByText(/Loading VASP calculation/)).not.toBeInTheDocument();
  });

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

  it("propagates force mode and scale to both analysis regions", async () => {
    const Region = ({ forceMode, forceScale }: AnalysisRegionProps) => <output>{forceMode}:{forceScale}</output>;
    render(<App host={new MemoryHost()} structure={Region} convergence={Region} />);
    await screen.findAllByText("free:1");

    fireEvent.change(screen.getByLabelText("Force components"), { target: { value: "raw" } });
    fireEvent.change(screen.getByLabelText("Force vector scale"), { target: { value: "3" } });

    expect(screen.getAllByText("raw:3")).toHaveLength(2);
  });

  it("implements pointer drag, clamp, and release with the same separator state", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    const separator = await screen.findByRole("separator");
    const workspace = separator.closest("main")!;
    Object.defineProperty(workspace, "getBoundingClientRect", { value: () => ({ top: 0, height: 100 }) });
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    Object.defineProperties(workspace, {
      setPointerCapture: { value: setCapture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releaseCapture },
    });

    fireEvent.pointerDown(separator, { pointerId: 7, clientY: 99 });
    expect(separator).toHaveAttribute("aria-valuenow", "80");
    fireEvent.pointerMove(workspace, { pointerId: 7, clientY: 1 });
    expect(separator).toHaveAttribute("aria-valuenow", "30");
    fireEvent.pointerUp(workspace, { pointerId: 7 });
    expect(setCapture).toHaveBeenCalledWith(7);
    expect(releaseCapture).toHaveBeenCalledWith(7);
  });

  it("does not leak old selection into a replacement host before its dataset loads", async () => {
    const user = userEvent.setup();
    const hostA = new MemoryHost();
    const hostB = new DeferredHost(twoStepDataset, { selectedStep: 0, selectedSite: 1 });
    const view = render(<App host={hostA} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");
    await user.selectOptions(screen.getByLabelText("Ionic step"), "1");

    view.rerender(<App host={hostB} structure={FakeStructure} convergence={FakeConvergence} />);
    expect(screen.getByText("Loading VASP calculation…")).toBeVisible();
    expect(hostB.setStateCalls).toHaveLength(0);
    hostB.resolve();

    expect(await screen.findByText("O 2")).toBeVisible();
    expect(screen.getByLabelText("Ionic step")).toHaveValue("0");
    await waitFor(() => expect(hostB.setStateCalls).toEqual([{ selectedStep: 0, selectedSite: 1 }]));
  });

  it("ignores a late prior-host response after replacement", async () => {
    const hostA = new DeferredHost();
    const hostB = new MemoryHost(twoStepDataset, { selectedStep: 1, selectedSite: null });
    const view = render(<App host={hostA} structure={FakeStructure} convergence={FakeConvergence} />);
    view.rerender(<App host={hostB} structure={FakeStructure} convergence={FakeConvergence} />);
    expect(await screen.findByTestId("structure-step")).toHaveTextContent("1");

    hostA.resolve({ ...twoStepDataset, root: "/stale" });

    await waitFor(() => expect(screen.getByText("calculation")).toBeVisible());
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("clears an earlier host error when a replacement host succeeds", async () => {
    const hostA = new DeferredHost();
    const view = render(<App host={hostA} structure={FakeStructure} convergence={FakeConvergence} />);
    hostA.reject(new Error("first failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("first failed");

    view.rerender(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);

    expect(await screen.findByTestId("structure-step")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
