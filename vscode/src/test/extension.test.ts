import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALCULATION_OPEN_DIALOG_OPTIONS } from "../openCalculation.js";

const mocks = vi.hoisted(() => ({
  command: undefined as undefined | ((resource?: { fsPath: string }) => Promise<void>),
  commands: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  endpointOnOpen: undefined as undefined | ((
    calculation: { readonly root: string; readonly calculationPath: string; readonly profilePath: string | null },
    signal: AbortSignal,
  ) => Promise<void>),
  panels: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
    receiveMessage: (message: unknown) => Promise<void>;
    messages: unknown[];
  }>,
  showOpenDialog: vi.fn(),
  showErrorMessage: vi.fn(),
  resolveCalculation: vi.fn(),
  spawnAnalyzer: vi.fn(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
}));

vi.mock("vscode", () => ({
  ViewColumn: { Active: 1 },
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
    }),
    parse: (value: string) => ({ scheme: "vasp-analyzer-normalized", toString: () => value }),
    file: (fsPath: string) => ({ fsPath, scheme: "file", toString: () => `file:${fsPath}` }),
  },
  commands: {
    registerCommand: vi.fn((name: string, command: (...args: unknown[]) => Promise<unknown>) => {
      mocks.commands.set(name, command);
      if (name === "vaspAnalyzer.open") mocks.command = command as typeof mocks.command;
      return { dispose: vi.fn() };
    }),
    executeCommand: mocks.executeCommand,
  },
  window: {
    showErrorMessage: mocks.showErrorMessage,
    showOpenDialog: mocks.showOpenDialog,
    showTextDocument: mocks.showTextDocument,
    createWebviewPanel: vi.fn(() => {
      let onDispose: (() => void) | undefined;
      let onMessage: (message: unknown) => Promise<void> = async () => undefined;
      let disposed = false;
      const messages: unknown[] = [];
      const panel = {
        reveal: vi.fn(),
        dispose: vi.fn(() => {
          if (disposed) return;
          disposed = true;
          onDispose?.();
        }),
        receiveMessage: async (message: unknown) => await onMessage(message),
        messages,
        webview: {
          cspSource: "test-csp",
          html: "",
          asWebviewUri: (uri: unknown) => uri,
          postMessage: vi.fn(async (message: unknown) => {
            messages.push(message);
            return true;
          }),
          onDidReceiveMessage: vi.fn((callback: (message: unknown) => Promise<void>) => {
            onMessage = callback;
            return { dispose: vi.fn() };
          }),
        },
        onDidDispose: vi.fn((callback: () => void) => {
          onDispose = callback;
          return { dispose: vi.fn() };
        }),
      };
      mocks.panels.push(panel);
      return panel;
    }),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, fallback?: unknown) => fallback ?? (key === "executablePath" ? "analyzer" : undefined)),
    })),
    registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn(async (uri: unknown) => ({ uri })),
  },
}));

vi.mock("../controlEndpoint.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../controlEndpoint.js")>();
  return {
    ...original,
    resolveCalculation: mocks.resolveCalculation,
    createControlEndpoint: vi.fn(async (options: {
      onOpen: (
        calculation: { readonly root: string; readonly calculationPath: string; readonly profilePath: string | null },
        signal: AbortSignal,
      ) => void | Promise<void>;
    }) => {
      mocks.endpointOnOpen = async (calculation, signal) => await options.onOpen(calculation, signal);
      return {
        address: "test-endpoint",
        token: "test-token",
        request: vi.fn(),
        sendRaw: vi.fn(),
        close: vi.fn(async () => undefined),
      };
    }),
  };
});

vi.mock("../analyzerProcess.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../analyzerProcess.js")>();
  return { ...original, spawnAnalyzer: mocks.spawnAnalyzer };
});

import { activate, deactivate } from "../extension.js";

function extensionContext() {
  return {
    extensionUri: { fsPath: "/extension" },
    subscriptions: [] as Array<{ dispose(): unknown }>,
    environmentVariableCollection: {
      replace: vi.fn(),
      delete: vi.fn(),
    },
  };
}

beforeEach(() => {
  mocks.command = undefined;
  mocks.commands.clear();
  mocks.endpointOnOpen = undefined;
  mocks.panels.length = 0;
  mocks.showOpenDialog.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.resolveCalculation.mockReset();
  mocks.resolveCalculation.mockImplementation(async (candidate: string) => ({ root: candidate, calculationPath: candidate }));
  mocks.spawnAnalyzer.mockReset();
  mocks.executeCommand.mockReset();
  mocks.showTextDocument.mockReset();
  mocks.spawnAnalyzer.mockImplementation(() => ({ request: vi.fn(), dispose: vi.fn() }));
});

afterEach(async () => {
  await deactivate();
});

describe("VASP Analyzer extension wiring", () => {
  it("passes the exported calculation dialog options directly to showOpenDialog", async () => {
    mocks.showOpenDialog.mockResolvedValue(undefined);
    await activate(extensionContext() as never);

    await mocks.command?.();

    expect(mocks.showOpenDialog).toHaveBeenCalledOnce();
    expect(mocks.showOpenDialog.mock.calls[0]?.[0]).toBe(CALCULATION_OPEN_DIALOG_OPTIONS);
  });

  it("keeps sessions distinct by canonical root and profile through disposal", async () => {
    await activate(extensionContext() as never);
    const signal = new AbortController().signal;
    const first = { root: "/work/calc", calculationPath: "/work/calc/OuTcAr", profilePath: "/profiles/first.toml" };
    const second = { root: "/work/calc", calculationPath: "/work/calc/OuTcAr", profilePath: "/profiles/second.toml" };

    await mocks.endpointOnOpen?.(first, signal);
    await mocks.endpointOnOpen?.(second, signal);
    await mocks.endpointOnOpen?.(first, signal);

    expect(mocks.panels).toHaveLength(2);
    expect(mocks.panels[0]?.reveal).toHaveBeenCalledOnce();
    expect(mocks.spawnAnalyzer).toHaveBeenNthCalledWith(
      1,
      first.calculationPath,
      expect.objectContaining({ profilePath: first.profilePath }),
      expect.anything(),
    );
    expect(mocks.spawnAnalyzer).toHaveBeenNthCalledWith(
      2,
      second.calculationPath,
      expect.objectContaining({ profilePath: second.profilePath }),
      expect.anything(),
    );

    mocks.panels[0]?.dispose();
    await mocks.endpointOnOpen?.(first, signal);

    expect(mocks.panels).toHaveLength(3);
    expect(mocks.spawnAnalyzer).toHaveBeenCalledTimes(3);
  });

  it("shows a safe actionable message for a missing or unreadable calculation", async () => {
    mocks.resolveCalculation.mockRejectedValue(new Error("EACCES /secret/calculation/OUTCAR token=private"));
    await activate(extensionContext() as never);

    await mocks.command?.({ fsPath: "/secret/calculation" });

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/readable OUTCAR.*permissions.*retry/i));
    expect(mocks.showErrorMessage.mock.calls[0]?.[0]).not.toMatch(/secret|token=private/i);
  });

  it("shows analyzer configuration and Remote Extension Host guidance when launch fails", async () => {
    mocks.spawnAnalyzer.mockImplementation(() => {
      throw new Error("spawn /private/bin/analyzer ENOENT credential=private");
    });
    await activate(extensionContext() as never);

    await mocks.command?.({ fsPath: "/work/calc" });

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/analyzer executable.*Remote Extension Host log/i));
    expect(mocks.showErrorMessage.mock.calls[0]?.[0]).not.toMatch(/private|credential/i);
  });

  it("sanitizes an unexpected failure on the production getDataset request path", async () => {
    const sentinel = "token=private /secret/process/path";
    const request = vi.fn().mockRejectedValue(new Error(sentinel));
    mocks.spawnAnalyzer.mockReturnValue({ request, dispose: vi.fn() });
    await activate(extensionContext() as never);
    await mocks.command?.({ fsPath: "/work/calc" });

    await mocks.panels[0]?.receiveMessage({ type: "request", requestId: 41, method: "getDataset", params: {} });

    expect(mocks.panels[0]?.messages).toContainEqual({
      type: "response",
      requestId: 41,
      error: { code: "extension_error", message: "Analyzer process request failed." },
    });
    expect(JSON.stringify(mocks.panels[0]?.messages)).not.toContain(sentinel);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/analyzer process.*Remote Extension Host log/i));
    expect(mocks.showErrorMessage.mock.calls[0]?.[0]).not.toMatch(/private|secret|token/i);
  });

  it("sanitizes analyzer protocol messages while preserving a known safe code", async () => {
    const { AnalyzerProtocolError } = await import("../analyzerProcess.js");
    const sentinel = "profile failed at /secret/profile.toml token=private";
    const request = vi.fn().mockRejectedValue(new AnalyzerProtocolError("capability_unavailable", sentinel));
    mocks.spawnAnalyzer.mockReturnValue({ request, dispose: vi.fn() });
    await activate(extensionContext() as never);
    await mocks.command?.({ fsPath: "/work/calc" });

    await mocks.panels[0]?.receiveMessage({ type: "request", requestId: 42, method: "getDataset", params: {} });

    expect(mocks.panels[0]?.messages).toContainEqual({
      type: "response",
      requestId: 42,
      error: { code: "capability_unavailable", message: "Requested analysis capability is unavailable." },
    });
    expect(JSON.stringify(mocks.panels[0]?.messages)).not.toContain(sentinel);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("opens normalized content read-only and diffs it against the original OUTCAR", async () => {
    const request = vi.fn(async (method: string) => method === "getDataset"
      ? { provenance: { normalizationChangedLineCount: 1, normalizationManifestReference: "a".repeat(64) } }
      : { manifestReference: "a".repeat(64), content: "normalized OUTCAR" });
    mocks.spawnAnalyzer.mockReturnValue({ request, dispose: vi.fn() });
    await activate(extensionContext() as never);
    await mocks.command?.({ fsPath: "/work/calc/OUTCAR" });

    await mocks.commands.get("vaspAnalyzer.openNormalizedOutcar")?.();
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: expect.objectContaining({ scheme: "vasp-analyzer-normalized" }) }),
      { preview: true },
    );

    await mocks.commands.get("vaspAnalyzer.compareNormalizedOutcar")?.();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.objectContaining({ fsPath: "/work/calc/OUTCAR" }),
      expect.objectContaining({ scheme: "vasp-analyzer-normalized" }),
      expect.any(String),
    );
  });
});
