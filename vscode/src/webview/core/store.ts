import type {
  AnalysisMetric,
  AnalysisModuleId,
  CalculationDataset,
  ConvergencePreferences,
  FrameSelection,
  LayoutPreferences,
  ModuleMode,
  PersistedAnalysisState,
} from "./contracts.js";

export const MIN_FORCE_SCALE = 1;
export const MAX_FORCE_SCALE = 1000;
export const MIN_STRUCTURE_PERCENT = 30;
export const MAX_STRUCTURE_PERCENT = 95;
export const MIN_INSPECTOR_WIDTH = 220;
export const MAX_INSPECTOR_WIDTH = 480;

export const DEFAULT_LAYOUT: LayoutPreferences = Object.freeze({
  structurePercent: 60,
  inspectorWidth: 280,
  inspectorCollapsed: true,
  paletteX: 10,
  paletteY: 10,
  paletteCollapsed: true,
});

export const ANALYSIS_MODULES: readonly AnalysisModuleId[] = Object.freeze([
  "energy",
  "force",
  "cellStress",
]);

export const DEFAULT_CONVERGENCE: ConvergencePreferences = Object.freeze({
  selectedModules: Object.freeze(["energy"] as const),
  metrics: Object.freeze({
    energy: "totalEnergy",
    force: "strongestFreeComponent",
    cellStress: "externalPressure",
  }),
  modes: Object.freeze({ energy: "graph", force: "graph", cellStress: "graph" }),
});

export interface AnalysisState {
  readonly dataset: CalculationDataset | null;
  readonly selectedFrame: FrameSelection;
  /** Compatibility projection for the ionic-only UI until frame controls are wired. */
  readonly selectedStep: number;
  readonly comparisonTarget: number;
  readonly compareEnabled: boolean;
  readonly displacementScale: number;
  readonly selectedSite: number | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly layout: LayoutPreferences;
  readonly convergence: ConvergencePreferences;
}

export type AnalysisAction =
  | { readonly type: "datasetLoaded"; readonly dataset: CalculationDataset; readonly persisted?: PersistedAnalysisState }
  | { readonly type: "selectFrame"; readonly frame: FrameSelection }
  | { readonly type: "selectStep"; readonly step: number }
  | { readonly type: "setCompareEnabled"; readonly enabled: boolean }
  | { readonly type: "setComparisonTarget"; readonly target: number }
  | { readonly type: "setDisplacementScale"; readonly scale: number }
  | { readonly type: "selectSite"; readonly site: number | null }
  | { readonly type: "setForceMode"; readonly mode: "free" | "raw" }
  | { readonly type: "setForceScale"; readonly scale: number }
  | { readonly type: "setLayout"; readonly layout: Partial<LayoutPreferences> }
  | { readonly type: "setModules"; readonly modules: readonly unknown[] }
  | { readonly type: "setModuleMetric"; readonly module: AnalysisModuleId; readonly metric: AnalysisMetric }
  | { readonly type: "setModuleMode"; readonly module: AnalysisModuleId; readonly mode: ModuleMode }
  | { readonly type: "resetLayout" };

export const initialAnalysisState: AnalysisState = {
  dataset: null,
  selectedFrame: { kind: "ionic", index: 0 },
  selectedStep: 0,
  comparisonTarget: 0,
  compareEnabled: false,
  displacementScale: 10,
  selectedSite: null,
  forceMode: "free",
  forceScale: 10,
  layout: DEFAULT_LAYOUT,
  convergence: DEFAULT_CONVERGENCE,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeForceScale(value: number | undefined, fallback = 10): number {
  return clamp(
    finiteOr(value, finiteOr(fallback, 10)),
    MIN_FORCE_SCALE,
    MAX_FORCE_SCALE,
  );
}

function normalizeScale(value: number | undefined, fallback = 10): number {
  return clamp(finiteOr(value, finiteOr(fallback, 10)), 1, 1000);
}

function normalizeIonicIndex(dataset: CalculationDataset, value: number): number {
  return clamp(Number.isSafeInteger(value) ? value : 0, 0, Math.max(0, dataset.ionicSteps.length - 1));
}

function normalizeFrame(dataset: CalculationDataset, frame: FrameSelection): FrameSelection {
  if (frame.kind === "initial" && dataset.initialStructure !== null) return { kind: "initial" };
  return { kind: "ionic", index: normalizeIonicIndex(dataset, frame.kind === "ionic" ? frame.index : 0) };
}

export function normalizeLayout(
  layout: Partial<LayoutPreferences> | undefined,
  fallback: LayoutPreferences = DEFAULT_LAYOUT,
): LayoutPreferences {
  return {
    structurePercent: clamp(finiteOr(layout?.structurePercent, fallback.structurePercent), MIN_STRUCTURE_PERCENT, MAX_STRUCTURE_PERCENT),
    inspectorWidth: clamp(finiteOr(layout?.inspectorWidth, fallback.inspectorWidth), MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH),
    inspectorCollapsed: typeof layout?.inspectorCollapsed === "boolean" ? layout.inspectorCollapsed : fallback.inspectorCollapsed,
    paletteX: Math.max(0, finiteOr(layout?.paletteX, fallback.paletteX)),
    paletteY: Math.max(0, finiteOr(layout?.paletteY, fallback.paletteY)),
    paletteCollapsed: typeof layout?.paletteCollapsed === "boolean" ? layout.paletteCollapsed : fallback.paletteCollapsed,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeModules(value: unknown): readonly AnalysisModuleId[] {
  const requested = Array.isArray(value) ? new Set(value) : new Set<unknown>();
  const selected = ANALYSIS_MODULES.filter((module) => requested.has(module));
  return selected.length === 0 ? ["energy"] : selected;
}

function energyMetric(value: unknown): ConvergencePreferences["metrics"]["energy"] {
  return value === "deltaEnergy" ? value : "totalEnergy";
}

function forceMetric(value: unknown): ConvergencePreferences["metrics"]["force"] {
  return value === "rmsFreeForce" ? value : "strongestFreeComponent";
}

function cellStressMetric(value: unknown): ConvergencePreferences["metrics"]["cellStress"] {
  return value === "cellVolume" ? value : "externalPressure";
}

function moduleMode(value: unknown): ModuleMode {
  return value === "table" ? value : "graph";
}

export function normalizeConvergence(value: unknown): ConvergencePreferences {
  const convergence = record(value);
  const metrics = record(convergence?.metrics);
  const modes = record(convergence?.modes);
  return {
    selectedModules: normalizeModules(convergence?.selectedModules),
    metrics: {
      energy: energyMetric(metrics?.energy),
      force: forceMetric(metrics?.force),
      cellStress: cellStressMetric(metrics?.cellStress),
    },
    modes: {
      energy: moduleMode(modes?.energy),
      force: moduleMode(modes?.force),
      cellStress: moduleMode(modes?.cellStress),
    },
  };
}

function metricForModule(module: AnalysisModuleId, metric: unknown): AnalysisMetric | undefined {
  if (module === "energy" && (metric === "totalEnergy" || metric === "deltaEnergy")) return metric;
  if (module === "force" && (metric === "strongestFreeComponent" || metric === "rmsFreeForce")) return metric;
  if (module === "cellStress" && (metric === "externalPressure" || metric === "cellVolume")) return metric;
  return undefined;
}

function isAnalysisModule(module: unknown): module is AnalysisModuleId {
  return ANALYSIS_MODULES.some((candidate) => candidate === module);
}

function validSite(dataset: CalculationDataset, selectedFrame: FrameSelection, siteIndex: number | null): number | null {
  if (siteIndex === null) return null;
  const site = dataset.sites.find((candidate) => candidate.siteIndex === siteIndex);
  const positions = selectedFrame.kind === "initial"
    ? dataset.initialStructure?.cartesianPositions
    : dataset.ionicSteps[selectedFrame.index]?.cartesianPositions;
  return site && positions?.length === dataset.sites.length ? siteIndex : null;
}

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case "datasetLoaded": {
      const selectedFrame = normalizeFrame(action.dataset, action.persisted?.selectedFrame ?? state.selectedFrame);
      const selectedStep = selectedFrame.kind === "ionic" ? selectedFrame.index : state.selectedStep;
      return {
        ...state,
        dataset: action.dataset,
        selectedFrame,
        selectedStep,
        comparisonTarget: normalizeIonicIndex(action.dataset, action.persisted?.comparisonTarget ?? state.comparisonTarget),
        compareEnabled: selectedFrame.kind === "initial" ? state.compareEnabled : false,
        displacementScale: normalizeScale(action.persisted?.displacementScale, state.displacementScale),
        selectedSite: validSite(action.dataset, selectedFrame, action.persisted?.selectedSite ?? state.selectedSite),
        forceMode: action.persisted?.forceMode ?? state.forceMode,
        forceScale: normalizeForceScale(action.persisted?.forceScale, state.forceScale),
        layout: action.persisted ? normalizeLayout(action.persisted.layout) : state.layout,
        convergence: action.persisted ? normalizeConvergence(action.persisted.convergence) : state.convergence,
      };
    }
    case "selectFrame": {
      const selectedFrame = state.dataset ? normalizeFrame(state.dataset, action.frame) : action.frame;
      const selectedStep = selectedFrame.kind === "ionic" ? selectedFrame.index : state.selectedStep;
      return { ...state, selectedFrame, selectedStep,
        compareEnabled: selectedFrame.kind === "initial" ? state.compareEnabled : false,
        selectedSite: state.dataset ? validSite(state.dataset, selectedFrame, state.selectedSite) : null };
    }
    case "selectStep": {
      const selectedStep = clamp(action.step, 0, Math.max(0, (state.dataset?.ionicSteps.length ?? 1) - 1));
      const selectedFrame = { kind: "ionic", index: selectedStep } as const;
      return {
        ...state,
        selectedFrame,
        selectedStep,
        compareEnabled: false,
        selectedSite: state.dataset ? validSite(state.dataset, selectedFrame, state.selectedSite) : null,
      };
    }
    case "setCompareEnabled":
      return { ...state, compareEnabled: state.selectedFrame.kind === "initial" && action.enabled };
    case "setComparisonTarget":
      return { ...state, comparisonTarget: state.dataset
        ? normalizeIonicIndex(state.dataset, action.target)
        : Math.max(0, Number.isSafeInteger(action.target) ? action.target : state.comparisonTarget) };
    case "setDisplacementScale":
      return { ...state, displacementScale: normalizeScale(action.scale, state.displacementScale) };
    case "selectSite":
      return { ...state, selectedSite: state.dataset ? validSite(state.dataset, state.selectedFrame, action.site) : null };
    case "setForceMode":
      return { ...state, forceMode: action.mode };
    case "setForceScale":
      return { ...state, forceScale: normalizeForceScale(action.scale, state.forceScale) };
    case "setLayout":
      return { ...state, layout: normalizeLayout(action.layout, state.layout) };
    case "setModules":
      return {
        ...state,
        convergence: { ...state.convergence, selectedModules: normalizeModules(action.modules) },
      };
    case "setModuleMetric": {
      const metric = metricForModule(action.module, action.metric);
      if (!metric) return state;
      return {
        ...state,
        convergence: {
          ...state.convergence,
          metrics: { ...state.convergence.metrics, [action.module]: metric },
        },
      };
    }
    case "setModuleMode":
      if (!isAnalysisModule(action.module) || (action.mode !== "graph" && action.mode !== "table")) return state;
      return {
        ...state,
        convergence: {
          ...state.convergence,
          modes: { ...state.convergence.modes, [action.module]: action.mode },
        },
      };
    case "resetLayout":
      return { ...state, layout: DEFAULT_LAYOUT };
  }
}
