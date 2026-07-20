import type {
  AnalysisHost,
  AnalysisMethod,
  AnalysisResult,
  PersistedAnalysisState,
} from "./contracts.js";

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
  readonly resolve: (value: AnalysisResult) => void;
  readonly reject: (reason: Error) => void;
}

interface ProtocolErrorShape {
  readonly code: string;
  readonly message: string;
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
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<PersistedAnalysisState>;
  if (!Number.isSafeInteger(state.selectedStep) || Number(state.selectedStep) < 0) return undefined;
  if (state.selectedSite !== null && (!Number.isSafeInteger(state.selectedSite) || Number(state.selectedSite) < 0)) {
    return undefined;
  }
  return { selectedStep: Number(state.selectedStep), selectedSite: state.selectedSite ?? null };
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
    const error = protocolError(response.error);
    if (error) {
      pending.reject(new HostRequestError(error.code, error.message));
    } else if (Object.prototype.hasOwnProperty.call(response, "result")) {
      pending.resolve(response.result as AnalysisResult);
    } else {
      pending.reject(new HostRequestError("invalid_response", "Analyzer returned an invalid response"));
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
      this.pending.set(requestId, { resolve, reject });
    });
    this.api.postMessage({ type: "request", requestId, method, params });
    return response;
  }

  getState(): PersistedAnalysisState | undefined {
    return persistedState(this.api.getState());
  }

  setState(state: PersistedAnalysisState): void {
    this.api.setState(state);
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

export class HttpHost implements AnalysisHost {
  private nextRequestId = 0;
  private state: PersistedAnalysisState | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async request(method: AnalysisMethod, params: Readonly<Record<string, unknown>>): Promise<AnalysisResult> {
    const id = ++this.nextRequestId;
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, method, params }),
    });
    if (!response.ok) {
      throw new HostRequestError("http_error", `Analyzer HTTP request failed (${response.status})`);
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
      throw new HostRequestError("invalid_response", "Analyzer returned an invalid response");
    }
    const envelope = payload as { id?: unknown; result?: unknown; error?: unknown };
    if (envelope.id !== id) {
      throw new HostRequestError("invalid_response", "Analyzer returned a mismatched response ID");
    }
    const error = protocolError(envelope.error);
    if (error) throw new HostRequestError(error.code, error.message);
    if (!Object.prototype.hasOwnProperty.call(envelope, "result")) {
      throw new HostRequestError("invalid_response", "Analyzer returned an invalid response");
    }
    return envelope.result as AnalysisResult;
  }

  getState(): PersistedAnalysisState | undefined {
    return this.state;
  }

  setState(state: PersistedAnalysisState): void {
    this.state = state;
  }
}
