import { createViewer, elementColors, type GLViewer } from "3dmol";

import type { Vec3 } from "../core/contracts.js";
import type {
  ConstraintGlyph,
  CrystalFrame,
  CrystalRenderer,
  DirectionSemantics,
  LayerName,
  SupercellRepeat,
  VectorGlyph,
  VolumetricLayer,
} from "./CrystalRenderer.js";
import {
  covalentRadius,
  crystallographicViewVector,
} from "../features/structure/scene.js";

const xyz = (value: Vec3) => ({ x: value[0], y: value[1], z: value[2] });
const axisVector = (axis: number, length: number): Vec3 =>
  Object.freeze([
    axis === 0 ? length : 0,
    axis === 1 ? length : 0,
    axis === 2 ? length : 0,
  ]);
const add = (left: Vec3, right: Vec3): Vec3 =>
  Object.freeze([left[0] + right[0], left[1] + right[1], left[2] + right[2]]);

function elementColor(element: string): number | string {
  const jmol = (
    elementColors as unknown as { Jmol?: Record<string, number | string> }
  ).Jmol;
  return jmol?.[element] ?? 0x9aa0a6;
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

export class ThreeDmolRenderer implements CrystalRenderer {
  private frame: CrystalFrame | null = null;
  private forces: readonly VectorGlyph[] = [];
  private constraints: readonly ConstraintGlyph[] = [];
  private forceScale = 1;
  private selectedSite: number | null = null;
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
  private fitted = false;
  private disposed = false;

  constructor(
    private viewer: GLViewer | null,
    private readonly container: HTMLElement,
  ) {}

  setStructure(frame: CrystalFrame): void {
    this.frame = frame;
    this.draw();
    if (!this.fitted) {
      this.viewer?.zoomTo();
      this.viewer?.render();
      this.fitted = true;
    }
  }
  setForces(vectors: readonly VectorGlyph[]): void {
    this.forces = vectors;
    this.draw();
  }
  setForceScale(scale: number): void {
    this.forceScale = Number.isFinite(scale) ? Math.max(0, scale) : 1;
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
  onSelectSite(callback: (siteIndex: number) => void): void {
    this.selectCallback = callback;
  }
  onHoverSite(callback: (siteIndex: number | null) => void): void {
    this.hoverCallback = callback;
  }
  resetView(): void {
    this.viewer?.zoomTo();
    this.viewer?.render();
  }
  resize(): void {
    this.viewer?.resize();
    this.viewer?.render();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.selectCallback = () => undefined;
    this.hoverCallback = () => undefined;
    this.viewer?.clear();
    this.viewer = null;
    this.container.replaceChildren();
  }

  private draw(): void {
    const viewer = this.viewer,
      frame = this.frame;
    if (!viewer || !frame || this.disposed) return;
    viewer.removeAllShapes();
    viewer.removeAllLabels();
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
      const baseRadius = Math.min(
        0.52,
        Math.max(0.22, (covalentRadius(site.element) ?? 1.2) * 0.25),
      );
      viewer.addSphere({
        center: xyz(site.cartesianPosition),
        radius: baseRadius,
        color: elementColor(site.element),
        opacity: 1,
        clickable: true,
        callback: () => this.selectCallback(site.siteIndex),
        hoverable: true,
        hover_callback: () => this.hoverCallback(site.siteIndex),
        unhover_callback: () => this.hoverCallback(null),
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
    if (this.layers.forces)
      for (const glyph of this.forces) {
        if (!glyph.vector || Math.hypot(...glyph.vector) < 1e-12) continue;
        for (const site of frame.sites.filter(
          (candidate) => candidate.siteIndex === glyph.siteIndex,
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
            const axis = { x: 0, y: 1, z: 2 }[glyph.strongestAxis];
            const component = axisVector(
              axis,
              glyph.vector[axis]! * this.forceScale,
            );
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
      for (const glyph of this.constraints.filter(
        (item) =>
          item.emphasized || item.states.some((state) => state === false),
      ))
        for (const site of frame.sites.filter(
          (candidate) => candidate.siteIndex === glyph.siteIndex,
        )) {
          glyph.states.forEach((state, axis) => {
            const length = glyph.emphasized ? 0.52 : 0.3;
            const end = add(site.cartesianPosition, axisVector(axis, length));
            if (state === true)
              viewer.addArrow({
                start: xyz(site.cartesianPosition),
                end: xyz(end),
                radius: 0.035,
                color: 0x2ea043,
                opacity: glyph.emphasized ? 1 : 0.55,
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
}

export const createThreeDmolRenderer = (
  container: HTMLElement,
): CrystalRenderer => {
  const viewer = createViewer(container, {
    backgroundColor: "#17191d",
    antialias: true,
    orthographic: false,
  });
  return new ThreeDmolRenderer(viewer, container);
};
