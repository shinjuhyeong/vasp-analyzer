declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!app || !event.data || typeof event.data !== "object") return;
  const message = event.data as { type?: unknown; result?: unknown; error?: unknown };
  if (message.type === "dataset") {
    app.textContent = "Calculation loaded. Crystal viewer assets will be provided by the next UI task.";
  } else if (message.type === "error") {
    app.textContent = typeof message.error === "string" ? message.error : "Analyzer request failed.";
  }
});

vscode.postMessage({ type: "ready" });
