import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALCULATION_OPEN_DIALOG_OPTIONS } from "../openCalculation.js";

const mocks = vi.hoisted(() => ({
  command: undefined as undefined | ((resource?: { fsPath: string }) => Promise<void>),
  endpointOnOpen: undefined as undefined | ((
    calculation: { readonly root: string; readonly profilePath: string | null },
    signal: AbortSignal,
  ) => Promise<void>),
  panels: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
  }>,
  showOpenDialog: vi.fn(),
  spawnAnalyzer: vi.fn(),
}));

vi.mock("vscode", () => ({
  ViewColumn: { Active: 1 },
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
    }),
  },
  commands: {
    registerCommand: vi.fn((_name: string, command: (resource?: { fsPath: string }) => Promise<void>) => {
      mocks.command = command;
      return { dispose: vi.fn() };
    }),
  },
  window: {
    showErrorMessage: vi.fn(),
    showOpenDialog: mocks.showOpenDialog,
    createWebviewPanel: vi.fn(() => {
      let onDispose: (() => void) | undefined;
      let disposed = false;
      const panel = {
        reveal: vi.fn(),
        dispose: vi.fn(() => {
          if (disposed) return;
          disposed = true;
          onDispose?.();
        }),
        webview: {
          cspSource: "test-csp",
          html: "",
          asWebviewUri: (uri: unknown) => uri,
          postMessage: vi.fn(async () => true),
          onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
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
  },
}));

vi.mock("../controlEndpoint.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../controlEndpoint.js")>();
  return {
    ...original,
    resolveCalculationRoot: vi.fn(async (candidate: string) => candidate),
    createControlEndpoint: vi.fn(async (options: {
      onOpen: (
        calculation: { readonly root: string; readonly profilePath: string | null },
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
  mocks.endpointOnOpen = undefined;
  mocks.panels.length = 0;
  mocks.showOpenDialog.mockReset();
  mocks.spawnAnalyzer.mockReset();
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
    const first = { root: "/work/calc", profilePath: "/profiles/first.toml" };
    const second = { root: "/work/calc", profilePath: "/profiles/second.toml" };

    await mocks.endpointOnOpen?.(first, signal);
    await mocks.endpointOnOpen?.(second, signal);
    await mocks.endpointOnOpen?.(first, signal);

    expect(mocks.panels).toHaveLength(2);
    expect(mocks.panels[0]?.reveal).toHaveBeenCalledOnce();
    expect(mocks.spawnAnalyzer).toHaveBeenNthCalledWith(
      1,
      first.root,
      expect.objectContaining({ profilePath: first.profilePath }),
      expect.anything(),
    );
    expect(mocks.spawnAnalyzer).toHaveBeenNthCalledWith(
      2,
      second.root,
      expect.objectContaining({ profilePath: second.profilePath }),
      expect.anything(),
    );

    mocks.panels[0]?.dispose();
    await mocks.endpointOnOpen?.(first, signal);

    expect(mocks.panels).toHaveLength(3);
    expect(mocks.spawnAnalyzer).toHaveBeenCalledTimes(3);
  });
});
