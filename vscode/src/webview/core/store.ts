import type { CalculationDataset, PersistedAnalysisState } from "./contracts.js";

export interface AnalysisState {
  readonly dataset: CalculationDataset | null;
  readonly selectedStep: number;
  readonly selectedSite: number | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
}

export type AnalysisAction =
  | { readonly type: "datasetLoaded"; readonly dataset: CalculationDataset; readonly persisted?: PersistedAnalysisState }
  | { readonly type: "selectStep"; readonly step: number }
  | { readonly type: "selectSite"; readonly site: number | null }
  | { readonly type: "setForceMode"; readonly mode: "free" | "raw" }
  | { readonly type: "setForceScale"; readonly scale: number };

export const initialAnalysisState: AnalysisState = {
  dataset: null,
  selectedStep: 0,
  selectedSite: null,
  forceMode: "free",
  forceScale: 1,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
      return { ...state, forceScale: clamp(action.scale, 0.1, 10) };
  }
}
