import { basename } from "node:path";

import * as vscode from "vscode";

import { spawnAnalyzer, type AnalyzerProcess, type Method } from "./analyzerProcess.js";
import { createControlEndpoint, resolveCalculationRoot } from "./controlEndpoint.js";
import { webviewHtml } from "./webviewHtml.js";

interface WebviewRequest {
  readonly type: "request";
  readonly requestId: number;
  readonly method: Method;
  readonly params: Record<string, unknown>;
}

function configuredPythonPath(): string | undefined {
  const explicit = vscode.workspace.getConfiguration("vaspAnalyzer").get<string>("pythonPath")?.trim();
  if (explicit) return explicit;
  const pythonDefault = vscode.workspace
    .getConfiguration("python")
    .get<string>("defaultInterpreterPath")
    ?.trim();
  return pythonDefault || undefined;
}

function configuredTimeout(): number {
  const configured = vscode.workspace
    .getConfiguration("vaspAnalyzer")
    .get<number>("requestTimeoutMs", 30000);
  return Math.max(1000, Math.min(120000, configured));
}

function isWebviewRequest(value: unknown): value is WebviewRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<WebviewRequest>;
  return (
    request.type === "request" &&
    Number.isSafeInteger(request.requestId) &&
    (request.method === "getDataset" || request.method === "getStep" || request.method === "getVolumetric") &&
    !!request.params &&
    typeof request.params === "object" &&
    !Array.isArray(request.params)
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const panels = new Map<string, vscode.WebviewPanel>();
  const processes = new Map<vscode.WebviewPanel, AnalyzerProcess>();

  const openCalculation = async (candidate: string): Promise<void> => {
    const root = await resolveCalculationRoot(candidate);
    const existing = panels.get(root);
    if (existing) {
      existing.reveal();
      return;
    }

    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, "dist", "webview");
    const panel = vscode.window.createWebviewPanel(
      "vaspAnalyzer.calculation",
      `VASP Analyzer — ${basename(root)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [webviewRoot] },
    );
    panels.set(root, panel);
    const analyzer = spawnAnalyzer(root, configuredPythonPath(), {
      requestTimeoutMs: configuredTimeout(),
    });
    processes.set(panel, analyzer);
    const bundle = vscode.Uri.joinPath(webviewRoot, "index.js");
    panel.webview.html = webviewHtml(panel.webview, bundle);

    panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (message && typeof message === "object" && (message as { type?: unknown }).type === "ready") {
          try {
            const result = await analyzer.request("getDataset", {});
            await panel.webview.postMessage({ type: "dataset", result });
          } catch {
            await panel.webview.postMessage({ type: "error", error: "Unable to load the calculation." });
          }
          return;
        }
        if (!isWebviewRequest(message)) return;
        try {
          const result = await analyzer.request(message.method, message.params);
          await panel.webview.postMessage({ type: "response", requestId: message.requestId, result });
        } catch (error) {
          const text = error instanceof Error ? error.message : "Analyzer request failed";
          await panel.webview.postMessage({ type: "response", requestId: message.requestId, error: text });
        }
      },
      undefined,
      context.subscriptions,
    );
    panel.onDidDispose(
      () => {
        analyzer.dispose();
        processes.delete(panel);
        panels.delete(root);
      },
      undefined,
      context.subscriptions,
    );
  };

  const endpoint = await createControlEndpoint({ onOpen: openCalculation });
  context.environmentVariableCollection.replace("VASP_ANALYZER_ENDPOINT", endpoint.address);
  context.environmentVariableCollection.replace("VASP_ANALYZER_TOKEN", endpoint.token);
  context.subscriptions.push({
    dispose: () => {
      context.environmentVariableCollection.delete("VASP_ANALYZER_ENDPOINT");
      context.environmentVariableCollection.delete("VASP_ANALYZER_TOKEN");
      void endpoint.close().catch(() => undefined);
      for (const analyzer of processes.values()) analyzer.dispose();
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("vaspAnalyzer.open", async (resource?: vscode.Uri) => {
      try {
        let selected = resource;
        if (!selected) {
          const choices = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "VASP OUTCAR": ["OUTCAR"] },
            openLabel: "Open VASP Calculation",
          });
          selected = choices?.[0];
        }
        if (selected) await openCalculation(selected.fsPath);
      } catch {
        void vscode.window.showErrorMessage("VASP Analyzer could not open this calculation.");
      }
    }),
  );
}

export function deactivate(): void {
  // ExtensionContext subscriptions own endpoint, panel, and process cleanup.
}
