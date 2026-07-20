// @vitest-environment jsdom

import { HttpHost, HostRequestError, VsCodeHost } from "./host.js";
import { describe, expect, it, vi } from "vitest";

import { twoStepDataset } from "../test/fixtures.js";

const step = twoStepDataset.ionicSteps[0]!;

function vscodeHarness() {
  const messages: Array<{ requestId: number }> = [];
  const host = new VsCodeHost({
    postMessage: (message) => messages.push(message as { requestId: number }),
    getState: () => undefined,
    setState: () => undefined,
  }, window);
  return { host, messages };
}

describe("analysis hosts", () => {
  it("correlates concurrent VS Code responses by request ID", async () => {
    const messages: unknown[] = [];
    const api = { postMessage: (message: unknown) => messages.push(message), getState: () => undefined, setState: () => undefined };
    const host = new VsCodeHost(api, window);
    const dataset = host.request("getDataset", {});
    const step = host.request("getStep", { stepIndex: 1 });
    const [first, second] = messages as Array<{ requestId: number }>;

    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: second!.requestId, result: twoStepDataset.ionicSteps[1] } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: first!.requestId, result: twoStepDataset } }));

    await expect(dataset).resolves.toEqual(twoStepDataset);
    await expect(step).resolves.toEqual(twoStepDataset.ionicSteps[1]);
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

  it.each([
    ["incomplete dataset", { schemaVersion: 1 }],
    ["wrong method payload", step],
    ["null array", { ...twoStepDataset, sites: null }],
    ["invalid nested array", { ...twoStepDataset, ionicSteps: [{ ...step, lattice: [[1, 0, 0]] }] }],
    ["non-finite number", { ...twoStepDataset, ionicSteps: [{ ...step, totalEnergy: Number.NaN }, twoStepDataset.ionicSteps[1]] }],
  ])("rejects a %s result before it reaches the App", async (_name, result) => {
    const { host, messages } = vscodeHarness();
    const pending = host.request("getDataset", {});
    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: messages[0]!.requestId, result } }));

    await expect(pending).rejects.toEqual(new HostRequestError("invalid_response", "Analyzer returned an invalid response"));
    host.dispose();
  });

  it.each([
    ["malformed error", { type: "response", error: { code: 4, message: "bad" } }],
    ["ambiguous result and error", { type: "response", result: twoStepDataset, error: { code: "bad", message: "bad" } }],
    ["missing result and error", { type: "response" }],
  ])("rejects a %s envelope", async (_name, response) => {
    const { host, messages } = vscodeHarness();
    const pending = host.request("getDataset", {});
    window.dispatchEvent(new MessageEvent("message", { data: { ...response, requestId: messages[0]!.requestId } }));

    await expect(pending).rejects.toEqual(new HostRequestError("invalid_response", "Analyzer returned an invalid response"));
    host.dispose();
  });

  it("ignores unknown IDs and malformed messages without consuming the request", async () => {
    const { host, messages } = vscodeHarness();
    const pending = host.request("getStep", { stepIndex: 0 });
    window.dispatchEvent(new MessageEvent("message", { data: null }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: 999, result: step } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "other", requestId: messages[0]!.requestId, result: step } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", requestId: messages[0]!.requestId, result: step } }));

    await expect(pending).resolves.toEqual(step);
    host.dispose();
  });

  it("validates method-specific HTTP results with the shared rules", async () => {
    const incomplete = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result: { schemaVersion: 1 } }) });
    const wrongMethod = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result: twoStepDataset }) });

    await expect(new HttpHost("http://local", incomplete).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
    await expect(new HttpHost("http://local", wrongMethod).request("getStep", { stepIndex: 0 })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("accepts an empty ionic trajectory through both host transports", async () => {
    const empty = { ...twoStepDataset, ionicSteps: [] };
    const { host, messages } = vscodeHarness();
    const vscodeResult = host.request("getDataset", {});
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "response", requestId: messages[0]!.requestId, result: empty },
    }));
    await expect(vscodeResult).resolves.toEqual(empty);
    host.dispose();

    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, result: empty }),
    });
    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).resolves.toEqual(empty);
  });

  it("still rejects nonempty trajectories whose site arrays disagree", async () => {
    const inconsistent = {
      ...twoStepDataset,
      ionicSteps: [{ ...step, cartesianPositions: [[0, 0, 0]] }],
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, result: inconsistent }),
    });
    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("removes its listener, rejects pending work, and disposes idempotently", async () => {
    const events = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const host = new VsCodeHost({ postMessage: vi.fn(), getState: () => undefined, setState: vi.fn() }, events);
    const pending = host.request("getDataset", {});

    host.dispose();
    host.dispose();

    await expect(pending).rejects.toMatchObject({ code: "host_disposed" });
    expect(events.addEventListener).toHaveBeenCalledOnce();
    expect(events.removeEventListener).toHaveBeenCalledOnce();
  });
});
