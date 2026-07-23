import { HttpHost, VsCodeHost } from "./host.js";
import type { AnalysisHost, PersistedAnalysisState } from "./contracts.js";

interface RuntimeScope {
  readonly acquireVsCodeApi?: (() => {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: PersistedAnalysisState): void;
  }) | undefined;
  readonly fetch?: typeof fetch;
  readonly window: Window;
}

/** Select the transport from runtime capabilities, never from user-controlled URL data. */
export function createRuntimeHost(runtime: RuntimeScope): AnalysisHost {
  if (typeof runtime.acquireVsCodeApi === "function") {
    return new VsCodeHost(runtime.acquireVsCodeApi(), runtime.window);
  }
  let storage: Storage | undefined;
  try {
    storage = runtime.window.sessionStorage;
  } catch {
    storage = undefined;
  }
  return new HttpHost(
    "/api/request",
    (input, init) => (runtime.fetch ?? fetch)(input, init),
    storage,
  );
}
