// @vitest-environment jsdom

import { HttpHost, HostRequestError, VsCodeHost } from "./host.js";
import { describe, expect, it, vi } from "vitest";

import { twoStepDataset } from "../test/fixtures.js";
import { DEFAULT_CONVERGENCE } from "./store.js";

const step = twoStepDataset.ionicSteps[0]!;

function detailedDatasetResult(): any {
  const result: any = structuredClone(twoStepDataset);
  result.sourceFiles = [{ path: "/calculation/OUTCAR", size: 1024, mtimeNs: 42, fingerprint: "sha256:test" }];
  result.parameters = [{
    key: "encut", rawKey: "ENCUT", rawValue: "520", value: [520],
    unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 0, lineNumber: 4,
  }];
  result.warnings = [{ category: "IncompleteTail", message: "trailing partial block", byteOffset: null, lineNumber: null }];
  result.provenance = {
    adapter: "ase", adapterVersion: "1", dialect: "stock", profileId: null,
    normalizationRules: [], compatibilityMetadata: [],
  };
  result.ionicSteps = result.ionicSteps.map((item: any) => ({
    ...item,
    energyTerms: [{ key: "ewald", rawLabel: "Ewald energy", value: -4.2, unit: "eV", kind: "contribution" }],
    externalPressureKb: 2.5,
    pulayStressKb: null,
    stressTensorKb: [[1, 0, 0], [0, 2, 0], [0, 0, 3]],
    cellVolume: 27,
  }));
  return result;
}

function sparse(length: number): unknown[] {
  return new Array(length);
}

function withJsonOwnExtra(result: unknown, key: string): any {
  const json = JSON.stringify(result);
  return JSON.parse(`${json.slice(0, -1)},${JSON.stringify(key)}:true}`);
}

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
  it.each([
    ["VS Code", (state: unknown) => new VsCodeHost({ postMessage: vi.fn(), getState: () => state, setState: vi.fn() }, window)],
    ["HTTP", (state: unknown) => new HttpHost("http://local", vi.fn(), {
      getItem: () => JSON.stringify(state),
      setItem: vi.fn(),
    })],
  ])("migrates legacy selection state in the %s host", (_name, createHost) => {
    const host = createHost({ selectedStep: 1, selectedSite: 0 });

    expect(host.getState()).toEqual({
      version: 3,
      selectedStep: 1,
      selectedSite: 0,
      forceMode: "free",
      forceScale: 10,
      layout: {
        structurePercent: 60,
        inspectorWidth: 280,
        inspectorCollapsed: true,
        paletteX: 10,
        paletteY: 10,
        paletteCollapsed: true,
      },
      convergence: DEFAULT_CONVERGENCE,
    });
    if (host instanceof VsCodeHost) host.dispose();
  });

  it("migrates version-2 preferences to Energy-only convergence defaults", () => {
    const host = new VsCodeHost({
      postMessage: vi.fn(),
      getState: () => ({
        version: 2,
        selectedStep: 1,
        selectedSite: 0,
        forceMode: "raw",
        forceScale: 250,
        layout: {
          structurePercent: Number.NaN,
          inspectorWidth: 420,
          inspectorCollapsed: "no",
          paletteX: -15,
          paletteY: 24,
          paletteCollapsed: false,
        },
      }),
      setState: vi.fn(),
    }, window);

    expect(host.getState()).toEqual({
      version: 3,
      selectedStep: 1,
      selectedSite: 0,
      forceMode: "raw",
      forceScale: 250,
      layout: {
        structurePercent: 60,
        inspectorWidth: 420,
        inspectorCollapsed: true,
        paletteX: 0,
        paletteY: 24,
        paletteCollapsed: false,
      },
      convergence: DEFAULT_CONVERGENCE,
    });
    host.dispose();
  });

  it.each([
    [0, 1],
    [1001, 1000],
  ])("clamps persisted force scale %s to %s", (forceScale, expected) => {
    const host = new VsCodeHost({
      postMessage: vi.fn(),
      getState: () => ({ version: 2, selectedStep: 0, selectedSite: null, forceMode: "free", forceScale, layout: {} }),
      setState: vi.fn(),
    }, window);

    expect(host.getState()?.forceScale).toBe(expected);
    host.dispose();
  });

  it("rejects persisted state from an unsupported schema version", () => {
    const host = new VsCodeHost({
      postMessage: vi.fn(),
      getState: () => ({
        version: 4,
        selectedStep: 1,
        selectedSite: 0,
        forceMode: "raw",
        forceScale: 250,
        layout: {
          structurePercent: 60,
          inspectorWidth: 280,
          inspectorCollapsed: false,
          paletteX: 20,
          paletteY: 20,
          paletteCollapsed: false,
        },
      }),
      setState: vi.fn(),
    }, window);

    expect(host.getState()).toBeUndefined();
    host.dispose();
  });

  it("normalizes version-3 convergence preferences canonically", () => {
    const host = new VsCodeHost({
      postMessage: vi.fn(),
      getState: () => ({
        version: 3,
        selectedStep: 0,
        selectedSite: null,
        forceMode: "free",
        forceScale: 10,
        layout: {},
        convergence: {
          selectedModules: ["cellStress", "energy", "cellStress", "unknown"],
          metrics: { energy: "bad", force: "rmsFreeForce", cellStress: "cellVolume" },
          modes: { energy: "table", force: "bad", cellStress: "table" },
        },
      }),
      setState: vi.fn(),
    }, window);

    expect(host.getState()?.convergence).toEqual({
      selectedModules: ["energy", "cellStress"],
      metrics: { energy: "totalEnergy", force: "rmsFreeForce", cellStress: "cellVolume" },
      modes: { energy: "table", force: "graph", cellStress: "table" },
    });
    host.dispose();
  });

  it("normalizes an empty version-3 module list to Energy only", () => {
    const host = new VsCodeHost({
      postMessage: vi.fn(),
      getState: () => ({
        version: 3,
        selectedStep: 0,
        selectedSite: null,
        forceMode: "free",
        forceScale: 10,
        layout: {},
        convergence: { selectedModules: [], metrics: {}, modes: {} },
      }),
      setState: vi.fn(),
    }, window);

    expect(host.getState()?.convergence.selectedModules).toEqual(["energy"]);
    host.dispose();
  });

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

  it("converts browser transport failures to a typed HTTP error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("connection detail"));

    await expect(new HttpHost("/api/request", fetcher).request("getDataset", {})).rejects.toEqual(
      new HostRequestError("http_error", "Analyzer HTTP request failed"),
    );
  });

  it.each([
    ["incomplete dataset", { schemaVersion: 3 }],
    ["schema-2 dataset", { ...twoStepDataset, schemaVersion: 2 }],
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

  it("accepts a complete schema-3 dataset with a null initial structure", async () => {
    const result = detailedDatasetResult();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).resolves.toEqual(result);
  });

  it("accepts a complete schema-3 dataset with a valid initial structure", async () => {
    const result = detailedDatasetResult();
    result.initialStructure = {
      source: "POSCAR",
      lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
      fractionalPositions: [[0, 0, 0], [0.5, 0.5, 0.5]],
      cartesianPositions: [[0, 0, 0], [1.5, 1.5, 1.5]],
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).resolves.toEqual(result);
  });

  it.each([
    ["missing initialStructure", (dataset: any) => { delete dataset.initialStructure; }],
    ["mismatched initial coordinate lengths", (dataset: any) => { dataset.initialStructure.cartesianPositions.pop(); }],
    ["initial coordinates mismatched with sites", (dataset: any) => { dataset.initialStructure.fractionalPositions.pop(); dataset.initialStructure.cartesianPositions.pop(); }],
    ["non-finite initial lattice", (dataset: any) => { dataset.initialStructure.lattice[0][0] = Number.NaN; }],
    ["finite singular initial lattice", (dataset: any) => { dataset.initialStructure.lattice = [[1, 0, 0], [2, 0, 0], [0, 0, 1]]; }],
    ["non-finite initial coordinate", (dataset: any) => { dataset.initialStructure.fractionalPositions[0][0] = Number.POSITIVE_INFINITY; }],
    ["unknown initial source", (dataset: any) => { dataset.initialStructure.source = "CONTCAR"; }],
  ])("rejects %s", async (_name, mutate) => {
    const result = detailedDatasetResult();
    result.initialStructure = {
      source: "POSCAR",
      lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
      fractionalPositions: [[0, 0, 0], [0.5, 0.5, 0.5]],
      cartesianPositions: [[0, 0, 0], [1.5, 1.5, 1.5]],
    };
    mutate(result);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("accepts exact JSON-parsed and null-prototype records with declared nullable fields", async () => {
    const jsonResult = JSON.parse(JSON.stringify(detailedDatasetResult()));
    jsonResult.parameters[0] = Object.assign(Object.create(null), jsonResult.parameters[0], {
      unit: null, category: null, description: null, lineNumber: null,
    });
    const nullPrototypeResult = Object.assign(Object.create(null), jsonResult);
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, result: jsonResult }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 2, result: nullPrototypeResult }) });
    const host = new HttpHost("http://local", fetcher);

    await expect(host.request("getDataset", {})).resolves.toEqual(jsonResult);
    await expect(host.request("getDataset", {})).resolves.toEqual(nullPrototypeResult);
  });

  it.each([
    ["non-finite nested stress", (dataset: any) => { dataset.ionicSteps[0].stressTensorKb[1][1] = Number.NaN; }],
    ["malformed stress shape", (dataset: any) => { dataset.ionicSteps[0].stressTensorKb = [[1, 0, 0]]; }],
    ["non-positive cell volume", (dataset: any) => { dataset.ionicSteps[0].cellVolume = 0; }],
    ["empty energy label", (dataset: any) => { dataset.ionicSteps[0].energyTerms[0].rawLabel = "  "; }],
    ["malformed parameter occurrence", (dataset: any) => { dataset.parameters[0].ordinal = -1; }],
    ["non-finite typed parameter tuple", (dataset: any) => { dataset.parameters[0].value = [1, Number.POSITIVE_INFINITY]; }],
  ])("rejects %s in a schema-3 result", async (_name, mutate) => {
    const result = detailedDatasetResult();
    mutate(result);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    ["lattice row", (dataset: any) => { dataset.ionicSteps[0].lattice[0] = sparse(3); }],
    ["stress row", (dataset: any) => { dataset.ionicSteps[0].stressTensorKb[0] = sparse(3); }],
    ["fractional positions", (dataset: any) => { dataset.ionicSteps[0].fractionalPositions = sparse(2); }],
    ["Cartesian positions", (dataset: any) => { dataset.ionicSteps[0].cartesianPositions = sparse(2); }],
    ["raw forces", (dataset: any) => { dataset.ionicSteps[0].rawForces = sparse(2); }],
    ["free forces", (dataset: any) => { dataset.ionicSteps[0].freeForces = sparse(2); }],
    ["free force norms", (dataset: any) => { dataset.ionicSteps[0].freeForceNorms = sparse(2); }],
    ["energy terms", (dataset: any) => { dataset.ionicSteps[0].energyTerms = sparse(1); }],
    ["parameter tuple", (dataset: any) => { dataset.parameters[0].value = sparse(1); }],
    ["source files", (dataset: any) => { dataset.sourceFiles = sparse(1); }],
    ["sites", (dataset: any) => { dataset.sites = sparse(2); }],
    ["ionic steps", (dataset: any) => { dataset.ionicSteps = sparse(2); }],
    ["parameters", (dataset: any) => { dataset.parameters = sparse(1); }],
    ["capabilities", (dataset: any) => { dataset.capabilities = sparse(5); }],
    ["warnings", (dataset: any) => { dataset.warnings = sparse(1); }],
  ])("rejects a sparse %s array", async (_name, mutate) => {
    const result = detailedDatasetResult();
    mutate(result);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects a dataset whose required fields are inherited", async () => {
    const inheritedOnly = Object.create(detailedDatasetResult());
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result: inheritedOnly }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    ["dataset", (dataset: any) => { dataset.futureSchemaField = true; }],
    ["source file", (dataset: any) => { dataset.sourceFiles[0].futureField = true; }],
    ["site", (dataset: any) => { dataset.sites[0].futureField = true; }],
    ["selective mask", (dataset: any) => { dataset.sites[0].selectiveDynamics.futureField = true; }],
    ["ionic step", (dataset: any) => { dataset.ionicSteps[0].futureField = true; }],
    ["force component", (dataset: any) => { dataset.ionicSteps[0].strongestFreeComponent.futureField = true; }],
    ["energy term", (dataset: any) => { dataset.ionicSteps[0].energyTerms[0].futureField = true; }],
    ["parameter occurrence", (dataset: any) => { dataset.parameters[0].futureField = true; }],
    ["capability", (dataset: any) => { dataset.capabilities[0].futureField = true; }],
    ["warning", (dataset: any) => { dataset.warnings[0].futureField = true; }],
    ["provenance", (dataset: any) => { dataset.provenance.futureField = true; }],
  ])("rejects an unknown own key on a %s record", async (_name, mutate) => {
    const result = detailedDatasetResult();
    mutate(result);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

    await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects a JSON-parsed own %s field",
    async (key) => {
      const result = withJsonOwnExtra(detailedDatasetResult(), key);
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
      const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, result }) });

      await expect(new HttpHost("http://local", fetcher).request("getDataset", {})).rejects.toMatchObject({ code: "invalid_response" });
    },
  );

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
