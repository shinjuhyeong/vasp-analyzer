import type {
  AnalysisHost,
  AnalysisMethod,
  AnalysisResult,
  CalculationDataset,
  IonicStep,
  LegacyPersistedAnalysisState,
  LayoutPreferences,
  PersistedAnalysisState,
} from "./contracts.js";
import {
  DEFAULT_LAYOUT,
  MAX_FORCE_SCALE,
  MIN_FORCE_SCALE,
  normalizeLayout,
} from "./store.js";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: PersistedAnalysisState | LegacyPersistedAnalysisState): void;
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

function invalidResponse(): HostRequestError {
  return new HostRequestError("invalid_response", INVALID_RESPONSE_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVec3(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isMat3(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(isVec3);
}

function isVec3Array(value: unknown): boolean {
  return Array.isArray(value) && value.every(isVec3);
}

function isSourceFile(value: unknown): boolean {
  return isRecord(value)
    && typeof value.path === "string"
    && isNonNegativeInteger(value.size)
    && isNonNegativeInteger(value.mtimeNs)
    && typeof value.fingerprint === "string";
}

function isSite(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.selectiveDynamics)) return false;
  const mask = value.selectiveDynamics;
  return isNonNegativeInteger(value.siteIndex)
    && typeof value.element === "string"
    && isVec3(value.initialFractionalPosition)
    && isVec3(value.initialCartesianPosition)
    && [mask.a, mask.b, mask.c].every((item) => item === null || typeof item === "boolean");
}

function isForceComponent(value: unknown): boolean {
  return isRecord(value)
    && isNonNegativeInteger(value.siteIndex)
    && (value.axis === "a" || value.axis === "b" || value.axis === "c")
    && isFiniteNumber(value.value)
    && isFiniteNumber(value.magnitude);
}

function isEnergyTerm(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name === "string"
    && isFiniteNumber(value.value)
    && value.unit === "eV";
}

function isIonicStep(value: unknown): value is IonicStep {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.index)
    || !isMat3(value.lattice)
    || !isVec3Array(value.fractionalPositions)
    || !isVec3Array(value.cartesianPositions)
    || !isVec3Array(value.rawForces)
    || !isNullable(value.freeForces, (item): item is readonly unknown[] => isVec3Array(item))
    || !isNullable(value.freeForceNorms, (item): item is readonly number[] => Array.isArray(item) && item.every(isFiniteNumber))
    || !isNullable(value.totalEnergy, isFiniteNumber)
    || !Array.isArray(value.energyTerms) || !value.energyTerms.every(isEnergyTerm)
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
  return isRecord(value)
    && typeof value.name === "string" && names.includes(value.name)
    && typeof value.available === "boolean"
    && (value.reason === null || typeof value.reason === "string");
}

function isWarning(value: unknown): boolean {
  return isRecord(value)
    && (value.category === "IncompleteTail" || value.category === "IgnoredCompatibilityMetadata")
    && typeof value.message === "string"
    && isNullable(value.byteOffset, isNonNegativeInteger)
    && isNullable(value.lineNumber, isNonNegativeInteger);
}

function isProvenance(value: unknown): boolean {
  return isRecord(value)
    && typeof value.adapter === "string"
    && typeof value.adapterVersion === "string"
    && typeof value.dialect === "string"
    && (value.profileId === null || typeof value.profileId === "string")
    && isStringArray(value.normalizationRules)
    && isStringArray(value.compatibilityMetadata);
}

function isCalculationDataset(value: unknown): value is CalculationDataset {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.root !== "string"
    || !Array.isArray(value.sourceFiles) || !value.sourceFiles.every(isSourceFile)
    || !Array.isArray(value.sites) || !value.sites.every(isSite)
    || !Array.isArray(value.ionicSteps) || !value.ionicSteps.every(isIonicStep)
    || !Array.isArray(value.capabilities) || !value.capabilities.every(isCapability)
    || !Array.isArray(value.warnings) || !value.warnings.every(isWarning)
    || !(value.provenance === null || isProvenance(value.provenance))) return false;
  const siteCount = (value.sites as readonly unknown[]).length;
  return (value.ionicSteps as readonly IonicStep[]).every((step) => step.cartesianPositions.length === siteCount);
}

function validatedResult(method: AnalysisMethod, value: unknown): AnalysisResult {
  if (method === "getDataset" && isCalculationDataset(value)) return value;
  if (method === "getStep" && isIonicStep(value)) return value;
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
  if (!Number.isSafeInteger(state.selectedStep) || Number(state.selectedStep) < 0) return undefined;
  if (state.selectedSite !== null && (!Number.isSafeInteger(state.selectedSite) || Number(state.selectedSite) < 0)) {
    return undefined;
  }
  const forceScale = isFiniteNumber(state.forceScale)
    ? Math.min(MAX_FORCE_SCALE, Math.max(MIN_FORCE_SCALE, state.forceScale))
    : 10;
  return {
    version: 2,
    selectedStep: Number(state.selectedStep),
    selectedSite: state.selectedSite === null ? null : Number(state.selectedSite),
    forceMode: state.forceMode === "raw" ? "raw" : "free",
    forceScale,
    layout: normalizeLayout(isRecord(state.layout) ? state.layout as Partial<LayoutPreferences> : DEFAULT_LAYOUT),
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

  setState(state: PersistedAnalysisState | LegacyPersistedAnalysisState): void {
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

  setState(state: PersistedAnalysisState | LegacyPersistedAnalysisState): void {
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
