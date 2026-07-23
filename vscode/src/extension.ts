import { basename } from "node:path";

import * as vscode from "vscode";

import { ActivationCoordinator, type ActivationCleanup } from "./activationLifecycle.js";
import {
  AnalyzerProtocolError,
  spawnAnalyzer,
  type AnalyzerProcess,
  type AnalyzerLaunchConfiguration,
  type Method,
} from "./analyzerProcess.js";
import {
  createControlEndpoint,
  resolveCalculation,
  type ControlEndpoint,
  type ResolvedCalculation,
} from "./controlEndpoint.js";
import { CALCULATION_OPEN_DIALOG_OPTIONS, calculationPanelKey } from "./openCalculation.js";
import { webviewHtml } from "./webviewHtml.js";

interface WebviewRequest {
  readonly type: "request";
  readonly requestId: number;
  readonly method: Method;
  readonly params: Record<string, unknown>;
}

type CalculationOpenFailure = "input" | "analyzer" | "process";

class CalculationOpenError extends Error {
  constructor(readonly category: CalculationOpenFailure) {
    super(category);
  }
}

function calculationOpenMessage(error: unknown): string {
  if (error instanceof CalculationOpenError && error.category === "input") {
    return "VASP Analyzer could not find a readable OUTCAR. Check the selected file and its permissions, then retry.";
  }
  if (error instanceof CalculationOpenError && error.category === "analyzer") {
    return "VASP Analyzer could not start the analyzer executable. Check the Remote SSH vaspAnalyzer executablePath/pythonPath settings, then inspect the Remote Extension Host log.";
  }
  if (error instanceof CalculationOpenError && error.category === "process") {
    return "The analyzer process could not load this calculation. Check the analyzer executable and profile settings, then inspect the Remote Extension Host log.";
  }
  return "VASP Analyzer could not open the calculation. Reload the Remote SSH window, then inspect the Remote Extension Host log.";
}

interface SafeRequestFailure {
  readonly protocol: { readonly code: string; readonly message: string };
  readonly showProcessGuidance: boolean;
}

const SAFE_PROTOCOL_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  capability_unavailable: "Requested analysis capability is unavailable.",
  step_not_found: "The requested ionic step is unavailable.",
  invalid_request: "The analyzer rejected the request.",
  normalization_session_expired: "The normalization report expired because the OUTCAR changed. Reload the calculation and try again.",
});

function safeAnalyzerRequestFailure(error: unknown): SafeRequestFailure {
  if (error instanceof AnalyzerProtocolError) {
    const message = SAFE_PROTOCOL_MESSAGES[error.code];
    return message === undefined
      ? {
          protocol: { code: "analyzer_error", message: "The analyzer rejected the request." },
          showProcessGuidance: false,
        }
      : { protocol: { code: error.code, message }, showProcessGuidance: false };
  }
  return {
    protocol: { code: "extension_error", message: "Analyzer process request failed." },
    showProcessGuidance: true,
  };
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

function configuredLaunch(profilePath: string | null): AnalyzerLaunchConfiguration {
  const configuration = vscode.workspace.getConfiguration("vaspAnalyzer");
  const pythonPath = configuration.get<string>("pythonPath")?.trim();
  const executablePath = configuration.get<string>("executablePath", "analyzer")?.trim();
  const profile = profilePath === null ? {} : { profilePath };
  return pythonPath
    ? { pythonPath, ...profile }
    : { executablePath: executablePath || "analyzer", ...profile };
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
    (request.method === "getDataset" || request.method === "getStep" || request.method === "getVolumetric"
      || request.method === "getNormalizationManifest" || request.method === "getNormalizedOutcar") &&
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
  const calculations = new Map<vscode.WebviewPanel, ResolvedCalculation & { readonly profilePath: string | null }>();
  const virtualContent = new Map<string, string>();
  let activePanel: vscode.WebviewPanel | undefined;
  const normalizedProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent: (uri) => virtualContent.get(uri.toString()) ?? "",
  };

  const openCanonicalCalculation = async (
    calculation: ResolvedCalculation & { readonly profilePath: string | null },
    activationSignal: AbortSignal,
    requestSignal: AbortSignal = activationSignal,
  ): Promise<void> => {
    const { root, calculationPath, profilePath } = calculation;
    const panelKey = calculationPanelKey(root, profilePath);
    requireActive(activationSignal, requestSignal);
    const existing = panels.get(panelKey);
    if (existing) {
      requireActive(activationSignal, requestSignal);
      existing.reveal();
      activePanel = existing;
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
      analyzer = spawnAnalyzer(calculationPath, configuredLaunch(profilePath), {
        requestTimeoutMs: configuredTimeout(),
      });
    } catch (error) {
      panel.dispose();
      throw new CalculationOpenError("analyzer");
    }
    panels.set(panelKey, panel);
    processes.set(panel, analyzer);
    calculations.set(panel, calculation);
    activePanel = panel;
    const bundle = vscode.Uri.joinPath(webviewRoot, "index.js");
    const stylesheet = vscode.Uri.joinPath(webviewRoot, "index.css");
    panel.webview.html = webviewHtml(panel.webview, bundle, stylesheet);

    panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (!isWebviewRequest(message)) return;
        try {
          const result = await analyzer.request(message.method, message.params);
          await panel.webview.postMessage({ type: "response", requestId: message.requestId, result });
        } catch (error) {
          const failure = safeAnalyzerRequestFailure(error);
          await panel.webview.postMessage({
            type: "response",
            requestId: message.requestId,
            error: failure.protocol,
          });
          if (failure.showProcessGuidance) {
            void vscode.window.showErrorMessage(calculationOpenMessage(new CalculationOpenError("process")));
          }
        }
      },
      undefined,
      context.subscriptions,
    );
    panel.onDidDispose(
      () => {
        analyzer.dispose();
        processes.delete(panel);
        calculations.delete(panel);
        panels.delete(panelKey);
        if (activePanel === panel) activePanel = undefined;
      },
      undefined,
      context.subscriptions,
    );
  };

  const openCalculation = async (candidate: string, activationSignal: AbortSignal): Promise<void> => {
    requireActive(activationSignal);
    let calculation: ResolvedCalculation;
    try {
      calculation = await resolveCalculation(candidate);
    } catch {
      throw new CalculationOpenError("input");
    }
    requireActive(activationSignal);
    await openCanonicalCalculation({ ...calculation, profilePath: null }, activationSignal);
  };

  return {
    factory: async (activationSignal) =>
      await createControlEndpoint({
        onOpen: async (calculation, requestSignal) =>
          await openCanonicalCalculation(calculation, activationSignal, requestSignal),
      }),
    install: (endpoint, activationSignal) => {
      requireActive(activationSignal);
      const commands: vscode.Disposable[] = [];
      let cleaned = false;
      const provider = vscode.workspace.registerTextDocumentContentProvider(
        "vasp-analyzer-normalized",
        normalizedProvider,
      );
      const closedDocument = vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === "vasp-analyzer-normalized") {
          virtualContent.delete(document.uri.toString());
        }
      });
      const normalizedView = async (diff: boolean, manifestReference?: string): Promise<void> => {
        const panel = activePanel;
        const analyzer = panel ? processes.get(panel) : undefined;
        const calculation = panel ? calculations.get(panel) : undefined;
        if (!panel || !analyzer || !calculation) {
          void vscode.window.showErrorMessage("Open a VASP Analyzer calculation first.");
          return;
        }
        const dataset = await analyzer.request("getDataset", {}) as {
          provenance?: {
            normalizationChangedLineCount?: number;
            normalizationManifestReference?: string | null;
          };
        };
        if ((dataset.provenance?.normalizationChangedLineCount ?? 0) === 0) {
          void vscode.window.showErrorMessage(
            "This OUTCAR already uses the standard format; there is no normalized view to open.",
          );
          return;
        }
        const reference = manifestReference
          ?? dataset.provenance?.normalizationManifestReference
          ?? undefined;
        if (!reference) {
          void vscode.window.showErrorMessage("No normalization report is available for this calculation.");
          return;
        }
        const result = await analyzer.request("getNormalizedOutcar", {
          manifestReference: reference,
        }) as { manifestReference: string; content: string };
        const uri = vscode.Uri.parse(
          `vasp-analyzer-normalized:/OUTCAR?session=${encodeURIComponent(result.manifestReference)}`,
        );
        virtualContent.set(uri.toString(), result.content);
        if (diff) {
          await vscode.commands.executeCommand(
            "vscode.diff",
            vscode.Uri.file(calculation.calculationPath),
            uri,
            "OUTCAR ↔ Normalized OUTCAR",
          );
        } else {
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, { preview: true });
        }
      };
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const command of commands) command.dispose();
        provider.dispose();
        closedDocument.dispose();
        virtualContent.clear();
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
        commands.push(vscode.commands.registerCommand(
          "vaspAnalyzer.open",
          async (resource?: vscode.Uri) => {
            try {
              let selected = resource;
              if (!selected) {
                const choices = await vscode.window.showOpenDialog(CALCULATION_OPEN_DIALOG_OPTIONS);
                selected = choices?.[0];
              }
              if (selected) await openCalculation(selected.fsPath, activationSignal);
            } catch (error) {
              void vscode.window.showErrorMessage(calculationOpenMessage(error));
            }
          },
        ));
        commands.push(vscode.commands.registerCommand(
          "vaspAnalyzer.openNormalizedOutcar",
          async (manifestReference?: string) => await normalizedView(false, manifestReference),
        ));
        commands.push(vscode.commands.registerCommand(
          "vaspAnalyzer.compareNormalizedOutcar",
          async (manifestReference?: string) => await normalizedView(true, manifestReference),
        ));
        context.subscriptions.push(...commands, provider, closedDocument);
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
