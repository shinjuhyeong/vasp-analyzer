// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GLViewer } from "3dmol";

vi.mock("3dmol", () => ({
  createViewer: vi.fn(),
  elementColors: { Jmol: { O: 0xff0000 } },
}));

import { ThreeDmolRenderer } from "./ThreeDmolRenderer.js";
import type { CrystalFrame } from "./CrystalRenderer.js";

const frame: CrystalFrame = {
  lattice: [
    [2, 0, 0],
    [1, 2, 0],
    [0, 0, 3],
  ],
  sites: [
    {
      siteIndex: 1,
      element: "O",
      fractionalPosition: [0.5, 0.5, 0.5],
      cartesianPosition: [1.5, 1, 1.5],
      image: [0, 0, 0],
    },
  ],
  cellEdges: [{ start: [0, 0, 0], end: [2, 0, 0] }],
  axes: [{ label: "a", start: [0, 0, 0], end: [2, 0, 0] }],
  bonds: [],
};

function fakeViewer() {
  const viewer = {
    removeAllShapes: vi.fn(),
    removeAllLabels: vi.fn(),
    addCylinder: vi.fn(),
    addArrow: vi.fn(),
    addLabel: vi.fn(),
    addSphere: vi.fn(),
    render: vi.fn(),
    zoomTo: vi.fn(),
    getView: vi.fn(() => [0, 0, 0, 1, 0, 0, 0, 1]),
    setView: vi.fn(),
    setProjection: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
  };
  for (const name of [
    "removeAllShapes",
    "removeAllLabels",
    "render",
    "zoomTo",
    "setView",
    "setProjection",
    "resize",
    "clear",
  ] as const)
    viewer[name].mockReturnValue(viewer);
  return viewer;
}

describe("ThreeDmolRenderer adapter", () => {
  beforeEach(() => vi.clearAllMocks());
  it("maps every periodic image click back to its original site and scales only arrow geometry", () => {
    const viewer = fakeViewer(),
      container = document.createElement("div"),
      renderer = new ThreeDmolRenderer(
        viewer as unknown as GLViewer,
        container,
      );
    const selected = vi.fn();
    renderer.onSelectSite(selected);
    renderer.setStructure(frame);
    const atomSpec = viewer.addSphere.mock.calls.find(
      ([spec]) => spec.clickable,
    )?.[0];
    atomSpec.callback();
    expect(selected).toHaveBeenCalledWith(1);
    renderer.setForces([
      {
        siteIndex: 1,
        origin: [1.5, 1, 1.5],
        vector: [0, -0.2, 0],
        strongestAxis: "y",
      },
    ]);
    renderer.setForceScale(2);
    expect(viewer.addArrow).toHaveBeenCalledWith(
      expect.objectContaining({
        start: { x: 1.5, y: 1, z: 1.5 },
        end: { x: 1.5, y: 0.6, z: 1.5 },
      }),
    );
  });

  it("uses public projection/view APIs and releases the detached viewer on dispose", () => {
    const viewer = fakeViewer(),
      container = document.createElement("div");
    container.append(document.createElement("canvas"));
    const renderer = new ThreeDmolRenderer(
      viewer as unknown as GLViewer,
      container,
    );
    renderer.setStructure(frame);
    renderer.setOrthographic(true);
    renderer.setViewDirection([0, 1, 0], "direct");
    renderer.resize();
    renderer.dispose();
    renderer.dispose();
    expect(viewer.setProjection).toHaveBeenCalledWith("orthographic");
    expect(viewer.setView).toHaveBeenCalledOnce();
    expect(viewer.resize).toHaveBeenCalledOnce();
    expect(viewer.clear).toHaveBeenCalledOnce();
    expect(container).toBeEmptyDOMElement();
  });

  it("draws unknown constraints as neutral wire glyphs, never free arrows", () => {
    const viewer = fakeViewer(),
      renderer = new ThreeDmolRenderer(
        viewer as unknown as GLViewer,
        document.createElement("div"),
      );
    renderer.setStructure(frame);
    renderer.setConstraints([
      {
        siteIndex: 1,
        origin: [1.5, 1, 1.5],
        states: [null, false, true],
        emphasized: true,
      },
    ]);
    expect(viewer.addSphere).toHaveBeenCalledWith(
      expect.objectContaining({ wireframe: true, color: 0x8b949e }),
    );
    expect(viewer.addCylinder).toHaveBeenCalledWith(
      expect.objectContaining({ color: 0xf85149 }),
    );
    expect(viewer.addArrow).toHaveBeenCalledWith(
      expect.objectContaining({ color: 0x2ea043 }),
    );
  });
});
