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
import type { CrystalFrame, CrystalScene } from "./CrystalRenderer.js";

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
  bonds: [{
    start: [1.5, 1, 1.5],
    end: [2, 1, 1.5],
    fromSiteIndex: 1,
    toSiteIndex: 1,
    fromImage: [0, 0, 0],
    toImage: [1, 0, 0],
  }],
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

const movedFrame: CrystalFrame = {
  ...frame,
  lattice: [[4, 0, 0], [1, 2, 0], [0, 0, 3]],
  sites: frame.sites.map((site) => ({
    ...site,
    cartesianPosition: [2.5, 1, 1.5] as const,
  })),
  cellEdges: [{ start: [0, 0, 0], end: [4, 0, 0] }],
  axes: [{ label: "a", start: [0, 0, 0], end: [4, 0, 0] }],
  bonds: [{
    ...frame.bonds[0]!,
    start: [2.5, 1, 1.5],
    end: [3.5, 1, 1.5],
  }],
};

const scene = (crystalFrame: CrystalFrame, force: number): CrystalScene => ({
  frame: crystalFrame,
  forces: [{ siteIndex: 1, origin: crystalFrame.sites[0]!.cartesianPosition, vector: [force, 0, 0], strongestAxis: null, strongestValue: null }],
  forceScale: 1,
  constraints: [],
  supercell: [1, 1, 1],
  comparison: null,
});

const comparisonScene = (): CrystalScene => ({
  ...scene(movedFrame, 9),
  comparison: {
    initialFrame: frame,
    targetFrame: movedFrame,
    displacements: [{ siteIndex: 1, origin: [1.5, 1, 1.5], vector: [1, 0, 0], strongestAxis: null, strongestValue: null }],
    displacementScale: 2,
    cellDeltas: [
      { label: "a", start: [0, 0, 0], end: [2, 0, 0] },
      { label: "b", start: [0, 0, 0], end: [0, 1, 0] },
      { label: "c", start: [0, 0, 0], end: [0, 0, 1] },
    ],
  },
});

function fakeAnimationFrames() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++next;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => callbacks.delete(id));
  const run = (time: number) => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error("No animation frame is pending");
    callbacks.delete(entry[0]);
    entry[1](time);
  };
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return { request, cancel, run, callbacks };
}

function fakeViewer() {
  let handle = 0;
  const viewer = {
    removeAllShapes: vi.fn(),
    removeAllLabels: vi.fn(),
    addCylinder: vi.fn(),
    addArrow: vi.fn(),
    addLabel: vi.fn(),
    addSphere: vi.fn(),
    removeShape: vi.fn(),
    removeLabel: vi.fn(),
    render: vi.fn(),
    zoomTo: vi.fn(),
    getView: vi.fn(() => [0, 0, 0, 1, 0, 0, 0, 1]),
    setView: vi.fn(),
    setProjection: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
  };
  for (const name of ["addCylinder", "addArrow", "addSphere", "addLabel"] as const)
    viewer[name].mockImplementation(() => ({ handle: ++handle }));
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
  it("renders explicit comparison overlays and removes them when toggled off", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    const selected = vi.fn();
    renderer.onSelectSite(selected);
    renderer.setScene(comparisonScene());

    const clickable = viewer.addSphere.mock.calls.filter(([spec]) => spec.clickable).map(([spec]) => spec);
    expect(clickable).toHaveLength(2);
    expect(clickable[0]).toMatchObject({ opacity: 0.35 });
    expect(clickable[1]).toMatchObject({ opacity: 1 });
    clickable[0].callback();
    clickable[1].callback();
    expect(selected).toHaveBeenNthCalledWith(1, 1);
    expect(selected).toHaveBeenNthCalledWith(2, 1);
    expect(viewer.addCylinder).toHaveBeenCalledWith(expect.objectContaining({ dashed: true, opacity: 0.35 }));
    expect(viewer.addCylinder).toHaveBeenCalledWith(expect.objectContaining({ dashed: false, opacity: 1 }));
    expect(viewer.addArrow).toHaveBeenCalledWith(expect.objectContaining({ start: { x: 1.5, y: 1, z: 1.5 }, end: { x: 3.5, y: 1, z: 1.5 }, color: 0x00bcd4 }));
    expect(viewer.addArrow).toHaveBeenCalledWith(expect.objectContaining({ start: { x: 0, y: 0, z: 0 }, color: 0xff8c00 }));
    expect(viewer.addArrow).toHaveBeenCalledWith(expect.objectContaining({ end: { x: 4, y: 0, z: 0 }, color: 0xf85149 }));
    expect(viewer.addArrow).not.toHaveBeenCalledWith(expect.objectContaining({ end: { x: 20.5, y: 1, z: 1.5 } }));

    const shapesBefore = viewer.removeAllShapes.mock.calls.length;
    renderer.setScene(scene(frame, 1));
    expect(viewer.removeAllShapes.mock.calls.length).toBe(shapesBefore);
    expect(viewer.removeShape).toHaveBeenCalled();
    expect(viewer.removeLabel).toHaveBeenCalled();
    expect(viewer.addSphere.mock.calls.slice(clickable.length).some(([spec]) => spec.opacity === 0.35 && spec.clickable)).toBe(false);
  });

  it("keeps comparison displacements and cell deltas visible when forces and axes are off", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    renderer.setLayerVisible("forces", false);
    renderer.setLayerVisible("axes", false);
    viewer.addArrow.mockClear();

    renderer.setScene(comparisonScene());

    expect(viewer.addArrow).toHaveBeenCalledWith(expect.objectContaining({ color: 0x00bcd4 }));
    expect(viewer.addArrow).toHaveBeenCalledWith(expect.objectContaining({ color: 0xff8c00 }));
    expect(viewer.addArrow).not.toHaveBeenCalledWith(expect.objectContaining({ color: 0xf85149 }));
  });

  it("keeps target boundary atoms solid and replaces comparison through retained handles", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    const base = comparisonScene();
    const compared: CrystalScene = { ...base, comparison: { ...base.comparison!, targetFrame: frameWithGhost } };
    renderer.setScene(compared);
    const targetAtoms = viewer.addSphere.mock.calls.filter(([spec]) => spec.clickable).slice(-2).map(([spec]) => spec);
    expect(targetAtoms).toHaveLength(2);
    expect(targetAtoms.every((spec) => spec.opacity === 1)).toBe(true);
    const globalClears = viewer.removeAllShapes.mock.calls.length;
    renderer.setSelectedSite(1);
    expect(viewer.removeAllShapes).toHaveBeenCalledTimes(globalClears);
    expect(viewer.removeShape).toHaveBeenCalled();
  });
  it("uses white-on-dark atom labels while preserving colored transparent axis labels", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(
      viewer as unknown as GLViewer,
      document.createElement("div"),
    );
    renderer.setStructure(frame);
    renderer.setSelectedSite(1);

    expect(viewer.addLabel).toHaveBeenCalledWith("O 2", expect.objectContaining({
      fontColor: "white",
      backgroundColor: 0x111827,
      backgroundOpacity: 0.72,
    }));
    expect(viewer.addLabel).toHaveBeenCalledWith("a", expect.objectContaining({
      fontColor: 0xf85149,
      backgroundOpacity: 0,
    }));

    viewer.addLabel.mockClear();
    const atom = viewer.addSphere.mock.calls.find(([spec]) => spec.clickable)?.[0];
    atom.hover_callback();
    expect(viewer.addLabel).toHaveBeenCalledWith("O 2", expect.objectContaining({
      fontColor: "white",
      backgroundOpacity: 0.72,
    }));
  });
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
        strongestAxis: "b",
        strongestValue: -0.2,
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

  it("draws strongest allowed-direction arrows along normalized skew lattice vectors", () => {
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    renderer.setStructure({ ...frameWithGhost, lattice: [[1, 0, 0], [1, 1, 0], [0, 0, 1]] });
    viewer.addArrow.mockClear();
    renderer.setForces([{ siteIndex: 1, origin: [1.5, 1, 1.5], vector: [0.5, 0.5, 0], strongestAxis: "b", strongestValue: Math.SQRT1_2 }]);
    const highlighted = viewer.addArrow.mock.calls.find(([spec]) => spec.radius === 0.105)?.[0];
    expect(highlighted).toMatchObject({
      start: { x: 1.5, y: 1, z: 1.5 },
      end: { x: 2, y: 1.5, z: 1.5 },
    });
  });

  it("interpolates an atomic scene at start, midpoint, and exact final geometry", () => {
    const raf = fakeAnimationFrames();
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    const initialScene = scene(frame, 1);
    renderer.setScene(initialScene);
    renderer.setTransitionDuration(150);
    renderer.setScene(scene(movedFrame, 3));

    const geometry = (time: number) => {
      viewer.addSphere.mockClear();
      viewer.addArrow.mockClear();
      viewer.addCylinder.mockClear();
      raf.run(time);
      const atom = viewer.addSphere.mock.calls.find(([spec]) => spec.clickable)?.[0];
      const force = viewer.addArrow.mock.calls.find(([spec]) => spec.color === 0x00bcd4)?.[0];
      const cell = viewer.addCylinder.mock.calls[0]?.[0];
      const bond = viewer.addCylinder.mock.calls.find(([spec]) => spec.radius === 0.09)?.[0];
      return { atom, force, cell, bond };
    };

    expect(geometry(0)).toMatchObject({ atom: { center: { x: 1.5 } }, force: { end: { x: 2.5 } }, cell: { end: { x: 2 } }, bond: { end: { x: 2 } } });
    expect(geometry(75)).toMatchObject({ atom: { center: { x: 2 } }, force: { end: { x: 4 } }, cell: { end: { x: 3 } }, bond: { end: { x: 2.75 } } });
    expect(geometry(150)).toMatchObject({ atom: { center: { x: 2.5 } }, force: { end: { x: 5.5 } }, cell: { end: { x: 4 } }, bond: { end: { x: 3.5 } } });
    expect(raf.callbacks.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it("interpolates and renormalizes selective lattice directions during cell rotation", () => {
    const raf = fakeAnimationFrames();
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    const constraint = (direction: readonly [number, number, number]) => [{
      siteIndex: 1, origin: [1.5, 1, 1.5] as const, states: [true, false, false] as const,
      directions: [direction, [0, 1, 0] as const, [0, 0, 1] as const] as const, emphasized: true,
    }];
    renderer.setScene({ ...scene(frame, 1), constraints: constraint([1, 0, 0]) });
    renderer.setTransitionDuration(150);
    renderer.setScene({ ...scene(movedFrame, 1), constraints: constraint([0, 1, 0]) });
    raf.run(0);
    viewer.addArrow.mockClear();
    raf.run(75);
    const allowed = viewer.addArrow.mock.calls.find(([spec]) => spec.color === 0x2ea043)?.[0];
    const offset = 0.52 / Math.sqrt(2);
    expect(allowed.end.x).toBeCloseTo(2 + offset);
    expect(allowed.end.y).toBeCloseTo(1 + offset);
    vi.unstubAllGlobals();
  });

  it("does not animate selection or layer redraws and applies reduced-motion scenes immediately", () => {
    const raf = fakeAnimationFrames();
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    const initialScene = scene(frame, 1);
    renderer.setScene(initialScene);
    renderer.setTransitionDuration(150);
    renderer.setSelectedSite(1);
    renderer.setLayerVisible("bonds", false);
    renderer.setScene({
      ...initialScene,
      constraints: [{
        siteIndex: 1,
        origin: [1.5, 1, 1.5],
        states: [true, true, true],
        directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        emphasized: true,
      }],
    });
    expect(raf.request).not.toHaveBeenCalled();
    renderer.setTransitionDuration(0);
    renderer.setScene(scene(movedFrame, 3));
    expect(raf.request).not.toHaveBeenCalled();
    expect([...viewer.addSphere.mock.calls].reverse().find(([spec]) => spec.clickable)?.[0]).toMatchObject({ center: { x: 2.5 } });
    vi.unstubAllGlobals();
  });

  it("uses safe target geometry when atom or force topology cannot be matched", () => {
    const raf = fakeAnimationFrames();
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    renderer.setScene(scene(frame, 1));
    renderer.setTransitionDuration(150);
    renderer.setScene({
      ...scene(frameWithGhost, 1),
      forces: [{ siteIndex: 1, origin: [1.5, 1, 1.5], vector: null, strongestAxis: null, strongestValue: null }],
    });
    viewer.addSphere.mockClear();
    viewer.addArrow.mockClear();
    raf.run(0);
    const ghost = viewer.addSphere.mock.calls.find(([spec]) => spec.clickable && spec.opacity < 1)?.[0];
    expect(ghost).toMatchObject({ center: { x: -0.5, y: 1, z: 1.5 } });
    expect(viewer.addArrow.mock.calls.some(([spec]) => Object.values(spec.end ?? {}).some(Number.isNaN))).toBe(false);
    vi.unstubAllGlobals();
  });

  it("cancels a pending scene transition on replacement and disposal", () => {
    const raf = fakeAnimationFrames();
    const renderer = new ThreeDmolRenderer(fakeViewer() as unknown as GLViewer, document.createElement("div"));
    renderer.setScene(scene(frame, 1));
    renderer.setTransitionDuration(150);
    renderer.setScene(scene(movedFrame, 3));
    raf.run(0);
    const firstPending = [...raf.callbacks.keys()][0]!;
    renderer.setScene(scene(frameWithGhost, 2));
    expect(raf.cancel).toHaveBeenCalledWith(firstPending);
    const replacement = [...raf.callbacks.keys()][0]!;
    renderer.dispose();
    expect(raf.cancel).toHaveBeenCalledWith(replacement);
    expect(raf.callbacks.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it("reports asynchronous transition draw failures through the renderer seam", () => {
    const raf = fakeAnimationFrames();
    const viewer = fakeViewer();
    const renderer = new ThreeDmolRenderer(viewer as unknown as GLViewer, document.createElement("div"));
    const onError = vi.fn();
    renderer.onError(onError);
    renderer.setScene(scene(frame, 1));
    renderer.setTransitionDuration(150);
    renderer.setScene(scene(movedFrame, 3));
    viewer.render.mockImplementation(() => { throw new Error("context lost"); });
    expect(() => raf.run(0)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "context lost" }));
    expect(raf.callbacks.size).toBe(0);
    vi.unstubAllGlobals();
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
        directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
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
        directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
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
        directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
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
