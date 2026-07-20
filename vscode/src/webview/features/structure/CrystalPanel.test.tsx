// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  CrystalRenderer,
  CrystalRendererFactory,
  LayerName,
} from "../../renderers/CrystalRenderer.js";
import { CrystalPanel } from "./CrystalPanel.js";
import { twoStepDataset } from "../../test/fixtures.js";

class FakeRenderer implements CrystalRenderer {
  setStructure = vi.fn();
  setForces = vi.fn();
  setForceScale = vi.fn();
  setConstraints = vi.fn();
  setSupercell = vi.fn();
  setViewDirection = vi.fn();
  setOrthographic = vi.fn();
  setLayerVisible = vi.fn();
  setVolumetricLayer = vi.fn();
  setSelectedSite = vi.fn();
  resetView = vi.fn();
  resize = vi.fn();
  dispose = vi.fn();
  setTransitionDuration = vi.fn();
  private select: (site: number) => void = () => undefined;
  private hover: (site: number | null) => void = () => undefined;
  onSelectSite(callback: (site: number) => void): void {
    this.select = callback;
  }
  onHoverSite(callback: (site: number | null) => void): void {
    this.hover = callback;
  }
  selectSite(site: number): void {
    this.select(site);
  }
  hoverSite(site: number | null): void {
    this.hover(site);
  }
}

const setup = () => {
  const renderer = new FakeRenderer();
  const factory: CrystalRendererFactory = () => renderer;
  const onSelectSite = vi.fn();
  const props = {
    sites: twoStepDataset.sites,
    selectedStep: twoStepDataset.ionicSteps[0]!,
    selectedSite: null,
    forceMode: "free" as const,
    forceScale: 1,
    onSelectSite,
    rendererFactory: factory,
  };
  return {
    renderer,
    onSelectSite,
    props,
    view: render(<CrystalPanel {...props} />),
  };
};

describe("CrystalPanel", () => {
  it("clicking an atom shows exact positions, forces, and directional constraints", async () => {
    const { renderer, props, view } = setup();
    act(() => renderer.selectSite(1));
    view.rerender(
      <CrystalPanel {...props} selectedSite={twoStepDataset.sites[1]!} />,
    );
    expect(await screen.findByText("O 2")).toBeVisible();
    expect(screen.getByText("Fx 0.000000 eV/angstrom")).toBeVisible();
    expect(screen.getByText("Fy -0.200000 eV/angstrom")).toBeVisible();
    expect(screen.getByText("Selective Dynamics a/b/c T F T")).toBeVisible();
    expect(
      screen.getByText(/Fractional 0.500000 0.500000 0.500000/),
    ).toBeVisible();
    expect(
      screen.getByText(/Cartesian 1.500000 1.500000 1.500000 angstrom/),
    ).toBeVisible();
  });

  it("scales arrow geometry without changing displayed numeric values", async () => {
    const { renderer, props, view } = setup();
    view.rerender(
      <CrystalPanel
        {...props}
        forceScale={2}
        selectedSite={twoStepDataset.sites[1]!}
      />,
    );
    expect(renderer.setForceScale).toHaveBeenLastCalledWith(2);
    expect(screen.getByText("Fy -0.200000 eV/angstrom")).toBeVisible();
  });

  it("preserves original-site selection while changing the supercell", async () => {
    const user = userEvent.setup();
    const { renderer, onSelectSite } = setup();
    act(() => renderer.selectSite(1));
    expect(onSelectSite).toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByLabelText("Supercell a"), {
      target: { value: "2" },
    });
    expect(renderer.setSupercell).toHaveBeenLastCalledWith([2, 1, 1]);
  });

  it("controls layers, orthographic projection, direct and reciprocal views", async () => {
    const user = userEvent.setup();
    const { renderer } = setup();
    await user.click(screen.getByLabelText("Show bonds"));
    expect(renderer.setLayerVisible).toHaveBeenCalledWith(
      "bonds" satisfies LayerName,
      false,
    );
    await user.click(screen.getByLabelText("Orthographic projection"));
    expect(renderer.setOrthographic).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "View [010]" }));
    expect(renderer.setViewDirection).toHaveBeenLastCalledWith(
      [0, 1, 0],
      "direct",
    );
    await user.selectOptions(
      screen.getByLabelText("Direction semantics"),
      "plane-normal",
    );
    fireEvent.change(screen.getByLabelText("Integer direction"), {
      target: { value: "1 1 0" },
    });
    await user.click(screen.getByRole("button", { name: "Apply direction" }));
    expect(renderer.setViewDirection).toHaveBeenLastCalledWith(
      [1, 1, 0],
      "plane-normal",
    );
  });

  it("marks the exact strongest free component and never treats unknown constraints as free", () => {
    const unknownSites = twoStepDataset.sites.map((site, index) =>
      index === 1
        ? { ...site, selectiveDynamics: { a: null, b: false, c: true } }
        : site,
    );
    const { renderer } = setup();
    expect(renderer.setForces).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ siteIndex: 0, strongestAxis: "a" }),
      ]),
    );
    render(
      <CrystalPanel
        sites={unknownSites}
        selectedStep={twoStepDataset.ionicSteps[0]!}
        selectedSite={unknownSites[1]!}
        forceMode="free"
        forceScale={1}
        onSelectSite={() => undefined}
        rendererFactory={() => new FakeRenderer()}
      />,
    );
    expect(screen.getByText("Selective Dynamics a/b/c ? F T")).toBeVisible();
  });

  it("focuses the backend-selected strongest free site", async () => {
    const user = userEvent.setup();
    const { onSelectSite } = setup();
    await user.click(
      screen.getByRole("button", { name: /Focus strongest: site 1 a/ }),
    );
    expect(onSelectSite).toHaveBeenCalledWith(0);
  });

  it("shows detailed directional constraints only for selected or hovered sites", () => {
    const { renderer, props, view } = setup();
    expect(renderer.setConstraints).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ siteIndex: 0, emphasized: false }),
        expect.objectContaining({ siteIndex: 1, emphasized: false }),
      ]),
    );
    act(() => renderer.hoverSite(1));
    expect(renderer.setConstraints).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ siteIndex: 1, emphasized: true }),
      ]),
    );
    act(() => renderer.hoverSite(null));
    view.rerender(
      <CrystalPanel {...props} selectedSite={twoStepDataset.sites[0]!} />,
    );
    expect(renderer.setConstraints).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ siteIndex: 0, emphasized: true }),
      ]),
    );
  });

  it("does not coerce invalid supercell input and recovers when all axes are valid", () => {
    const { renderer } = setup();
    const input = screen.getByLabelText("Supercell a");
    for (const invalid of ["", "1.5", "0", "9"]) {
      fireEvent.change(input, { target: { value: invalid } });
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        /integers from 1 to 8/i,
      );
    }
    expect(renderer.setSupercell).toHaveBeenLastCalledWith([1, 1, 1]);
    fireEvent.change(input, { target: { value: "2" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(renderer.setSupercell).toHaveBeenLastCalledWith([2, 1, 1]);
  });

  it("disposes renderers and resize observers without leaking callbacks", () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { renderer, view } = setup();
    view.unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("does not recreate the WebGL renderer when selection callbacks change", () => {
    const renderer = new FakeRenderer();
    const factory = vi.fn(() => renderer);
    const props = {
      sites: twoStepDataset.sites,
      selectedStep: twoStepDataset.ionicSteps[0]!,
      selectedSite: null,
      forceMode: "free" as const,
      forceScale: 1,
      rendererFactory: factory,
    };
    const view = render(
      <CrystalPanel {...props} onSelectSite={() => undefined} />,
    );
    view.rerender(
      <CrystalPanel
        {...props}
        selectedSite={twoStepDataset.sites[1]!}
        onSelectSite={() => undefined}
      />,
    );
    expect(factory).toHaveBeenCalledOnce();
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  it("falls back once when a renderer update fails without retrying the failed instance", async () => {
    const renderer = new FakeRenderer();
    renderer.setStructure.mockImplementation(() => { throw new Error("GPU context lost"); });
    render(
      <CrystalPanel
        sites={twoStepDataset.sites}
        selectedStep={twoStepDataset.ionicSteps[0]!}
        selectedSite={null}
        forceMode="free"
        forceScale={1}
        onSelectSite={() => undefined}
        rendererFactory={() => renderer}
      />,
    );
    expect(await screen.findByRole("table", { name: "Atomic positions and forces" })).toBeVisible();
    expect(screen.getByText(/GPU context lost/)).toBeVisible();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.setStructure).toHaveBeenCalledOnce();
  });

  it("disconnects observation immediately and swallows disposal errors after an update failure", async () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = disconnect; });
    const renderer = new FakeRenderer();
    renderer.setStructure.mockImplementation(() => { throw new Error("update failed"); });
    renderer.dispose.mockImplementation(() => { throw new Error("dispose failed"); });
    const view = render(
      <CrystalPanel
        sites={twoStepDataset.sites}
        selectedStep={twoStepDataset.ionicSteps[0]!}
        selectedSite={null}
        forceMode="free"
        forceScale={1}
        onSelectSite={() => undefined}
        rendererFactory={() => renderer}
      />,
    );
    expect(await screen.findByRole("table", { name: "Atomic positions and forces" })).toBeVisible();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(() => view.unmount()).not.toThrow();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("uses 150ms transitions unless reduced motion is requested and removes the listener", () => {
    const add = vi.fn(), remove = vi.fn();
    let reduced = false;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return reduced; }, addEventListener: add, removeEventListener: remove,
    })));
    const { renderer, view } = setup();
    expect(renderer.setTransitionDuration).toHaveBeenCalledWith(150);
    const listener = add.mock.calls[0]![1] as () => void;
    reduced = true;
    act(listener);
    expect(renderer.setTransitionDuration).toHaveBeenLastCalledWith(0);
    view.unmount();
    expect(remove).toHaveBeenCalledWith("change", listener);
    vi.unstubAllGlobals();
  });

  it("batches frame and force targets through one atomic scene update", () => {
    const renderer = Object.assign(new FakeRenderer(), { setScene: vi.fn() });
    render(
      <CrystalPanel
        sites={twoStepDataset.sites}
        selectedStep={twoStepDataset.ionicSteps[0]!}
        selectedSite={null}
        forceMode="free"
        forceScale={2}
        onSelectSite={() => undefined}
        rendererFactory={() => renderer}
      />,
    );
    expect(renderer.setScene).toHaveBeenCalledOnce();
    expect(renderer.setScene).toHaveBeenCalledWith(expect.objectContaining({
      frame: expect.objectContaining({ sites: expect.any(Array) }),
      forces: expect.arrayContaining([expect.objectContaining({ siteIndex: 0 })]),
      forceScale: 2,
      constraints: expect.any(Array),
      supercell: [1, 1, 1],
    }));
    expect(renderer.setStructure).not.toHaveBeenCalled();
    expect(renderer.setForces).not.toHaveBeenCalled();
  });
});
