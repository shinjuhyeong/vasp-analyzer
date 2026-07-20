import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./webview/App.js";
import { VsCodeHost } from "./webview/core/host.js";
import "./webview/styles.css";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const container = document.getElementById("app");
if (!container) throw new Error("VASP Analyzer Webview root is missing");

const host = new VsCodeHost(acquireVsCodeApi(), window);
createRoot(container).render(createElement(App, { host }));
