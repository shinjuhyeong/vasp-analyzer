import type { Mat3, Vec3 } from "../core/contracts.js";

export type LatticeImage = readonly [number, number, number];
export type SupercellRepeat = readonly [number, number, number];
export type DirectionSemantics = "direct" | "plane-normal";
export type LayerName =
  | "cell"
  | "axes"
  | "bonds"
  | "forces"
  | "constraints"
  | "volumetric";

export interface RenderSite {
  readonly siteIndex: number;
  readonly element: string;
  readonly fractionalPosition: Vec3;
  readonly cartesianPosition: Vec3;
  readonly image: LatticeImage;
  readonly role: "primary" | "boundary";
}

export interface LineSegment {
  readonly start: Vec3;
  readonly end: Vec3;
}

export interface CellAxis extends LineSegment {
  readonly label: "a" | "b" | "c";
}

export interface PeriodicBond extends LineSegment {
  readonly fromSiteIndex: number;
  readonly toSiteIndex: number;
  readonly fromImage: LatticeImage;
  readonly toImage: LatticeImage;
}

export interface CrystalFrame {
  readonly lattice: Mat3;
  readonly sites: readonly RenderSite[];
  readonly cellEdges: readonly LineSegment[];
  readonly axes: readonly CellAxis[];
  readonly bonds: readonly PeriodicBond[];
}

export interface VectorGlyph {
  readonly siteIndex: number;
  readonly origin: Vec3;
  readonly vector: Vec3 | null;
  readonly strongestAxis: "x" | "y" | "z" | null;
}

export interface ConstraintGlyph {
  readonly siteIndex: number;
  readonly origin: Vec3;
  readonly states: readonly [boolean | null, boolean | null, boolean | null];
  readonly emphasized: boolean;
}

export interface VolumetricLayer {
  readonly id: string;
  readonly kind: "isosurface" | "slice";
  readonly lattice: Mat3;
  readonly payload: Readonly<unknown>;
  readonly opacity: number;
}

export interface CrystalRenderer {
  setStructure(frame: CrystalFrame): void;
  setForces(vectors: readonly VectorGlyph[]): void;
  setForceScale(scale: number): void;
  setConstraints(glyphs: readonly ConstraintGlyph[]): void;
  setSupercell(repeat: SupercellRepeat): void;
  setViewDirection(
    direction: readonly [number, number, number],
    semantics: DirectionSemantics,
  ): void;
  setOrthographic(enabled: boolean): void;
  setLayerVisible(layer: LayerName, visible: boolean): void;
  setVolumetricLayer(layer: VolumetricLayer | null): void;
  setSelectedSite(siteIndex: number | null): void;
  /** Coordinate/arrow update duration; zero disables motion. */
  setTransitionDuration?(durationMs: number): void;
  onSelectSite(callback: (siteIndex: number) => void): void;
  onHoverSite(callback: (siteIndex: number | null) => void): void;
  resetView(): void;
  resize(): void;
  dispose(): void;
}

export type CrystalRendererFactory = (
  container: HTMLElement,
) => CrystalRenderer;
