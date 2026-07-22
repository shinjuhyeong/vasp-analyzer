// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import { App, type AnalysisRegionProps } from "./App.js";
import { VsCodeHost } from "./core/host.js";
import { DEFAULT_CONVERGENCE, DEFAULT_LAYOUT } from "./core/store.js";
import type { PersistedAnalysisState } from "./core/contracts.js";
import { MemoryHost, twoStepDataset } from "./test/fixtures.js";
import type { CrystalRendererFactory } from "./renderers/CrystalRenderer.js";

const inertRendererFactory: CrystalRendererFactory = () => ({
  setStructure: vi.fn(), setForces: vi.fn(), setForceScale: vi.fn(),
  setConstraints: vi.fn(), setSupercell: vi.fn(), setViewDirection: vi.fn(),
  setOrthographic: vi.fn(), setLayerVisible: vi.fn(), setVolumetricLayer: vi.fn(),
  setSelectedSite: vi.fn(), onSelectSite: vi.fn(), onHoverSite: vi.fn(),
  resetView: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
});

describe("Initial comparison flow", () => {
  it("offers Initial, scopes Compare to it, and removes force controls during comparison", async () => {
    const user = userEvent.setup();
    const first = twoStepDataset.ionicSteps[0]!;
    const dataset = { ...twoStepDataset, initialStructure: { source: "POSCAR" as const, lattice: first.lattice,
      fractionalPositions: first.fractionalPositions, cartesianPositions: first.cartesianPositions } };
    render(<App host={new MemoryHost(dataset)} structure={FakeStructure} convergence={FakeConvergence} />);
    const frame = await screen.findByLabelText("Ionic step number");
    await user.clear(frame); await user.type(frame, "0{Enter}");
    expect(screen.getByText("Initial / 2")).toBeVisible();
    const compare = screen.getByLabelText("Compare structures");
    await user.click(compare);
    expect(screen.getByLabelText("Comparison target number")).toHaveValue(1);
    expect(screen.getByLabelText("Displacement arrow multiplier slider")).toBeVisible();
    expect(screen.queryByLabelText("Force vector scale slider")).not.toBeInTheDocument();
    await user.clear(frame); await user.type(frame, "1{Enter}");
    expect(screen.queryByLabelText("Compare structures")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Force vector scale slider")).toBeVisible();
  });
});

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

const PreferenceControls: ComponentType<AnalysisRegionProps> = ({
  onInspectorCollapsedChange,
  onPaletteCollapsedChange,
}) => (
  <div>
    <button type="button" onClick={() => onInspectorCollapsedChange(false)}>
      expand test inspector
    </button>
    <button type="button" onClick={() => onPaletteCollapsedChange(false)}>
      expand test palette
    </button>
  </div>
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
  override setState(state: PersistedAnalysisState): void {
    this.setStateCalls.push(state);
    super.setState(state);
  }
}

describe("analysis workspace", () => {
  it("starts Energy-only and synchronizes workspace and toolbar step controls", async () => {
    render(<App host={new MemoryHost(twoStepDataset)} rendererFactory={inertRendererFactory} />);
    expect(await screen.findByRole("button", { name: "Energy module" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Force module" })).toHaveAttribute("aria-pressed", "false");
    const workspaceStep = screen.getByRole("spinbutton", { name: "Convergence ionic step number" });
    const user = userEvent.setup();
    await user.clear(workspaceStep);
    await user.type(workspaceStep, "2{Enter}");
    expect(screen.getByRole("spinbutton", { name: "Ionic step number" })).toHaveValue(2);
    expect(screen.getAllByText("2 / 2")).toHaveLength(2);
  });

  it("persists module selection, metric, and mode changes", async () => {
    const host = new MemoryHost(twoStepDataset);
    render(<App host={host} rendererFactory={inertRendererFactory} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Force module" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Force metric" }), "rmsFreeForce");
    await user.click(screen.getByRole("button", { name: "Force Table mode" }));
    await waitFor(() => expect(host.state?.convergence).toMatchObject({
      selectedModules: ["energy", "force"],
      metrics: { force: "rmsFreeForce" },
      modes: { force: "table" },
    }));
  });

  it("uses a compact toolbar and starts crystal tools collapsed", async () => {
    render(<App host={new MemoryHost()} rendererFactory={inertRendererFactory} />);
    expect(await screen.findByLabelText("Ionic step number")).toBeVisible();
    expect(screen.getByLabelText("Force vector scale number")).toHaveValue(10);
    expect(screen.getByRole("button", { name: "Expand crystal tools" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Crystal tools" })).not.toBeInTheDocument();
  });
  it("keeps parsed data and the ionic-step control usable after WebGL construction fails", async () => {
    render(<App host={new MemoryHost()} rendererFactory={() => { throw new Error("WebGL unavailable"); }} />);
    expect(await screen.findByRole("table", { name: "Atomic positions and forces" })).toBeVisible();
    expect(screen.getByLabelText("Ionic step slider")).toBeEnabled();
    expect(screen.getByLabelText("Ionic step number")).toBeEnabled();
    expect(screen.getByLabelText("Force vector scale slider")).toBeEnabled();
    expect(screen.getByLabelText("Force vector scale number")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Ionic step number"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Force vector scale number"), {
      target: { value: "250" },
    });
    expect(screen.getByLabelText("Ionic step number")).toHaveValue(2);
    expect(screen.getByLabelText("Force vector scale number")).toHaveValue(250);
    expect(screen.getByText(/WebGL unavailable/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Expand crystal tools" })).not.toBeInTheDocument();
  });

  it("synchronizes the convergence step control with the toolbar and structure region", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} />);
    const number = await screen.findByLabelText("Convergence ionic step number");
    fireEvent.change(number, { target: { value: "2" } });
    fireEvent.keyDown(number, { key: "Enter" });
    expect(screen.getByLabelText("Ionic step number")).toHaveValue(2);
    expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
  });

  it("keeps noncontiguous parser step identifiers distinct from selection indices", async () => {
    const dataset = {
      ...twoStepDataset,
      ionicSteps: twoStepDataset.ionicSteps.map((step, position) => ({
        ...step,
        index: position === 0 ? 10 : 20,
      })),
    };
    render(<App host={new MemoryHost(dataset)} structure={FakeStructure} />);
    const number = await screen.findByLabelText("Convergence ionic step number");
    fireEvent.change(number, { target: { value: "2" } });
    fireEvent.keyDown(number, { key: "Enter" });
    expect(screen.getByLabelText("Ionic step number")).toHaveValue(2);
    expect(screen.getByTestId("structure-step")).toHaveTextContent("20");
  });

  it("reports an empty ionic trajectory instead of remaining in loading state", async () => {
    render(<App host={new MemoryHost({ ...twoStepDataset, ionicSteps: [] })} />);
    expect(await screen.findByText("No ionic steps are available in this calculation.")).toBeVisible();
    expect(screen.queryByText(/Loading VASP calculation/)).not.toBeInTheDocument();
  });

  it("reaches the empty-trajectory state through the validated VS Code host", async () => {
    const messages: Array<{ requestId: number }> = [];
    const host = new VsCodeHost({
      postMessage: (message) => messages.push(message as { requestId: number }),
      getState: () => undefined,
      setState: () => undefined,
    }, window);
    render(<App host={host} />);
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "response",
        requestId: messages[0]!.requestId,
        result: { ...twoStepDataset, ionicSteps: [] },
      },
    }));
    expect(await screen.findByText("No ionic steps are available in this calculation.")).toBeVisible();
    host.dispose();
  });

  it("uses one selected step across both layout regions", async () => {
    const user = userEvent.setup();
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");

    const number = screen.getByLabelText("Ionic step number");
    fireEvent.change(number, { target: { value: "2" } });
    fireEvent.keyDown(number, { key: "Enter" });

    expect(screen.getByLabelText("Ionic step number")).toHaveValue(2);
    expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
    expect(screen.getByTestId("convergence-step")).toHaveTextContent("1");
  });

  it("restores and clamps persisted step/site before rendering the dataset", async () => {
    const host = new MemoryHost(twoStepDataset, { selectedStep: 99, selectedSite: 1 });
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);

    expect(await screen.findByLabelText("Ionic step number")).toHaveValue(2);
    expect(screen.getByTestId("structure-step")).toHaveTextContent("1");
    expect(screen.getByText("O 2")).toBeVisible();
    await waitFor(() => expect(host.state).toEqual({
      version: 4, selectedFrame: { kind: "ionic", index: 1 }, comparisonTarget: 0, displacementScale: 10,
      selectedSite: 1, forceMode: "free", forceScale: 10, layout: DEFAULT_LAYOUT,
      convergence: DEFAULT_CONVERGENCE,
    }));
  });

  it("clears a persisted site that is not present in the loaded dataset", async () => {
    const host = new MemoryHost(twoStepDataset, { selectedStep: 0, selectedSite: 42 });
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);

    expect(await screen.findByText("No atom selected")).toBeVisible();
    await waitFor(() => expect(host.state).toEqual({
      version: 4, selectedFrame: { kind: "ionic", index: 0 }, comparisonTarget: 0, displacementScale: 10,
      selectedSite: null, forceMode: "free", forceScale: 10, layout: DEFAULT_LAYOUT,
      convergence: DEFAULT_CONVERGENCE,
    }));
  });

  it("persists the versioned workspace preferences", async () => {
    const user = userEvent.setup();
    const host = new MemoryHost();
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");

    const number = screen.getByLabelText("Ionic step number");
    fireEvent.change(number, { target: { value: "2" } });
    fireEvent.keyDown(number, { key: "Enter" });
    await user.click(screen.getByRole("button", { name: "select O" }));

    expect(host.state).toEqual({
      version: 4, selectedFrame: { kind: "ionic", index: 1 }, comparisonTarget: 0, displacementScale: 10,
      selectedSite: 1, forceMode: "free", forceScale: 10,
      layout: { ...DEFAULT_LAYOUT, inspectorCollapsed: false },
      convergence: DEFAULT_CONVERGENCE,
    });
  });

  it("normalizes legacy selection and all workspace changes into one version-3 state", async () => {
    const user = userEvent.setup();
    const host = new MemoryHost(twoStepDataset, {
      selectedStep: 0,
      selectedSite: null,
    });
    render(
      <App
        host={host}
        structure={PreferenceControls}
        convergence={FakeConvergence}
      />,
    );
    await screen.findByTestId("convergence-step");

    const number = screen.getByLabelText("Ionic step number");
    fireEvent.change(number, {
      target: { value: "2" },
    });
    fireEvent.keyDown(number, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Force vector scale number"), {
      target: { value: "250" },
    });
    fireEvent.keyDown(
      screen.getByRole("separator", {
        name: "Resize structure and analysis regions",
      }),
      { key: "End" },
    );
    await user.click(
      screen.getByRole("button", { name: "expand test inspector" }),
    );
    await user.click(
      screen.getByRole("button", { name: "expand test palette" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Enter structure full-screen" }),
    );

    await waitFor(() =>
      expect(host.state).toMatchObject({
        version: 4,
        selectedFrame: { kind: "ionic", index: 1 },
        comparisonTarget: 0,
        displacementScale: 10,
        selectedSite: null,
        forceMode: "free",
        forceScale: 250,
        layout: {
          structurePercent: 95,
          inspectorCollapsed: false,
          paletteCollapsed: false,
        },
      }),
    );
    expect(host.state).not.toHaveProperty("fullScreen");
  });

  it("auto-expands only for the first fresh atom selection", async () => {
    const InspectorSelection = ({
      selectedSite,
      inspectorCollapsed,
      onSelectSite,
      onInspectorCollapsedChange,
    }: AnalysisRegionProps) => (
      <div>
        <output data-testid="inspector-state">
          {selectedSite?.siteIndex ?? "none"}:{inspectorCollapsed ? "collapsed" : "expanded"}
        </output>
        <button type="button" onClick={() => onSelectSite(0)}>select first</button>
        <button type="button" onClick={() => onInspectorCollapsedChange(true)}>collapse inspector</button>
        <button type="button" onClick={() => onSelectSite(1)}>select second</button>
      </div>
    );
    render(<App host={new MemoryHost()} structure={InspectorSelection} convergence={FakeConvergence} />);
    const user = userEvent.setup();
    expect(await screen.findByTestId("inspector-state")).toHaveTextContent("none:collapsed");

    await user.click(screen.getByRole("button", { name: "select first" }));
    expect(screen.getByTestId("inspector-state")).toHaveTextContent("0:expanded");
    await user.click(screen.getByRole("button", { name: "collapse inspector" }));
    await user.click(screen.getByRole("button", { name: "select second" }));
    expect(screen.getByTestId("inspector-state")).toHaveTextContent("1:collapsed");
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

  it("opens Parameters without persisting the local tab choice", async () => {
    const host = new MemoryHost({
      ...twoStepDataset,
      parameters: [{
        key: "encut", rawKey: "ENCUT", rawValue: "520", value: 520,
        unit: "eV", category: "electronic", description: "Plane-wave cutoff",
        ordinal: 0, lineNumber: 18,
      }],
    });
    render(<App host={host} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("convergence-step");
    const before = host.state;

    await userEvent.setup().click(screen.getByRole("tab", { name: "Parameters" }));
    expect(screen.getByRole("tabpanel", { name: "Parameters" })).toHaveTextContent("ENCUT");
    expect(host.state).toEqual(before);
  });

  it("resizes the vertical split by keyboard to the supported near-full bound", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    const separator = await screen.findByRole("separator", { name: "Resize structure and analysis regions" });

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "95");
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(separator).toHaveAttribute("aria-valuenow", "90");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "30");
  });

  it("exposes force display controls as workspace state seams", async () => {
    const user = userEvent.setup();
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");

    await user.selectOptions(screen.getByLabelText("Force components"), "raw");
    fireEvent.change(screen.getByLabelText("Force vector scale number"), { target: { value: "2.5" } });

    expect(screen.getByLabelText("Force components")).toHaveValue("raw");
    expect(screen.getByLabelText("Force vector scale number")).toHaveValue(2.5);
  });

  it("propagates force mode and scale to both analysis regions", async () => {
    const Region = ({ forceMode, forceScale }: AnalysisRegionProps) => <output>{forceMode}:{forceScale}</output>;
    render(<App host={new MemoryHost()} structure={Region} convergence={Region} />);
    await screen.findAllByText("free:10");

    fireEvent.change(screen.getByLabelText("Force components"), { target: { value: "raw" } });
    fireEvent.change(screen.getByLabelText("Force vector scale number"), { target: { value: "3" } });

    expect(screen.getAllByText("raw:3")).toHaveLength(2);
  });

  it("implements pointer drag, clamp, and release with the same separator state", async () => {
    render(<App host={new MemoryHost()} structure={FakeStructure} convergence={FakeConvergence} />);
    const separator = await screen.findByRole("separator");
    const workspace = separator.closest("main")!;
    Object.defineProperty(workspace, "getBoundingClientRect", { value: () => ({ top: 0, height: 100 }) });
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    Object.defineProperties(separator, {
      setPointerCapture: { value: setCapture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releaseCapture },
    });

    fireEvent.pointerDown(separator, { pointerId: 7, clientY: 99 });
    expect(separator).toHaveAttribute("aria-valuenow", "95");
    fireEvent.pointerMove(separator, { pointerId: 7, clientY: 1 });
    expect(separator).toHaveAttribute("aria-valuenow", "30");
    fireEvent.pointerUp(separator, { pointerId: 7 });
    expect(setCapture).toHaveBeenCalledWith(7);
    expect(releaseCapture).toHaveBeenCalledWith(7);
  });

  it("keeps compact controls in structure full-screen and restores layout on Escape", async () => {
    const host = new MemoryHost(twoStepDataset, {
      version: 4,
      selectedFrame: { kind: "ionic", index: 0 },
      comparisonTarget: 0,
      displacementScale: 10,
      selectedSite: 1,
      forceMode: "free",
      forceScale: 10,
      layout: { ...DEFAULT_LAYOUT, structurePercent: 70, inspectorWidth: 360, inspectorCollapsed: false },
      convergence: DEFAULT_CONVERGENCE,
    });
    render(<App host={host} rendererFactory={inertRendererFactory} convergence={FakeConvergence} />);
    const separator = await screen.findByRole("separator", { name: "Resize structure and analysis regions" });
    expect(separator).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByRole("separator", { name: "Resize atom inspector" })).toHaveAttribute("aria-valuenow", "360");

    await userEvent.setup().click(screen.getByRole("button", { name: "Enter structure full-screen" }));
    expect(screen.getByLabelText("Ionic step number")).toBeVisible();
    expect(screen.queryByTestId("convergence-step")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize structure and analysis regions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize atom inspector" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Collapse atom inspector" }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByTestId("convergence-step")).toBeVisible();
    expect(screen.getByRole("separator", { name: "Resize structure and analysis regions" })).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByRole("separator", { name: "Resize atom inspector" })).toHaveAttribute("aria-valuenow", "360");
    await waitFor(() => expect(host.state).toMatchObject({
      layout: { structurePercent: 70, inspectorWidth: 360, inspectorCollapsed: false },
    }));
  });

  it("does not leak old selection into a replacement host before its dataset loads", async () => {
    const user = userEvent.setup();
    const hostA = new MemoryHost();
    const hostB = new DeferredHost(twoStepDataset, { selectedStep: 0, selectedSite: 1 });
    const view = render(<App host={hostA} structure={FakeStructure} convergence={FakeConvergence} />);
    await screen.findByTestId("structure-step");
    const number = screen.getByLabelText("Ionic step number");
    fireEvent.change(number, { target: { value: "2" } });
    fireEvent.keyDown(number, { key: "Enter" });

    view.rerender(<App host={hostB} structure={FakeStructure} convergence={FakeConvergence} />);
    expect(screen.getByText("Loading VASP calculation…")).toBeVisible();
    expect(hostB.setStateCalls).toHaveLength(0);
    hostB.resolve();

    expect(await screen.findByText("O 2")).toBeVisible();
    expect(screen.getByLabelText("Ionic step number")).toHaveValue(1);
    await waitFor(() => expect(hostB.setStateCalls).toEqual([{
      version: 4, selectedFrame: { kind: "ionic", index: 0 }, comparisonTarget: 0, displacementScale: 10,
      selectedSite: 1, forceMode: "free", forceScale: 10, layout: DEFAULT_LAYOUT,
      convergence: DEFAULT_CONVERGENCE,
    }]));
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
