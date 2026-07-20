// @vitest-environment jsdom

import { HttpHost, HostRequestError, VsCodeHost } from "./host.js";
import { describe, expect, it, vi } from "vitest";

describe("analysis hosts", () => {
  it("correlates concurrent VS Code responses by request ID", async () => {
    const messages: unknown[] = [];
    const api = { postMessage: (message: unknown) => messages.push(message), getState: () => undefined, setState: () => undefined };
    const host = new VsCodeHost(api, window);
    const dataset = host.request("getDataset", {});
    const step = host.request("getStep", { stepIndex: 1 });
    const [first, second] = messages as Array<{ requestId: number }>;

    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: second!.requestId, result: { index: 1 } } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: first!.requestId, result: { schemaVersion: 1 } } }));

    await expect(dataset).resolves.toEqual({ schemaVersion: 1 });
    await expect(step).resolves.toEqual({ index: 1 });
    host.dispose();
  });

  it("rejects a correlated typed VS Code error", async () => {
    const messages: Array<{ requestId: number }> = [];
    const host = new VsCodeHost({ postMessage: (message) => messages.push(message as { requestId: number }), getState: () => undefined, setState: () => undefined }, window);
    const result = host.request("getStep", { stepIndex: 9 });

    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: messages[0]?.requestId, error: { code: "step_not_found", message: "missing" } } }));

    await expect(result).rejects.toMatchObject({ name: "HostRequestError", code: "step_not_found", message: "missing" });
    host.dispose();
  });

  it("uses the same request interface for HTTP and preserves typed errors", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, error: { code: "capability_unavailable", message: "not ready" } }) });
    const host = new HttpHost("http://127.0.0.1:8765", fetcher);

    await expect(host.request("getDataset", {})).rejects.toEqual(new HostRequestError("capability_unavailable", "not ready"));
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8765", expect.objectContaining({ method: "POST" }));
  });
});
