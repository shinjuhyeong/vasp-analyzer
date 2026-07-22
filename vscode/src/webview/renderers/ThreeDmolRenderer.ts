import { createViewer, type GLViewer } from "3dmol";

import type { Vec3 } from "../core/contracts.js";
import type {
  ConstraintGlyph,
  ComparisonScene,
  CrystalFrame,
  CrystalRenderer,
  CrystalScene,
  DirectionSemantics,
  LayerName,
  SupercellRepeat,
  VectorGlyph,
  VolumetricLayer,
} from "./CrystalRenderer.js";
import {
  covalentRadius,
  elementVisual,
  crystallographicViewVector,
} from "../features/structure/scene.js";

const xyz = (value: Vec3) => ({ x: value[0], y: value[1], z: value[2] });
const vec3 = (values: readonly number[]): Vec3 =>
  Object.freeze([values[0]!, values[1]!, values[2]!]);
const axisVector = (axis: number, length: number): Vec3 =>
  Object.freeze([
    axis === 0 ? length : 0,
    axis === 1 ? length : 0,
    axis === 2 ? length : 0,
  ]);
const add = (left: Vec3, right: Vec3): Vec3 =>
  Object.freeze([left[0] + right[0], left[1] + right[1], left[2] + right[2]]);
const mix = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress;
const mixVec = (from: Vec3, to: Vec3, progress: number): Vec3 =>
  Object.freeze([
    mix(from[0], to[0], progress),
    mix(from[1], to[1], progress),
    mix(from[2], to[2], progress),
  ]);

const siteKey = (site: CrystalFrame["sites"][number]): string =>
  `${site.siteIndex}:${site.image.join(",")}`;
const bondKey = (bond: CrystalFrame["bonds"][number]): string =>
  `${bond.fromSiteIndex}:${bond.fromImage.join(",")}>${bond.toSiteIndex}:${bond.toImage.join(",")}`;

function interpolateFrame(
  from: CrystalFrame,
  to: CrystalFrame,
  progress: number,
): CrystalFrame {
  const sourceSites = new Map(from.sites.map((site) => [siteKey(site), site]));
  const sourceAxes = new Map(from.axes.map((axis) => [axis.label, axis]));
  const sourceBonds = new Map(from.bonds.map((bond) => [bondKey(bond), bond]));
  return {
    lattice: to.lattice.map((vector, axis) =>
      mixVec(from.lattice[axis] ?? vector, vector, progress),
    ) as unknown as CrystalFrame["lattice"],
    sites: to.sites.map((site) => {
      const source = sourceSites.get(siteKey(site));
      return source
        ? {
            ...site,
            fractionalPosition: mixVec(
              source.fractionalPosition,
              site.fractionalPosition,
              progress,
            ),
            cartesianPosition: mixVec(
              source.cartesianPosition,
              site.cartesianPosition,
              progress,
            ),
          }
        : site;
    }),
    cellEdges: to.cellEdges.map((edge, index) => {
      const source = from.cellEdges[index];
      return source
        ? {
            start: mixVec(source.start, edge.start, progress),
            end: mixVec(source.end, edge.end, progress),
          }
        : edge;
    }),
    axes: to.axes.map((axis) => {
      const source = sourceAxes.get(axis.label);
      return source
        ? {
            ...axis,
            start: mixVec(source.start, axis.start, progress),
            end: mixVec(source.end, axis.end, progress),
          }
        : axis;
    }),
    bonds: to.bonds.map((bond) => {
      const source = sourceBonds.get(bondKey(bond));
      return source
        ? {
            ...bond,
            start: mixVec(source.start, bond.start, progress),
            end: mixVec(source.end, bond.end, progress),
          }
        : bond;
    }),
  };
}

function interpolateForces(
  from: readonly VectorGlyph[],
  to: readonly VectorGlyph[],
  progress: number,
): readonly VectorGlyph[] {
  const sources = new Map(from.map((glyph) => [glyph.siteIndex, glyph]));
  return to.map((glyph) => {
    const source = sources.get(glyph.siteIndex);
    if (!source || !source.vector || !glyph.vector) return glyph;
    return {
      ...glyph,
      origin: mixVec(source.origin, glyph.origin, progress),
      vector: mixVec(source.vector, glyph.vector, progress),
    };
  });
}

function interpolateConstraints(
  from: readonly ConstraintGlyph[],
  to: readonly ConstraintGlyph[],
  progress: number,
): readonly ConstraintGlyph[] {
  const sources = new Map(from.map((glyph) => [glyph.siteIndex, glyph]));
  return to.map((glyph) => {
    const source = sources.get(glyph.siteIndex);
    if (!source) return glyph;
    return {
      ...glyph,
      origin: mixVec(source.origin, glyph.origin, progress),
      directions: glyph.directions.map((direction, axis) => {
        const mixed = mixVec(source.directions[axis]!, direction, progress);
        const length = Math.hypot(...mixed);
        return length < 1e-12
          ? direction
          : vec3(mixed.map((value) => value / length));
      }) as [Vec3, Vec3, Vec3],
    };
  });
}

function quaternionToCamera(
  direction: Vec3,
): readonly [number, number, number, number] {
  const length = Math.hypot(...direction);
  if (length < 1e-12) throw new Error("View direction must be non-zero");
  const x = direction[0] / length,
    y = direction[1] / length,
    z = direction[2] / length;
  // Rotate the requested direct/normal vector onto the camera's +z axis.
  if (z < -0.999999) return Object.freeze([0, 1, 0, 0]);
  const qx = y,
    qy = -x,
    qz = 0,
    qw = 1 + z,
    qnorm = Math.hypot(qx, qy, qz, qw);
  return Object.freeze([qx / qnorm, qy / qnorm, qz / qnorm, qw / qnorm]);
}

type ViewerFactory = (container: HTMLElement) => GLViewer;

interface ConstructionResources<T> {
  readonly value: T;
  readonly dispose: () => void;
}

let constructionCaptureActive = false;

function captureConstructionResources<T>(
  container: HTMLElement,
  factory: () => T,
): ConstructionResources<T> {
  if (constructionCaptureActive)
    throw new Error("Nested 3Dmol viewer construction is not supported");
  const listeners: Array<{
    readonly target: EventTarget;
    readonly type: string;
    readonly listener: EventListenerOrEventListenerObject;
    readonly remove: typeof EventTarget.prototype.removeEventListener;
    readonly options?: boolean | AddEventListenerOptions;
  }> = [];
  const observers: Array<{ disconnect(): void }> = [];
  const initialChildren = new Set(container.childNodes);
  const prototypes = Array.from(
    new Set(
      [
        globalThis.EventTarget?.prototype,
        container.ownerDocument.defaultView?.EventTarget.prototype,
      ].filter((value): value is EventTarget => value !== undefined),
    ),
  );
  const originalAdds = prototypes.map((prototype) => ({
    prototype,
    add: prototype.addEventListener,
    remove: prototype.removeEventListener,
  }));
  const windowTarget = container.ownerDocument
    .defaultView as unknown as EventTarget | null;
  const windowAddDescriptor = windowTarget
    ? Object.getOwnPropertyDescriptor(windowTarget, "addEventListener")
    : undefined;
  const originalWindowAdd = windowTarget?.addEventListener;
  const originalWindowRemove = windowTarget?.removeEventListener;
  const resizeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "ResizeObserver",
  );
  const intersectionDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "IntersectionObserver",
  );

  const OriginalResizeObserver = globalThis.ResizeObserver;
  const OriginalIntersectionObserver = globalThis.IntersectionObserver;

  let cleaned = false;
  const dispose = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const { target, type, listener, remove, options } of [
      ...listeners,
    ].reverse())
      try {
        remove.call(target, type, listener, options);
      } catch {
        // Teardown is best-effort per resource so one faulty target cannot leak the rest.
      }
    for (const observer of observers)
      try {
        observer.disconnect();
      } catch {
        // Keep disconnecting the remaining construction-owned observers.
      }
    listeners.length = 0;
    observers.length = 0;
  };
  const restore = (): void => {
    for (const { prototype, add } of originalAdds)
      prototype.addEventListener = add;
    if (windowTarget) {
      if (windowAddDescriptor)
        Object.defineProperty(
          windowTarget,
          "addEventListener",
          windowAddDescriptor,
        );
      else Reflect.deleteProperty(windowTarget, "addEventListener");
    }
    if (resizeDescriptor)
      Object.defineProperty(globalThis, "ResizeObserver", resizeDescriptor);
    else
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver })
        .ResizeObserver;
    if (intersectionDescriptor)
      Object.defineProperty(
        globalThis,
        "IntersectionObserver",
        intersectionDescriptor,
      );
    else
      delete (
        globalThis as { IntersectionObserver?: typeof IntersectionObserver }
      ).IntersectionObserver;
  };

  constructionCaptureActive = true;
  try {
    for (const { prototype, add, remove } of originalAdds)
      prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        add.call(this, type, listener, options);
        if (listener)
          listeners.push({
            target: this,
            type,
            listener,
            remove,
            ...(options === undefined ? {} : { options }),
          });
      };
    if (windowTarget && originalWindowAdd && originalWindowRemove)
      windowTarget.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        originalWindowAdd.call(this, type, listener, options);
        if (listener)
          listeners.push({
            target: this,
            type,
            listener,
            remove: originalWindowRemove,
            ...(options === undefined ? {} : { options }),
          });
      };
    if (typeof OriginalResizeObserver === "function")
      globalThis.ResizeObserver = class extends OriginalResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super(callback);
          observers.push(this);
        }
      };
    if (typeof OriginalIntersectionObserver === "function")
      globalThis.IntersectionObserver = class extends (
        OriginalIntersectionObserver
      ) {
        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          super(callback, options);
          observers.push(this);
        }
      };
    return { value: factory(), dispose };
  } catch (error) {
    dispose();
    for (const child of [...container.childNodes])
      if (!initialChildren.has(child)) child.remove();
    throw error;
  } finally {
    restore();
    constructionCaptureActive = false;
  }
}

export class ThreeDmolRenderer implements CrystalRenderer {
  private frame: CrystalFrame | null = null;
  private forces: readonly VectorGlyph[] = [];
  private targetFrame: CrystalFrame | null = null;
  private targetForces: readonly VectorGlyph[] = [];
  private targetForceScale = 1;
  private constraints: readonly ConstraintGlyph[] = [];
  private forceScale = 1;
  private selectedSite: number | null = null;
  private hoveredSite: number | null = null;
  private volumetric: VolumetricLayer | null = null;
  private readonly layers: Record<LayerName, boolean> = {
    cell: true,
    axes: true,
    bonds: true,
    forces: true,
    constraints: true,
    volumetric: false,
  };
  private selectCallback: (siteIndex: number) => void = () => undefined;
  private hoverCallback: (siteIndex: number | null) => void = () => undefined;
  private errorCallback: (reason: unknown) => void = () => undefined;
  private homeView: readonly number[] | null = null;
  private disposed = false;
  private transitionDurationMs = 0;
  private transitionFrame: number | null = null;
  private transitionGeneration = 0;
  private comparison: ComparisonScene | null = null;
  private targetComparison: ComparisonScene | null = null;

  constructor(
    private viewer: GLViewer | null,
    private readonly container: HTMLElement,
    private readonly disposeConstructionResources: () => void = () => undefined,
  ) {}

  setScene(scene: CrystalScene): void {
    if (this.disposed) return;
    const geometryChanged =
      this.targetFrame !== scene.frame ||
      this.targetForces !== scene.forces ||
      this.targetForceScale !== scene.forceScale ||
      this.targetComparison !== scene.comparison;
    const sourceConstraints = this.constraints;
    this.constraints = scene.constraints;
    this.targetFrame = scene.frame;
    this.targetForces = scene.forces;
    this.targetForceScale = scene.forceScale;
    this.targetComparison = scene.comparison;
    this.comparison = scene.comparison;
    if (!geometryChanged) {
      this.draw();
      return;
    }
    const sourceFrame = this.frame;
    const sourceForces = this.forces;
    const sourceScale = this.forceScale;
    this.cancelTransition();
    if (
      !sourceFrame ||
      this.transitionDurationMs <= 0 ||
      typeof requestAnimationFrame !== "function"
    ) {
      const firstFrame = !this.frame;
      this.applySceneTarget();
      if (firstFrame) this.fitInitialView();
      return;
    }
    const generation = this.transitionGeneration;
    let startTime: number | null = null;
    const tick = (time: number): void => {
      if (this.disposed || generation !== this.transitionGeneration) return;
      this.transitionFrame = null;
      try {
        startTime ??= time;
        const progress = Math.min(
          1,
          Math.max(0, (time - startTime) / this.transitionDurationMs),
        );
        this.frame = interpolateFrame(sourceFrame, scene.frame, progress);
        this.forces = interpolateForces(sourceForces, scene.forces, progress);
        this.constraints = interpolateConstraints(sourceConstraints, scene.constraints, progress);
        this.forceScale = mix(sourceScale, scene.forceScale, progress);
        this.draw();
        if (progress >= 1) {
          this.frame = scene.frame;
          this.forces = scene.forces;
          this.constraints = scene.constraints;
          this.forceScale = scene.forceScale;
          this.draw();
          return;
        }
        this.transitionFrame = requestAnimationFrame(tick);
      } catch (reason) {
        this.cancelTransition();
        this.errorCallback(reason);
      }
    };
    this.transitionFrame = requestAnimationFrame(tick);
  }

  setStructure(frame: CrystalFrame): void {
    this.cancelTransition();
    this.frame = frame;
    this.targetFrame = frame;
    this.draw();
    this.fitInitialView();
  }
  setForces(vectors: readonly VectorGlyph[]): void {
    this.cancelTransition();
    this.forces = vectors;
    this.targetForces = vectors;
    this.draw();
  }
  setForceScale(scale: number): void {
    this.cancelTransition();
    this.forceScale = Number.isFinite(scale) ? Math.max(0, scale) : 1;
    this.targetForceScale = this.forceScale;
    this.draw();
  }
  setConstraints(glyphs: readonly ConstraintGlyph[]): void {
    this.constraints = glyphs;
    this.draw();
  }
  setSupercell(_repeat: SupercellRepeat): void {
    /* Scene frame already contains the authoritative replicated records. */
  }
  setViewDirection(
    direction: readonly [number, number, number],
    semantics: DirectionSemantics,
  ): void {
    if (!this.frame || !this.viewer) return;
    const vector = crystallographicViewVector(
      direction,
      this.frame.lattice,
      semantics,
    );
    const current = this.viewer.getView();
    const q = quaternionToCamera(vector);
    this.viewer.setView([
      current[0] ?? 0,
      current[1] ?? 0,
      current[2] ?? 0,
      current[3] ?? 0,
      ...q,
    ]);
    this.viewer.render();
  }
  setOrthographic(enabled: boolean): void {
    this.viewer?.setProjection(enabled ? "orthographic" : "perspective");
    this.viewer?.render();
  }
  setLayerVisible(layer: LayerName, visible: boolean): void {
    this.layers[layer] = visible;
    this.draw();
  }
  setVolumetricLayer(layer: VolumetricLayer | null): void {
    this.volumetric = layer;
    this.draw();
  }
  setSelectedSite(siteIndex: number | null): void {
    this.selectedSite = siteIndex;
    this.draw();
  }
  setTransitionDuration(durationMs: number): void {
    this.transitionDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    if (this.transitionDurationMs === 0 && this.transitionFrame !== null) {
      this.cancelTransition();
      this.applySceneTarget();
    }
  }
  onSelectSite(callback: (siteIndex: number) => void): void {
    this.selectCallback = callback;
  }
  onHoverSite(callback: (siteIndex: number | null) => void): void {
    this.hoverCallback = callback;
  }
  onError(callback: (reason: unknown) => void): void {
    this.errorCallback = callback;
  }
  resetView(): void {
    if (this.homeView) this.viewer?.setView([...this.homeView]);
    this.viewer?.render();
  }
  resize(): void {
    this.viewer?.resize();
    this.viewer?.render();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTransition();
    this.selectCallback = () => undefined;
    this.hoverCallback = () => undefined;
    this.errorCallback = () => undefined;
    this.hoveredSite = null;
    try {
      this.viewer?.clear();
    } catch {
      // React cleanup must remain non-throwing even if WebGL teardown fails.
    } finally {
      try {
        this.disposeConstructionResources();
      } finally {
        this.viewer = null;
        this.container.replaceChildren();
      }
    }
  }

  private applySceneTarget(): void {
    this.frame = this.targetFrame;
    this.forces = this.targetForces;
    this.forceScale = this.targetForceScale;
    this.comparison = this.targetComparison;
    this.draw();
  }

  private fitInitialView(): void {
    this.viewer?.zoomTo();
    this.viewer?.render();
    this.homeView = this.viewer
      ? Object.freeze([...this.viewer.getView()])
      : null;
  }

  private cancelTransition(): void {
    this.transitionGeneration += 1;
    if (
      this.transitionFrame !== null &&
      typeof cancelAnimationFrame === "function"
    )
      cancelAnimationFrame(this.transitionFrame);
    this.transitionFrame = null;
  }

  private draw(): void {
    const viewer = this.viewer,
      frame = this.frame;
    if (!viewer || !frame || this.disposed) return;
    viewer.removeAllShapes();
    viewer.removeAllLabels();
    if (this.comparison) {
      this.drawComparison(viewer, this.comparison);
      viewer.render();
      return;
    }
    if (this.layers.cell)
      for (const edge of frame.cellEdges)
        viewer.addCylinder({
          start: xyz(edge.start),
          end: xyz(edge.end),
          radius: 0.025,
          color: 0x8b949e,
          opacity: 0.8,
        });
    if (this.layers.axes)
      for (const [axis, { label, start, end }] of frame.axes.entries()) {
        const color = [0xf85149, 0x3fb950, 0x58a6ff][axis]!;
        viewer.addArrow({
          start: xyz(start),
          end: xyz(end),
          radius: 0.08,
          color,
        });
        viewer.addLabel(label, {
          position: xyz(end),
          fontColor: color,
          backgroundOpacity: 0,
          fontSize: 13,
        });
      }
    if (this.layers.bonds)
      for (const bond of frame.bonds)
        viewer.addCylinder({
          start: xyz(bond.start),
          end: xyz(bond.end),
          radius: 0.09,
          color: 0xb7bcc5,
          fromCap: "round",
          toCap: "round",
        });
    for (const site of frame.sites) {
      const selected = site.siteIndex === this.selectedSite;
      const boundary = site.role === "boundary";
      const baseRadius = Math.min(
        0.52,
        Math.max(0.22, (covalentRadius(site.element) ?? 1.2) * 0.25),
      );
      viewer.addSphere({
        center: xyz(site.cartesianPosition),
        radius: boundary ? baseRadius * 0.78 : baseRadius,
        color: elementVisual(site.element).color,
        opacity: boundary ? 0.42 : 1,
        clickable: true,
        callback: () => this.selectCallback(site.siteIndex),
        hoverable: true,
        hover_callback: () => {
          this.hoveredSite = site.siteIndex;
          this.hoverCallback(site.siteIndex);
          this.draw();
        },
        unhover_callback: () => {
          this.hoveredSite = null;
          this.hoverCallback(null);
          this.draw();
        },
      });
      if (selected)
        viewer.addSphere({
          center: xyz(site.cartesianPosition),
          radius: baseRadius + 0.09,
          color: 0xffd33d,
          opacity: 0.25,
          wireframe: true,
        });
    }
    const atomOverlaySite = frame.sites.find(
      (site) =>
        site.role === "primary" &&
        site.siteIndex === (this.hoveredSite ?? this.selectedSite),
    );
    if (atomOverlaySite)
      viewer.addLabel(
        `${atomOverlaySite.element} ${atomOverlaySite.siteIndex + 1}`,
        {
          position: xyz(atomOverlaySite.cartesianPosition),
          fontColor: "white",
          backgroundColor: 0x111827,
          backgroundOpacity: 0.72,
          fontSize: 13,
        },
      );
    if (this.layers.forces)
      for (const glyph of this.forces) {
        if (!glyph.vector || Math.hypot(...glyph.vector) < 1e-12) continue;
        for (const site of frame.sites.filter(
          (candidate) =>
            candidate.siteIndex === glyph.siteIndex &&
            candidate.role === "primary",
        )) {
          const vector = Object.freeze(
            glyph.vector.map((value) => value * this.forceScale),
          ) as Vec3;
          viewer.addArrow({
            start: xyz(site.cartesianPosition),
            end: xyz(add(site.cartesianPosition, vector)),
            radius: 0.07,
            color: glyph.strongestAxis ? 0xffc107 : 0x00bcd4,
          });
          if (glyph.strongestAxis) {
            const axis = { a: 0, b: 1, c: 2 }[glyph.strongestAxis];
            const latticeVector = frame.lattice[axis]!;
            const norm = Math.hypot(...latticeVector);
            const direction = vec3(latticeVector.map((value) => value / norm));
            const signedLength = glyph.strongestValue ?? 0;
            const component = vec3(direction.map(
              (value) => value * signedLength * this.forceScale,
            ));
            viewer.addArrow({
              start: xyz(site.cartesianPosition),
              end: xyz(add(site.cartesianPosition, component)),
              radius: 0.105,
              color: 0xff6f00,
            });
          }
        }
      }
    if (this.layers.constraints)
      for (const glyph of this.constraints)
        for (const site of frame.sites.filter(
          (candidate) =>
            candidate.siteIndex === glyph.siteIndex &&
            candidate.role === "primary",
        )) {
          const hasFixed = glyph.states.some((state) => state === false);
          const hasUnknown = glyph.states.some((state) => state === null);
          if (hasFixed || hasUnknown)
            viewer.addSphere({
              center: xyz(add(site.cartesianPosition, [0, 0, 0.62])),
              radius: 0.065,
              color: hasFixed ? 0xf85149 : 0x8b949e,
              wireframe: hasUnknown,
              opacity: 0.9,
            });
          if (!glyph.emphasized) continue;
          glyph.states.forEach((state, axis) => {
            const length = 0.52;
            const direction = glyph.directions[axis]!;
            const offset = vec3(direction.map((value) => value * length));
            const end = add(site.cartesianPosition, offset);
            if (state === true)
              viewer.addArrow({
                start: xyz(site.cartesianPosition),
                end: xyz(end),
                radius: 0.035,
                color: 0x2ea043,
                opacity: 1,
              });
            else if (state === false)
              viewer.addCylinder({
                start: xyz(add(end, axisVector((axis + 1) % 3, -0.1))),
                end: xyz(add(end, axisVector((axis + 1) % 3, 0.1))),
                radius: 0.055,
                color: 0xf85149,
              });
            else if (glyph.emphasized)
              viewer.addSphere({
                center: xyz(end),
                radius: 0.075,
                color: 0x8b949e,
                wireframe: true,
                opacity: 0.8,
              });
          });
        }
    // Volumetric payload interpretation is deliberately deferred; the typed layer remains isolated here.
    void this.volumetric;
    viewer.render();
  }

  private drawComparison(viewer: GLViewer, comparison: ComparisonScene): void {
    const drawFrame = (comparisonFrame: CrystalFrame, initial: boolean): void => {
      if (this.layers.cell) for (const edge of comparisonFrame.cellEdges)
        viewer.addCylinder({ start: xyz(edge.start), end: xyz(edge.end), radius: 0.025,
          color: initial ? 0x8b949e : 0xd1d5db, opacity: initial ? 0.35 : 1, dashed: initial });
      if (this.layers.bonds) for (const bond of comparisonFrame.bonds)
        viewer.addCylinder({ start: xyz(bond.start), end: xyz(bond.end), radius: 0.09,
          color: initial ? 0x8b949e : 0xb7bcc5, opacity: initial ? 0.35 : 1, dashed: initial,
          fromCap: "round", toCap: "round" });
      for (const site of comparisonFrame.sites) {
        const boundary = site.role === "boundary";
        const baseRadius = Math.min(0.52, Math.max(0.22, (covalentRadius(site.element) ?? 1.2) * 0.25));
        viewer.addSphere({ center: xyz(site.cartesianPosition), radius: boundary ? baseRadius * 0.78 : baseRadius,
          color: elementVisual(site.element).color, opacity: initial ? 0.35 : boundary ? 0.42 : 1,
          clickable: true, callback: () => this.selectCallback(site.siteIndex),
          hoverable: true, hover_callback: () => {
            this.hoveredSite = site.siteIndex;
            this.hoverCallback(site.siteIndex);
            this.draw();
          }, unhover_callback: () => {
            this.hoveredSite = null;
            this.hoverCallback(null);
            this.draw();
          } });
        if (site.siteIndex === this.selectedSite)
          viewer.addSphere({ center: xyz(site.cartesianPosition), radius: baseRadius + 0.09,
            color: 0xffd33d, opacity: 0.25, wireframe: true });
      }
    };
    drawFrame(comparison.initialFrame, true);
    drawFrame(comparison.targetFrame, false);
    if (this.layers.forces) for (const glyph of comparison.displacements) {
      if (!glyph.vector || Math.hypot(...glyph.vector) < 1e-12) continue;
      const vector = vec3(glyph.vector.map((value) => value * comparison.displacementScale));
      viewer.addArrow({ start: xyz(glyph.origin), end: xyz(add(glyph.origin, vector)), radius: 0.07, color: 0x00bcd4 });
    }
    if (this.layers.axes) for (const delta of comparison.cellDeltas)
      viewer.addArrow({ start: xyz(delta.start), end: xyz(delta.end), radius: 0.08, color: 0xff8c00 });
  }
}

export const createThreeDmolRenderer = (
  container: HTMLElement,
  viewerFactory: ViewerFactory = (element) =>
    createViewer(element, {
      backgroundColor: "#17191d",
      antialias: true,
      orthographic: false,
    }),
): CrystalRenderer => {
  const captured = captureConstructionResources(container, () =>
    viewerFactory(container),
  );
  return new ThreeDmolRenderer(captured.value, container, captured.dispose);
};
