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
    expect(screen.getByText("Selective Dynamics T F T")).toBeVisible();
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
        ? { ...site, selectiveDynamics: { x: null, y: false, z: true } }
        : site,
    );
    const { renderer } = setup();
    expect(renderer.setForces).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ siteIndex: 0, strongestAxis: "x" }),
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
    expect(screen.getByText("Selective Dynamics ? F T")).toBeVisible();
  });

  it("focuses the backend-selected strongest free site", async () => {
    const user = userEvent.setup();
    const { onSelectSite } = setup();
    await user.click(
      screen.getByRole("button", { name: /Focus strongest: site 1 X/ }),
    );
    expect(onSelectSite).toHaveBeenCalledWith(0);
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
});
