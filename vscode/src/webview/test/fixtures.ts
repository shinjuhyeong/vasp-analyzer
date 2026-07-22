import type {
  AnalysisHost,
  CalculationDataset,
  IonicStep,
  LegacyPersistedAnalysisState,
  PersistedAnalysisState,
} from "../core/contracts.js";
import { DEFAULT_CONVERGENCE, DEFAULT_LAYOUT } from "../core/store.js";

const step = (index: number): IonicStep => ({
  index,
  lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
  fractionalPositions: [[0, 0, 0], [0.5, 0.5, 0.5]],
  cartesianPositions: [[0, 0, 0], [1.5, 1.5, 1.5]],
  rawForces: [[0.1, 0, 0], [0, -0.2, 0]],
  freeForces: [[0.1, 0, 0], [0, 0, 0]],
  freeForceNorms: [0.1, 0],
  totalEnergy: -10 - index,
  energyTerms: [],
  externalPressureKb: null,
  pulayStressKb: null,
  stressTensorKb: null,
  cellVolume: 27,
  deltaEnergy: index === 0 ? null : -1,
  scfIterations: 8,
  electronicConverged: true,
  ionicConverged: index === 1,
  strongestFreeComponent: { siteIndex: 0, axis: "a", value: 0.1, magnitude: 0.1 },
  rmsFreeForce: 0.11,
});

export const twoStepDataset: CalculationDataset = {
  schemaVersion: 3,
  root: "/calculation",
  sourceFiles: [],
  sites: [
    { siteIndex: 0, element: "Cu", initialFractionalPosition: [0, 0, 0], initialCartesianPosition: [0, 0, 0], selectiveDynamics: { a: true, b: true, c: true } },
    { siteIndex: 1, element: "O", initialFractionalPosition: [0.5, 0.5, 0.5], initialCartesianPosition: [1.5, 1.5, 1.5], selectiveDynamics: { a: true, b: false, c: true } },
  ],
  initialStructure: null,
  ionicSteps: [step(0), step(1)],
  parameters: [],
  capabilities: [
    { name: "structure", available: true, reason: null },
    { name: "convergence", available: true, reason: null },
    { name: "dos", available: false, reason: "Requires DOSCAR or vasprun.xml parser" },
    { name: "band", available: false, reason: "Requires EIGENVAL parser" },
    { name: "charge", available: false, reason: "Requires CHGCAR parser" },
  ],
  warnings: [],
  provenance: null,
};

export class MemoryHost implements AnalysisHost {
  state: PersistedAnalysisState | undefined;

  constructor(
    readonly dataset: CalculationDataset = twoStepDataset,
    state?: PersistedAnalysisState | LegacyPersistedAnalysisState,
  ) {
    this.state = state === undefined
      ? undefined
      : "version" in state
        ? state
        : {
            version: 4,
            selectedFrame: { kind: "ionic", index: state.selectedStep },
            comparisonTarget: 0,
            displacementScale: 10,
            selectedSite: state.selectedSite,
            forceMode: "free",
            forceScale: 10,
            layout: DEFAULT_LAYOUT,
            convergence: DEFAULT_CONVERGENCE,
          };
  }

  async request(method: "getDataset" | "getStep", params: Readonly<Record<string, unknown>>): Promise<CalculationDataset | IonicStep> {
    if (method === "getDataset") return this.dataset;
    return this.dataset.ionicSteps[Number(params.stepIndex)] ?? Promise.reject(new Error("missing step"));
  }

  getState(): PersistedAnalysisState | undefined {
    return this.state;
  }

  setState(state: PersistedAnalysisState): void {
    this.state = state;
  }
}
