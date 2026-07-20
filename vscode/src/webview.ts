import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./webview/App.js";
import { createRuntimeHost } from "./webview/core/runtimeHost.js";
import type { PersistedAnalysisState } from "./webview/core/contracts.js";
import { createThreeDmolRenderer } from "./webview/renderers/ThreeDmolRenderer.js";
import "./webview/styles.css";

const container = document.getElementById("app");
if (!container) throw new Error("VASP Analyzer Webview root is missing");

const runtime = globalThis as typeof globalThis & {
  acquireVsCodeApi?: () => {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: PersistedAnalysisState): void;
  };
};
const host = createRuntimeHost({
  acquireVsCodeApi: runtime.acquireVsCodeApi,
  fetch: runtime.fetch,
  window,
});
createRoot(container).render(
  createElement(App, { host, rendererFactory: createThreeDmolRenderer }),
);
