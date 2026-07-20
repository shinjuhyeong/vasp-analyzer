import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlEndpoint, type ControlEndpoint } from "../controlEndpoint.js";

const endpoints: ControlEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

async function calculationFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vasp-endpoint-test-"));
  await writeFile(join(root, "OUTCAR"), "fixture\n");
  return root;
}

describe("control endpoint", () => {
  it("rejects an invalid token before opening a panel", async () => {
    const onOpen = vi.fn();
    const endpoint = await createControlEndpoint({ token: "s".repeat(32), onOpen });
    endpoints.push(endpoint);

    await expect(endpoint.request({ token: "wrong", path: await calculationFixture() })).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens only a canonical readable calculation root", async () => {
    const root = await calculationFixture();
    const onOpen = vi.fn(async () => undefined);
    const endpoint = await createControlEndpoint({ token: "t".repeat(32), onOpen });
    endpoints.push(endpoint);

    await expect(endpoint.request({ token: endpoint.token, path: join(root, "OUTCAR") })).resolves.toEqual({ ok: true });
    expect(onOpen).toHaveBeenCalledWith(await import("node:fs/promises").then((fs) => fs.realpath(root)));
  });

  it("rejects unreadable or oversized requests and responds once", async () => {
    const onOpen = vi.fn();
    const endpoint = await createControlEndpoint({
      token: "u".repeat(32),
      onOpen,
      maxRequestBytes: 128,
      requestTimeoutMs: 500,
    });
    endpoints.push(endpoint);

    await expect(endpoint.request({ token: endpoint.token, path: join(tmpdir(), "missing-outcar") })).resolves.toMatchObject({ ok: false });
    await expect(endpoint.sendRaw(Buffer.alloc(129, 97))).resolves.toMatchObject({ ok: false, error: "request_too_large" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removes its Unix socket when closed", async () => {
    if (process.platform === "win32") return;
    const endpoint = await createControlEndpoint({ token: "v".repeat(32), onOpen: async () => undefined });
    endpoints.push(endpoint);
    const address = endpoint.address;
    await endpoint.close();
    endpoints.pop();
    await expect(import("node:fs/promises").then((fs) => fs.stat(address))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
