import type { CalculationDataset, LayoutPreferences, PersistedAnalysisState } from "./contracts.js";

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

export interface AnalysisState {
  readonly dataset: CalculationDataset | null;
  readonly selectedStep: number;
  readonly selectedSite: number | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly layout: LayoutPreferences;
}

export type AnalysisAction =
  | { readonly type: "datasetLoaded"; readonly dataset: CalculationDataset; readonly persisted?: PersistedAnalysisState }
  | { readonly type: "selectStep"; readonly step: number }
  | { readonly type: "selectSite"; readonly site: number | null }
  | { readonly type: "setForceMode"; readonly mode: "free" | "raw" }
  | { readonly type: "setForceScale"; readonly scale: number }
  | { readonly type: "setLayout"; readonly layout: Partial<LayoutPreferences> }
  | { readonly type: "resetLayout" };

export const initialAnalysisState: AnalysisState = {
  dataset: null,
  selectedStep: 0,
  selectedSite: null,
  forceMode: "free",
  forceScale: 10,
  layout: DEFAULT_LAYOUT,
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

function validSite(dataset: CalculationDataset, selectedStep: number, siteIndex: number | null): number | null {
  if (siteIndex === null) return null;
  const site = dataset.sites.find((candidate) => candidate.siteIndex === siteIndex);
  const step = dataset.ionicSteps[selectedStep];
  return site && step && step.cartesianPositions.length === dataset.sites.length ? siteIndex : null;
}

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case "datasetLoaded": {
      const step = clamp(action.persisted?.selectedStep ?? state.selectedStep, 0, Math.max(0, action.dataset.ionicSteps.length - 1));
      return {
        ...state,
        dataset: action.dataset,
        selectedStep: step,
        selectedSite: validSite(action.dataset, step, action.persisted?.selectedSite ?? state.selectedSite),
        forceMode: action.persisted?.forceMode ?? state.forceMode,
        forceScale: normalizeForceScale(action.persisted?.forceScale, state.forceScale),
        layout: action.persisted ? normalizeLayout(action.persisted.layout) : state.layout,
      };
    }
    case "selectStep": {
      const selectedStep = clamp(action.step, 0, Math.max(0, (state.dataset?.ionicSteps.length ?? 1) - 1));
      return {
        ...state,
        selectedStep,
        selectedSite: state.dataset ? validSite(state.dataset, selectedStep, state.selectedSite) : null,
      };
    }
    case "selectSite":
      return { ...state, selectedSite: state.dataset ? validSite(state.dataset, state.selectedStep, action.site) : null };
    case "setForceMode":
      return { ...state, forceMode: action.mode };
    case "setForceScale":
      return { ...state, forceScale: normalizeForceScale(action.scale, state.forceScale) };
    case "setLayout":
      return { ...state, layout: normalizeLayout(action.layout, state.layout) };
    case "resetLayout":
      return { ...state, layout: DEFAULT_LAYOUT };
  }
}
