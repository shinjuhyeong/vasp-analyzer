// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GLViewer } from "3dmol";

vi.mock("3dmol", () => ({
  createViewer: vi.fn(),
  elementColors: { Jmol: { O: 0xff0000 } },
}));

import {
  createThreeDmolRenderer,
  ThreeDmolRenderer,
} from "./ThreeDmolRenderer.js";
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
      role: "primary",
    },
  ],
  cellEdges: [{ start: [0, 0, 0], end: [2, 0, 0] }],
  axes: [{ label: "a", start: [0, 0, 0], end: [2, 0, 0] }],
  bonds: [],
};
const frameWithGhost: CrystalFrame = {
  ...frame,
  sites: [
    ...frame.sites,
    {
      ...frame.sites[0]!,
      image: [-1, 0, 0],
      cartesianPosition: [-0.5, 1, 1.5],
      role: "boundary",
    },
  ],
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
    renderer.setStructure(frameWithGhost);
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

  it("renders boundary ghosts as subdued clickable atoms with original identity", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(
      viewer as unknown as GLViewer,
      document.createElement("div"),
    );
    const selected = vi.fn();
    renderer.onSelectSite(selected);
    renderer.setStructure(frameWithGhost);
    const clickable = viewer.addSphere.mock.calls
      .filter(([spec]) => spec.clickable)
      .map(([spec]) => spec);
    expect(clickable).toHaveLength(2);
    expect(clickable[1]).toEqual(
      expect.objectContaining({ opacity: expect.any(Number) }),
    );
    clickable[1].callback();
    expect(selected).toHaveBeenCalledWith(1);
  });

  it("uses public projection/view APIs and releases the detached viewer on dispose", () => {
    const viewer = fakeViewer(),
      container = document.createElement("div");
    container.append(document.createElement("canvas"));
    const renderer = new ThreeDmolRenderer(
      viewer as unknown as GLViewer,
      container,
    );
    renderer.setStructure(frameWithGhost);
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

  it("resets the exact fitted home view and refreshes it with structure", () => {
    const viewer = fakeViewer();
    const firstHome = [1, 2, 3, 4, 0.1, 0.2, 0.3, 0.9];
    const secondHome = [4, 3, 2, 1, 0.4, 0.3, 0.2, 0.8];
    viewer.getView
      .mockReturnValueOnce(firstHome)
      .mockReturnValueOnce([9, 9, 9, 9, 0, 0, 0, 1])
      .mockReturnValueOnce(secondHome);
    const renderer = new ThreeDmolRenderer(
      viewer as unknown as GLViewer,
      document.createElement("div"),
    );
    renderer.setStructure(frame);
    renderer.setViewDirection([0, 1, 0], "direct");
    renderer.resetView();
    expect(viewer.setView).toHaveBeenLastCalledWith(firstHome);
    renderer.setStructure({ ...frame, sites: [...frame.sites] });
    renderer.resetView();
    expect(viewer.setView).toHaveBeenLastCalledWith(secondHome);
  });

  it("draws one compact global marker but detailed axes only for emphasized primary images", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(
      viewer as unknown as GLViewer,
      document.createElement("div"),
    );
    renderer.setStructure(frameWithGhost);
    viewer.addSphere.mockClear();
    viewer.addCylinder.mockClear();
    viewer.addArrow.mockClear();
    renderer.setConstraints([
      {
        siteIndex: 1,
        origin: [1.5, 1, 1.5],
        states: [null, false, true],
        emphasized: false,
      },
    ]);
    expect(viewer.addSphere).toHaveBeenCalledTimes(3); // primary + ghost atoms + one primary marker
    expect(viewer.addCylinder).not.toHaveBeenCalledWith(
      expect.objectContaining({ color: 0xf85149 }),
    );
    expect(viewer.addArrow).not.toHaveBeenCalledWith(
      expect.objectContaining({ color: 0x2ea043 }),
    );
    viewer.addCylinder.mockClear();
    viewer.addArrow.mockClear();
    renderer.setConstraints([
      {
        siteIndex: 1,
        origin: [1.5, 1, 1.5],
        states: [null, false, true],
        emphasized: true,
      },
    ]);
    expect(viewer.addCylinder).toHaveBeenCalledWith(
      expect.objectContaining({ color: 0xf85149 }),
    );
    expect(viewer.addArrow).toHaveBeenCalledWith(
      expect.objectContaining({ color: 0x2ea043 }),
    );
    expect(
      viewer.addArrow.mock.calls.filter(([spec]) => spec.color === 0x2ea043),
    ).toHaveLength(1);
  });

  it("tracks and removes viewer-construction listeners and observers exactly once", () => {
    const callbacks = {
      window: vi.fn(),
      body: vi.fn(),
      container: vi.fn(),
      canvas: vi.fn(),
    };
    const resizeDisconnect = vi.fn();
    const intersectionDisconnect = vi.fn();
    class Observer {
      constructor(_callback: ResizeObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect = resizeDisconnect;
    }
    class Intersection {
      constructor(_callback: IntersectionObserverCallback) {}
      observe() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      disconnect = intersectionDisconnect;
    }
    vi.stubGlobal("ResizeObserver", Observer);
    vi.stubGlobal("IntersectionObserver", Intersection);
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    const viewer = fakeViewer();
    const factory = vi.fn(() => {
      window.addEventListener("vasp-window", callbacks.window);
      document.body.addEventListener("vasp-body", callbacks.body);
      container.addEventListener("vasp-container", callbacks.container);
      canvas.addEventListener("vasp-canvas", callbacks.canvas);
      container.append(canvas);
      new ResizeObserver(() => undefined);
      new IntersectionObserver(() => undefined);
      return viewer as unknown as GLViewer;
    });
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalWindowAddDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "addEventListener",
    );
    const renderer = createThreeDmolRenderer(container, factory);
    expect(EventTarget.prototype.addEventListener).toBe(originalAdd);
    expect(
      Object.getOwnPropertyDescriptor(window, "addEventListener"),
    ).toEqual(originalWindowAddDescriptor);
    window.dispatchEvent(new Event("vasp-window"));
    document.body.dispatchEvent(new Event("vasp-body"));
    container.dispatchEvent(new Event("vasp-container"));
    canvas.dispatchEvent(new Event("vasp-canvas"));
    expect(callbacks.window).toHaveBeenCalledOnce();
    expect(callbacks.body).toHaveBeenCalledOnce();
    expect(callbacks.container).toHaveBeenCalledOnce();
    expect(callbacks.canvas).toHaveBeenCalledOnce();
    renderer.dispose();
    renderer.dispose();
    window.dispatchEvent(new Event("vasp-window"));
    document.body.dispatchEvent(new Event("vasp-body"));
    container.dispatchEvent(new Event("vasp-container"));
    canvas.dispatchEvent(new Event("vasp-canvas"));
    expect(callbacks.window).toHaveBeenCalledOnce();
    expect(callbacks.body).toHaveBeenCalledOnce();
    expect(callbacks.container).toHaveBeenCalledOnce();
    expect(callbacks.canvas).toHaveBeenCalledOnce();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(intersectionDisconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("finishes cleanup and stays idempotent when viewer clear throws", () => {
    const callback = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(_callback: ResizeObserverCallback) {}
        observe() {}
        unobserve() {}
        disconnect = disconnect;
      },
    );
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    const viewer = fakeViewer();
    viewer.clear.mockImplementation(() => {
      throw new Error("clear failed");
    });
    const renderer = createThreeDmolRenderer(container, () => {
      window.addEventListener("vasp-clear-throw", callback);
      new ResizeObserver(() => undefined);
      container.append(canvas);
      return viewer as unknown as GLViewer;
    });
    renderer.onSelectSite(callback);

    expect(() => renderer.dispose()).not.toThrow();
    expect(() => renderer.dispose()).not.toThrow();
    window.dispatchEvent(new Event("vasp-clear-throw"));
    renderer.resize();

    expect(viewer.clear).toHaveBeenCalledOnce();
    expect(viewer.resize).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(container.childNodes).toHaveLength(0);
    expect(
      (renderer as unknown as { viewer: GLViewer | null }).viewer,
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it("restores patches and cleans resources when viewer construction throws", () => {
    const callback = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(_callback: ResizeObserverCallback) {}
        observe() {}
        unobserve() {}
        disconnect = disconnect;
      },
    );
    const originalAdd = EventTarget.prototype.addEventListener;
    const container = document.createElement("div");
    const hostChild = document.createElement("p");
    const orphanCanvas = document.createElement("canvas");
    container.append(hostChild);
    expect(() =>
      createThreeDmolRenderer(container, () => {
        window.addEventListener("vasp-throw", callback);
        new ResizeObserver(() => undefined);
        container.append(orphanCanvas);
        throw new Error("webgl failed");
      }),
    ).toThrow("webgl failed");
    expect(EventTarget.prototype.addEventListener).toBe(originalAdd);
    window.dispatchEvent(new Event("vasp-throw"));
    expect(callback).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect([...container.childNodes]).toEqual([hostChild]);
    expect(orphanCanvas.isConnected).toBe(false);
    vi.unstubAllGlobals();
  });

  it("rejects nested synchronous construction without leaving capture active", () => {
    const container = document.createElement("div");
    expect(() =>
      createThreeDmolRenderer(container, () => {
        createThreeDmolRenderer(
          container,
          () => fakeViewer() as unknown as GLViewer,
        );
        return fakeViewer() as unknown as GLViewer;
      }),
    ).toThrow(/Nested 3Dmol viewer construction/);
    const renderer = createThreeDmolRenderer(
      container,
      () => fakeViewer() as unknown as GLViewer,
    );
    renderer.dispose();
  });
});
