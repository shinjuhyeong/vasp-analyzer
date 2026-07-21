// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { HttpHost, VsCodeHost } from "./host.js";
import type { PersistedAnalysisState } from "./contracts.js";
import { createRuntimeHost } from "./runtimeHost.js";
import { DEFAULT_LAYOUT } from "./store.js";
import { DEFAULT_CONVERGENCE } from "./store.js";

const migratedState = (
  selectedStep: number,
  selectedSite: number | null,
): PersistedAnalysisState => ({
  version: 3,
  selectedStep,
  selectedSite,
  forceMode: "free",
  forceScale: 10,
  layout: DEFAULT_LAYOUT,
  convergence: DEFAULT_CONVERGENCE,
});

describe("runtime host selection", () => {
  it("uses the VS Code transport only when its API is present", () => {
    const api = { postMessage: vi.fn(), getState: () => undefined, setState: vi.fn() };

    const host = createRuntimeHost({ acquireVsCodeApi: () => api, window });

    expect(host).toBeInstanceOf(VsCodeHost);
    (host as VsCodeHost).dispose();
  });

  it("uses the same-origin HTTP protocol in a standalone browser", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, error: { code: "step_not_found", message: "missing" } }),
    });
    const host = createRuntimeHost({ fetch: fetcher, window });

    await expect(host.request("getStep", { stepIndex: 99 })).rejects.toMatchObject({
      code: "step_not_found",
    });
    expect(host).toBeInstanceOf(HttpHost);
    expect(fetcher).toHaveBeenCalledWith("/api/request", expect.objectContaining({ method: "POST" }));
  });

  it("restores standalone selection state after a browser reload", () => {
    sessionStorage.clear();
    const fetcher = vi.fn();
    const first = createRuntimeHost({ fetch: fetcher, window });
    first.setState(migratedState(4, 2));

    const reloaded = createRuntimeHost({ fetch: fetcher, window });

    expect(reloaded.getState()).toEqual(migratedState(4, 2));
  });

  it("falls back to memory when accessing sessionStorage itself throws", () => {
    const throwingWindow = Object.create(window) as Window;
    Object.defineProperty(throwingWindow, "sessionStorage", {
      get: () => { throw new DOMException("denied", "SecurityError"); },
    });

    const host = createRuntimeHost({ fetch: vi.fn(), window: throwingWindow });
    host.setState(migratedState(2, null));

    expect(host.getState()).toEqual(migratedState(2, null));
  });
});
