import { basename } from "node:path";

import * as vscode from "vscode";

import { ActivationCoordinator, type ActivationCleanup } from "./activationLifecycle.js";
import {
  AnalyzerProtocolError,
  spawnAnalyzer,
  type AnalyzerProcess,
  type Method,
} from "./analyzerProcess.js";
import {
  createControlEndpoint,
  resolveCalculationRoot,
  type ControlEndpoint,
} from "./controlEndpoint.js";
import { webviewHtml } from "./webviewHtml.js";

interface WebviewRequest {
  readonly type: "request";
  readonly requestId: number;
  readonly method: Method;
  readonly params: Record<string, unknown>;
}

const activationCoordinator = new ActivationCoordinator<ControlEndpoint>();
const registeredContexts = new WeakSet<vscode.ExtensionContext>();

function registerContextCleanup(context: vscode.ExtensionContext): void {
  if (registeredContexts.has(context)) return;
  registeredContexts.add(context);
  context.subscriptions.push({
    dispose: () => void activationCoordinator.deactivate(),
  });
}

function requireActive(...signals: readonly AbortSignal[]): void {
  if (signals.some((signal) => signal.aborted)) throw new Error("VASP Analyzer is closing");
}

function configuredLaunch(): { executablePath?: string; pythonPath?: string } {
  const configuration = vscode.workspace.getConfiguration("vaspAnalyzer");
  const pythonPath = configuration.get<string>("pythonPath")?.trim();
  const executablePath = configuration.get<string>("executablePath", "analyzer")?.trim();
  return pythonPath ? { pythonPath } : { executablePath: executablePath || "analyzer" };
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

function activationPlan(context: vscode.ExtensionContext): {
  readonly factory: (signal: AbortSignal) => Promise<ControlEndpoint>;
  readonly install: (endpoint: ControlEndpoint, signal: AbortSignal) => ActivationCleanup;
} {
  const panels = new Map<string, vscode.WebviewPanel>();
  const processes = new Map<vscode.WebviewPanel, AnalyzerProcess>();

  const openCanonicalCalculation = async (
    root: string,
    activationSignal: AbortSignal,
    requestSignal: AbortSignal = activationSignal,
  ): Promise<void> => {
    requireActive(activationSignal, requestSignal);
    const existing = panels.get(root);
    if (existing) {
      requireActive(activationSignal, requestSignal);
      existing.reveal();
      return;
    }

    requireActive(activationSignal, requestSignal);
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, "dist", "webview");
    const panel = vscode.window.createWebviewPanel(
      "vaspAnalyzer.calculation",
      `VASP Analyzer — ${basename(root)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [webviewRoot] },
    );
    let analyzer: AnalyzerProcess;
    try {
      requireActive(activationSignal, requestSignal);
      analyzer = spawnAnalyzer(root, configuredLaunch(), {
        requestTimeoutMs: configuredTimeout(),
      });
    } catch (error) {
      panel.dispose();
      throw error;
    }
    panels.set(root, panel);
    processes.set(panel, analyzer);
    const bundle = vscode.Uri.joinPath(webviewRoot, "index.js");
    const stylesheet = vscode.Uri.joinPath(webviewRoot, "index.css");
    panel.webview.html = webviewHtml(panel.webview, bundle, stylesheet);

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
          const protocolError =
            error instanceof AnalyzerProtocolError
              ? { code: error.code, message: error.message }
              : {
                  code: "extension_error",
                  message: error instanceof Error ? error.message : "Analyzer request failed",
                };
          await panel.webview.postMessage({
            type: "response",
            requestId: message.requestId,
            error: protocolError,
          });
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

  const openCalculation = async (candidate: string, activationSignal: AbortSignal): Promise<void> => {
    requireActive(activationSignal);
    const root = await resolveCalculationRoot(candidate);
    requireActive(activationSignal);
    await openCanonicalCalculation(root, activationSignal);
  };

  return {
    factory: async (activationSignal) =>
      await createControlEndpoint({
        onOpen: async (root, requestSignal) =>
          await openCanonicalCalculation(root, activationSignal, requestSignal),
      }),
    install: (endpoint, activationSignal) => {
      requireActive(activationSignal);
      let command: vscode.Disposable | undefined;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        command?.dispose();
        context.environmentVariableCollection.delete("VASP_ANALYZER_ENDPOINT");
        context.environmentVariableCollection.delete("VASP_ANALYZER_TOKEN");
        for (const panel of [...panels.values()]) panel.dispose();
        for (const analyzer of processes.values()) analyzer.dispose();
        panels.clear();
        processes.clear();
      };
      try {
        context.environmentVariableCollection.replace("VASP_ANALYZER_ENDPOINT", endpoint.address);
        context.environmentVariableCollection.replace("VASP_ANALYZER_TOKEN", endpoint.token);
        requireActive(activationSignal);
        command = vscode.commands.registerCommand(
          "vaspAnalyzer.open",
          async (resource?: vscode.Uri) => {
            try {
              let selected = resource;
              if (!selected) {
                const choices = await vscode.window.showOpenDialog({
                  canSelectFiles: true,
                  canSelectFolders: false,
                  canSelectMany: false,
                  openLabel: "Open VASP Calculation",
                });
                selected = choices?.[0];
              }
              if (selected) await openCalculation(selected.fsPath, activationSignal);
            } catch {
              void vscode.window.showErrorMessage("VASP Analyzer could not open this calculation.");
            }
          },
        );
        context.subscriptions.push(command);
        return cleanup;
      } catch (error) {
        cleanup();
        throw error;
      }
    },
  };
}

export function activate(context: vscode.ExtensionContext): Promise<void> {
  registerContextCleanup(context);
  const plan = activationPlan(context);
  return activationCoordinator.activate(plan.factory, plan.install);
}

export function deactivate(): Promise<void> {
  return activationCoordinator.deactivate();
}
