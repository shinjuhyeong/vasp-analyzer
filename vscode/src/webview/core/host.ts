import type {
  AnalysisHost,
  AnalysisMethod,
  AnalysisResult,
  CalculationDataset,
  IonicStep,
  LayoutPreferences,
  NormalizationManifest,
  NormalizedOutcar,
  PersistedAnalysisState,
} from "./contracts.js";
import {
  DEFAULT_LAYOUT,
  DEFAULT_CONVERGENCE,
  MAX_FORCE_SCALE,
  MIN_FORCE_SCALE,
  normalizeLayout,
  normalizeConvergence,
} from "./store.js";
import { DATASET_SCHEMA_VERSION } from "./schema.js";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: PersistedAnalysisState): void;
}

interface EventTargetLike {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

interface PendingRequest {
  readonly method: AnalysisMethod;
  readonly resolve: (value: AnalysisResult) => void;
  readonly reject: (reason: Error) => void;
}

interface ProtocolErrorShape {
  readonly code: string;
  readonly message: string;
}

const INVALID_RESPONSE_MESSAGE = "Analyzer returned an invalid response";
const MAX_NORMALIZATION_CHANGES = 10_000;
const MAX_NORMALIZED_OUTCAR_BYTES = 64 * 1024 * 1024;

function invalidResponse(): HostRequestError {
  return new HostRequestError("invalid_response", INVALID_RESPONSE_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnProperties(value: Record<string, unknown>, properties: readonly string[]): boolean {
  const allowed = new Set(properties);
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === allowed.size
    && ownKeys.every((key) => typeof key === "string" && allowed.has(key));
}

function isRecordWith(value: unknown, properties: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && hasExactOwnProperties(value, properties);
}

function isDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function isArrayOf(value: unknown, guard: (item: unknown) => boolean): value is readonly unknown[] {
  if (!isDenseArray(value)) return false;
  for (const item of value) {
    if (!guard(item)) return false;
  }
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullable<T>(value: unknown, guard: (candidate: unknown) => candidate is T): value is T | null {
  return value === null || guard(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return isArrayOf(value, (item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVec3(value: unknown): boolean {
  return isDenseArray(value) && value.length === 3 && isArrayOf(value, isFiniteNumber);
}

function isMat3(value: unknown): boolean {
  return isDenseArray(value) && value.length === 3 && isArrayOf(value, isVec3);
}

function determinant(matrix: readonly (readonly number[])[]): number {
  const [a, b, c] = matrix;
  return a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!)
    - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!)
    + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!);
}

function isVec3Array(value: unknown): boolean {
  return isArrayOf(value, isVec3);
}

function isSourceFile(value: unknown): boolean {
  return isRecordWith(value, ["path", "size", "mtimeNs", "fingerprint"])
    && typeof value.path === "string"
    && isNonNegativeInteger(value.size)
    && isNonNegativeInteger(value.mtimeNs)
    && typeof value.fingerprint === "string";
}

function isSite(value: unknown): boolean {
  if (!isRecordWith(value, ["siteIndex", "element", "initialFractionalPosition", "initialCartesianPosition", "selectiveDynamics"])
    || !isRecordWith(value.selectiveDynamics, ["a", "b", "c"])) return false;
  const mask = value.selectiveDynamics;
  return isNonNegativeInteger(value.siteIndex)
    && typeof value.element === "string"
    && isVec3(value.initialFractionalPosition)
    && isVec3(value.initialCartesianPosition)
    && [mask.a, mask.b, mask.c].every((item) => item === null || typeof item === "boolean");
}

function isInitialStructure(value: unknown): boolean {
  if (!isRecordWith(value, ["source", "lattice", "fractionalPositions", "cartesianPositions"])
    || value.source !== "POSCAR"
    || !isMat3(value.lattice)
    || Math.abs(determinant(value.lattice as readonly (readonly number[])[])) < 1e-12
    || !isVec3Array(value.fractionalPositions)
    || !isVec3Array(value.cartesianPositions)) return false;
  return (value.fractionalPositions as readonly unknown[]).length
    === (value.cartesianPositions as readonly unknown[]).length;
}

function isForceComponent(value: unknown): boolean {
  return isRecordWith(value, ["siteIndex", "axis", "value", "magnitude"])
    && isNonNegativeInteger(value.siteIndex)
    && (value.axis === "a" || value.axis === "b" || value.axis === "c")
    && isFiniteNumber(value.value)
    && isFiniteNumber(value.magnitude);
}

function isEnergyTerm(value: unknown): boolean {
  return isRecordWith(value, ["key", "rawLabel", "value", "unit", "kind"])
    && isNonEmptyString(value.key)
    && isNonEmptyString(value.rawLabel)
    && isFiniteNumber(value.value)
    && value.unit === "eV"
    && (value.kind === "contribution" || value.kind === "aggregate");
}

function isParameterValue(value: unknown): boolean {
  return typeof value === "boolean"
    || typeof value === "string"
    || isFiniteNumber(value)
    || isArrayOf(value, isFiniteNumber);
}

function isOptionalString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isParameterOccurrence(value: unknown): boolean {
  return isRecordWith(value, [
    "key", "rawKey", "rawValue", "value", "unit", "category", "description", "ordinal", "lineNumber",
  ])
    && isNonEmptyString(value.key)
    && isNonEmptyString(value.rawKey)
    && isNonEmptyString(value.rawValue)
    && isParameterValue(value.value)
    && isOptionalString(value.unit)
    && isOptionalString(value.category)
    && isOptionalString(value.description)
    && isNonNegativeInteger(value.ordinal)
    && isNullable(value.lineNumber, isNonNegativeInteger);
}

function isIonicStep(value: unknown): value is IonicStep {
  if (!isRecordWith(value, [
    "index", "lattice", "fractionalPositions", "cartesianPositions", "rawForces",
    "freeForces", "freeForceNorms", "totalEnergy", "energyTerms", "externalPressureKb",
    "pulayStressKb", "stressTensorKb", "cellVolume", "deltaEnergy", "scfIterations",
    "electronicConverged", "ionicConverged", "strongestFreeComponent", "rmsFreeForce",
  ])
    || !isNonNegativeInteger(value.index)
    || !isMat3(value.lattice)
    || !isVec3Array(value.fractionalPositions)
    || !isVec3Array(value.cartesianPositions)
    || !isVec3Array(value.rawForces)
    || !isNullable(value.freeForces, (item): item is readonly unknown[] => isVec3Array(item))
    || !isNullable(value.freeForceNorms, (item): item is readonly number[] => isArrayOf(item, isFiniteNumber))
    || !isNullable(value.totalEnergy, isFiniteNumber)
    || !isArrayOf(value.energyTerms, isEnergyTerm)
    || !isNullable(value.externalPressureKb, isFiniteNumber)
    || !isNullable(value.pulayStressKb, isFiniteNumber)
    || !isNullable(value.stressTensorKb, (item): item is readonly unknown[] => isMat3(item))
    || !isNullable(value.cellVolume, (item): item is number => isFiniteNumber(item) && item > 0)
    || !isNullable(value.deltaEnergy, isFiniteNumber)
    || !isNullable(value.scfIterations, isNonNegativeInteger)
    || !isNullable(value.electronicConverged, (item): item is boolean => typeof item === "boolean")
    || !isNullable(value.ionicConverged, (item): item is boolean => typeof item === "boolean")
    || !isNullable(value.strongestFreeComponent, (item): item is Record<string, unknown> => isForceComponent(item))
    || !isNullable(value.rmsFreeForce, isFiniteNumber)) return false;

  const cartesianPositions = value.cartesianPositions as readonly unknown[];
  const fractionalPositions = value.fractionalPositions as readonly unknown[];
  const rawForces = value.rawForces as readonly unknown[];
  const freeForces = value.freeForces as readonly unknown[] | null;
  const freeForceNorms = value.freeForceNorms as readonly unknown[] | null;
  const count = cartesianPositions.length;
  return fractionalPositions.length === count
    && rawForces.length === count
    && (freeForces === null || freeForces.length === count)
    && (freeForceNorms === null || freeForceNorms.length === count);
}

function isCapability(value: unknown): boolean {
  const names = ["structure", "convergence", "dos", "band", "charge"];
  return isRecordWith(value, ["name", "available", "reason"])
    && typeof value.name === "string" && names.includes(value.name)
    && typeof value.available === "boolean"
    && (value.reason === null || typeof value.reason === "string");
}

function isWarning(value: unknown): boolean {
  return isRecordWith(value, ["category", "message", "byteOffset", "lineNumber"])
    && (
      value.category === "IncompleteTail"
      || value.category === "IgnoredCompatibilityMetadata"
      || value.category === "GrowingFileParseFailure"
      || value.category === "MetadataParseFailure"
    )
    && typeof value.message === "string"
    && isNullable(value.byteOffset, isNonNegativeInteger)
    && isNullable(value.lineNumber, isNonNegativeInteger);
}

function isProvenance(value: unknown): boolean {
  return isRecordWith(value, [
    "adapter", "adapterVersion", "dialect", "profileId", "normalizationRules", "compatibilityMetadata",
    "normalizerId", "normalizerDisplayName", "normalizerSchemaVersion", "normalizerDefinitionSha256",
    "normalizationChangedLineCount", "normalizationManifestReference", "normalizationWarnings",
  ])
    && typeof value.adapter === "string"
    && typeof value.adapterVersion === "string"
    && typeof value.dialect === "string"
    && (value.profileId === null || typeof value.profileId === "string")
    && isStringArray(value.normalizationRules)
    && isStringArray(value.compatibilityMetadata)
    && isNullable(value.normalizerId, (item): item is string => typeof item === "string")
    && isNullable(value.normalizerDisplayName, (item): item is string => typeof item === "string")
    && isNullable(value.normalizerSchemaVersion, isNonNegativeInteger)
    && isNullable(value.normalizerDefinitionSha256, (item): item is string => typeof item === "string")
    && isNonNegativeInteger(value.normalizationChangedLineCount)
    && isNullable(value.normalizationManifestReference, (item): item is string => typeof item === "string")
    && isStringArray(value.normalizationWarnings);
}

function isNormalizationChange(value: unknown): boolean {
  return isRecordWith(value, ["sourceLine", "ruleId", "originalExcerpt", "emittedExcerpt"])
    && isNonNegativeInteger(value.sourceLine)
    && typeof value.ruleId === "string"
    && typeof value.originalExcerpt === "string" && value.originalExcerpt.length <= 512
    && typeof value.emittedExcerpt === "string" && value.emittedExcerpt.length <= 512;
}

function isNormalizationManifest(value: unknown): value is NormalizationManifest {
  if (!isRecordWith(value, [
    "manifestReference", "normalizerId", "displayName", "schemaVersion", "definitionSha256",
    "sourceSha256", "sourceSize", "sourceMtimeNs", "changedLineCount", "firstChangedLine",
    "lastChangedLine", "ruleChangedLineCounts", "warnings", "changes",
  ])) return false;
  const changes = value.changes as readonly unknown[];
  return typeof value.manifestReference === "string"
    && typeof value.normalizerId === "string" && typeof value.displayName === "string"
    && isNonNegativeInteger(value.schemaVersion)
    && typeof value.definitionSha256 === "string" && typeof value.sourceSha256 === "string"
    && isNonNegativeInteger(value.sourceSize) && isNonNegativeInteger(value.sourceMtimeNs)
    && isNonNegativeInteger(value.changedLineCount)
    && isNullable(value.firstChangedLine, isNonNegativeInteger)
    && isNullable(value.lastChangedLine, isNonNegativeInteger)
    && isRecord(value.ruleChangedLineCounts)
    && Object.values(value.ruleChangedLineCounts).every(isNonNegativeInteger)
    && isStringArray(value.warnings) && isArrayOf(changes, isNormalizationChange)
    && value.changedLineCount <= MAX_NORMALIZATION_CHANGES
    && changes.length === value.changedLineCount;
}

function isNormalizedOutcar(value: unknown): value is NormalizedOutcar {
  return isRecordWith(value, ["manifestReference", "content"])
    && typeof value.manifestReference === "string" && typeof value.content === "string"
    && new TextEncoder().encode(value.content).byteLength <= MAX_NORMALIZED_OUTCAR_BYTES;
}

function isCalculationDataset(value: unknown): value is CalculationDataset {
  if (!isRecordWith(value, [
    "schemaVersion", "root", "sourceFiles", "sites", "initialStructure", "ionicSteps", "parameters",
    "capabilities", "warnings", "provenance",
  ])
    || value.schemaVersion !== DATASET_SCHEMA_VERSION
    || typeof value.root !== "string"
    || !isArrayOf(value.sourceFiles, isSourceFile)
    || !isArrayOf(value.sites, isSite)
    || !(value.initialStructure === null || isInitialStructure(value.initialStructure))
    || !isArrayOf(value.ionicSteps, isIonicStep)
    || !isArrayOf(value.parameters, isParameterOccurrence)
    || !isArrayOf(value.capabilities, isCapability)
    || !isArrayOf(value.warnings, isWarning)
    || !(value.provenance === null || isProvenance(value.provenance))) return false;
  const siteCount = (value.sites as readonly unknown[]).length;
  const initialStructure = value.initialStructure as Record<string, unknown> | null;
  return (initialStructure === null
      || ((initialStructure.fractionalPositions as readonly unknown[]).length === siteCount
        && (initialStructure.cartesianPositions as readonly unknown[]).length === siteCount))
    && (value.ionicSteps as readonly IonicStep[]).every((step) => step.cartesianPositions.length === siteCount);
}

function validatedResult(method: AnalysisMethod, value: unknown): AnalysisResult {
  if (method === "getDataset" && isCalculationDataset(value)) return value;
  if (method === "getStep" && isIonicStep(value)) return value;
  if (method === "getNormalizationManifest" && isNormalizationManifest(value)) return value;
  if (method === "getNormalizedOutcar" && isNormalizedOutcar(value)) return value;
  throw invalidResponse();
}

function decodeEnvelope(method: AnalysisMethod, envelope: Record<string, unknown>): AnalysisResult {
  const hasResult = Object.prototype.hasOwnProperty.call(envelope, "result");
  const hasError = Object.prototype.hasOwnProperty.call(envelope, "error");
  if (hasResult === hasError) throw invalidResponse();
  if (hasError) {
    const error = protocolError(envelope.error);
    if (!error) throw invalidResponse();
    throw new HostRequestError(error.code, error.message);
  }
  return validatedResult(method, envelope.result);
}

export class HostRequestError extends Error {
  override readonly name = "HostRequestError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function protocolError(value: unknown): ProtocolErrorShape | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProtocolErrorShape>;
  return typeof candidate.code === "string" && typeof candidate.message === "string"
    ? { code: candidate.code, message: candidate.message }
    : undefined;
}

function persistedState(value: unknown): PersistedAnalysisState | undefined {
  if (!isRecord(value)) return undefined;
  const state = value;
  if (state.version !== undefined && state.version !== 2 && state.version !== 3 && state.version !== 4) return undefined;
  const frame = isRecord(state.selectedFrame) ? state.selectedFrame : undefined;
  const selectedFrame = state.version === 4
    ? frame?.kind === "initial"
      ? { kind: "initial" as const }
      : frame?.kind === "ionic" && Number.isSafeInteger(frame.index) && Number(frame.index) >= 0
        ? { kind: "ionic" as const, index: Number(frame.index) }
        : undefined
    : Number.isSafeInteger(state.selectedStep) && Number(state.selectedStep) >= 0
      ? { kind: "ionic" as const, index: Number(state.selectedStep) }
      : undefined;
  if (!selectedFrame) return undefined;
  if (state.selectedSite !== null && (!Number.isSafeInteger(state.selectedSite) || Number(state.selectedSite) < 0)) {
    return undefined;
  }
  const forceScale = isFiniteNumber(state.forceScale)
    ? Math.min(MAX_FORCE_SCALE, Math.max(MIN_FORCE_SCALE, state.forceScale))
    : 10;
  return {
    version: 4,
    selectedFrame,
    comparisonTarget: Number.isSafeInteger(state.comparisonTarget) && Number(state.comparisonTarget) >= 0
      ? Number(state.comparisonTarget) : 0,
    displacementScale: isFiniteNumber(state.displacementScale)
      ? Math.min(1000, Math.max(1, state.displacementScale)) : 10,
    selectedSite: state.selectedSite === null ? null : Number(state.selectedSite),
    forceMode: state.forceMode === "raw" ? "raw" : "free",
    forceScale,
    layout: normalizeLayout(isRecord(state.layout) ? state.layout as Partial<LayoutPreferences> : DEFAULT_LAYOUT),
    convergence: state.version === 3 || state.version === 4 ? normalizeConvergence(state.convergence) : DEFAULT_CONVERGENCE,
  };
}

export class VsCodeHost implements AnalysisHost {
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private disposed = false;

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (!event.data || typeof event.data !== "object") return;
    const response = event.data as { type?: unknown; requestId?: unknown; result?: unknown; error?: unknown };
    if (response.type !== "response" || !Number.isSafeInteger(response.requestId)) return;
    const requestId = Number(response.requestId);
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    try {
      pending.resolve(decodeEnvelope(pending.method, response as Record<string, unknown>));
    } catch (error) {
      pending.reject(error instanceof HostRequestError ? error : invalidResponse());
    }
  };

  constructor(
    private readonly api: VsCodeApi,
    private readonly events: EventTargetLike = window,
  ) {
    events.addEventListener("message", this.onMessage);
  }

  request(method: AnalysisMethod, params: Readonly<Record<string, unknown>>): Promise<AnalysisResult> {
    if (this.disposed) return Promise.reject(new HostRequestError("host_disposed", "Analyzer host is closed"));
    const requestId = ++this.nextRequestId;
    const response = new Promise<AnalysisResult>((resolve, reject) => {
      this.pending.set(requestId, { method, resolve, reject });
    });
    this.api.postMessage({ type: "request", requestId, method, params });
    return response;
  }

  getState(): PersistedAnalysisState | undefined {
    return persistedState(this.api.getState());
  }

  setState(state: PersistedAnalysisState): void {
    const normalized = persistedState(state);
    if (normalized) this.api.setState(normalized);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.removeEventListener("message", this.onMessage);
    for (const request of this.pending.values()) {
      request.reject(new HostRequestError("host_disposed", "Analyzer host is closed"));
    }
    this.pending.clear();
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const BROWSER_STATE_KEY = "vasp-analyzer.selection.v1";

export class HttpHost implements AnalysisHost {
  private nextRequestId = 0;
  private state: PersistedAnalysisState | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly storage?: StorageLike,
  ) {
    if (!storage) return;
    try {
      const raw = storage.getItem(BROWSER_STATE_KEY);
      this.state = raw === null ? undefined : persistedState(JSON.parse(raw));
    } catch {
      this.state = undefined;
    }
  }

  async request(method: AnalysisMethod, params: Readonly<Record<string, unknown>>): Promise<AnalysisResult> {
    const id = ++this.nextRequestId;
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, method, params }),
      });
    } catch {
      throw new HostRequestError("http_error", "Analyzer HTTP request failed");
    }
    if (!response.ok) {
      throw new HostRequestError("http_error", `Analyzer HTTP request failed (${response.status})`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw invalidResponse();
    }
    if (!isRecord(payload)) throw invalidResponse();
    const envelope = payload as { id?: unknown; result?: unknown; error?: unknown };
    if (envelope.id !== id) throw invalidResponse();
    return decodeEnvelope(method, envelope as Record<string, unknown>);
  }

  getState(): PersistedAnalysisState | undefined {
    return this.state;
  }

  setState(state: PersistedAnalysisState): void {
    const normalized = persistedState(state);
    if (!normalized) return;
    this.state = normalized;
    try {
      this.storage?.setItem(BROWSER_STATE_KEY, JSON.stringify(normalized));
    } catch {
      // The browser may disable storage; in-memory state remains usable.
    }
  }
}
