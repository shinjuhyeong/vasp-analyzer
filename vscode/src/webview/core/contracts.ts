import type { DATASET_SCHEMA_VERSION } from "./schema.js";

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [Vec3, Vec3, Vec3];

export interface SourceFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeNs: number;
  readonly fingerprint: string;
}

export interface SelectiveMask {
  readonly a: boolean | null;
  readonly b: boolean | null;
  readonly c: boolean | null;
}

export interface Site {
  readonly siteIndex: number;
  readonly element: string;
  readonly initialFractionalPosition: Vec3;
  readonly initialCartesianPosition: Vec3;
  readonly selectiveDynamics: SelectiveMask;
}

export interface InitialStructure {
  readonly source: "POSCAR";
  readonly lattice: Mat3;
  readonly fractionalPositions: readonly Vec3[];
  readonly cartesianPositions: readonly Vec3[];
}

export interface ForceComponent {
  readonly siteIndex: number;
  readonly axis: "a" | "b" | "c";
  readonly value: number;
  readonly magnitude: number;
}

export interface EnergyTerm {
  readonly key: string;
  readonly rawLabel: string;
  readonly value: number;
  readonly unit: "eV";
  readonly kind: "contribution" | "aggregate";
}

export type ParameterValue = boolean | number | string | readonly number[];

export interface ParameterOccurrence {
  readonly key: string;
  readonly rawKey: string;
  readonly rawValue: string;
  readonly value: ParameterValue;
  readonly unit: string | null;
  readonly category: string | null;
  readonly description: string | null;
  readonly ordinal: number;
  readonly lineNumber: number | null;
}

export interface IonicStep {
  readonly index: number;
  readonly lattice: Mat3;
  readonly fractionalPositions: readonly Vec3[];
  readonly cartesianPositions: readonly Vec3[];
  readonly rawForces: readonly Vec3[];
  readonly freeForces: readonly Vec3[] | null;
  readonly freeForceNorms: readonly number[] | null;
  readonly totalEnergy: number | null;
  readonly energyTerms: readonly EnergyTerm[];
  readonly externalPressureKb: number | null;
  readonly pulayStressKb: number | null;
  readonly stressTensorKb: Mat3 | null;
  readonly cellVolume: number | null;
  readonly deltaEnergy: number | null;
  readonly scfIterations: number | null;
  readonly electronicConverged: boolean | null;
  readonly ionicConverged: boolean | null;
  readonly strongestFreeComponent: ForceComponent | null;
  readonly rmsFreeForce: number | null;
}

export interface Capability {
  readonly name: "structure" | "convergence" | "dos" | "band" | "charge";
  readonly available: boolean;
  readonly reason: string | null;
}

export interface ParserWarning {
  readonly category: "IncompleteTail" | "IgnoredCompatibilityMetadata" | "GrowingFileParseFailure" | "MetadataParseFailure";
  readonly message: string;
  readonly byteOffset: number | null;
  readonly lineNumber: number | null;
}

export interface ParserProvenance {
  readonly adapter: string;
  readonly adapterVersion: string;
  readonly dialect: string;
  readonly profileId: string | null;
  readonly normalizationRules: readonly string[];
  readonly compatibilityMetadata: readonly string[];
  readonly normalizerId: string | null;
  readonly normalizerDisplayName: string | null;
  readonly normalizerSchemaVersion: number | null;
  readonly normalizerDefinitionSha256: string | null;
  readonly normalizationChangedLineCount: number;
  readonly normalizationManifestReference: string | null;
  readonly normalizationWarnings: readonly string[];
}

export interface NormalizationChange {
  readonly sourceLine: number;
  readonly ruleId: string;
  readonly originalExcerpt: string;
  readonly emittedExcerpt: string;
}

export interface NormalizationManifest {
  readonly manifestReference: string;
  readonly normalizerId: string;
  readonly displayName: string;
  readonly schemaVersion: number;
  readonly definitionSha256: string;
  readonly sourceSha256: string;
  readonly sourceSize: number;
  readonly sourceMtimeNs: number;
  readonly changedLineCount: number;
  readonly firstChangedLine: number | null;
  readonly lastChangedLine: number | null;
  readonly ruleChangedLineCounts: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly changes: readonly NormalizationChange[];
}

export interface NormalizedOutcar {
  readonly manifestReference: string;
  readonly content: string;
}

export interface CalculationDataset {
  readonly schemaVersion: typeof DATASET_SCHEMA_VERSION;
  readonly root: string;
  readonly sourceFiles: readonly SourceFile[];
  readonly sites: readonly Site[];
  readonly initialStructure: InitialStructure | null;
  readonly ionicSteps: readonly IonicStep[];
  readonly parameters: readonly ParameterOccurrence[];
  readonly capabilities: readonly Capability[];
  readonly warnings: readonly ParserWarning[];
  readonly provenance: ParserProvenance | null;
}

export type AnalysisMethod = "getDataset" | "getStep" | "getNormalizationManifest" | "getNormalizedOutcar";
export type AnalysisResult = CalculationDataset | IonicStep | NormalizationManifest | NormalizedOutcar;

export interface LayoutPreferences {
  readonly structurePercent: number;
  readonly inspectorWidth: number;
  readonly inspectorCollapsed: boolean;
  readonly paletteX: number;
  readonly paletteY: number;
  readonly paletteCollapsed: boolean;
}

export type AnalysisModuleId = "energy" | "force" | "cellStress";
export type ModuleMode = "graph" | "table";
export type EnergyMetric = "totalEnergy" | "deltaEnergy";
export type ForceMetric = "strongestFreeComponent" | "rmsFreeForce";
export type CellStressMetric = "externalPressure" | "cellVolume";
export type AnalysisMetric = EnergyMetric | ForceMetric | CellStressMetric;

export interface ConvergencePreferences {
  readonly selectedModules: readonly AnalysisModuleId[];
  readonly metrics: Readonly<{
    energy: EnergyMetric;
    force: ForceMetric;
    cellStress: CellStressMetric;
  }>;
  readonly modes: Readonly<Record<AnalysisModuleId, ModuleMode>>;
}

export type FrameSelection =
  | Readonly<{ kind: "initial" }>
  | Readonly<{ kind: "ionic"; index: number }>;

export interface PersistedAnalysisState {
  readonly version: 4;
  readonly selectedFrame: FrameSelection;
  readonly comparisonTarget: number;
  readonly displacementScale: number;
  readonly selectedSite: number | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly layout: LayoutPreferences;
  readonly convergence: ConvergencePreferences;
}

export interface LegacyPersistedAnalysisState {
  readonly selectedStep: number;
  readonly selectedSite: number | null;
}

export interface AnalysisHost {
  request(method: AnalysisMethod, params: Readonly<Record<string, unknown>>): Promise<AnalysisResult>;
  getState(): PersistedAnalysisState | undefined;
  setState(state: PersistedAnalysisState): void;
}
