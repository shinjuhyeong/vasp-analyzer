import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

async function profileFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vasp-profile-test-"));
  const profile = join(root, "profile.toml");
  await writeFile(profile, "[analysis]\n");
  return profile;
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
    const onOpen = vi.fn(async (
      _calculation: { readonly root: string; readonly profilePath: string | null },
      _signal: AbortSignal,
    ) => undefined);
    const endpoint = await createControlEndpoint({ token: "t".repeat(32), onOpen });
    endpoints.push(endpoint);

    await expect(endpoint.request({ token: endpoint.token, path: join(root, "OUTCAR") })).resolves.toEqual({ ok: true });
    expect(onOpen).toHaveBeenCalledWith({
      root: await import("node:fs/promises").then((fs) => fs.realpath(root)),
      profilePath: null,
    }, expect.anything());
    expect((onOpen.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(false);
  });

  it("forwards a canonical readable profile file with the calculation", async () => {
    const root = await calculationFixture();
    const profile = await profileFixture();
    const onOpen = vi.fn();
    const endpoint = await createControlEndpoint({ token: "p".repeat(32), onOpen });
    endpoints.push(endpoint);

    await expect(endpoint.request({ token: endpoint.token, path: root, profile })).resolves.toEqual({ ok: true });
    expect(onOpen).toHaveBeenCalledWith({
      root: await import("node:fs/promises").then((fs) => fs.realpath(root)),
      profilePath: await import("node:fs/promises").then((fs) => fs.realpath(profile)),
    }, expect.anything());
  });

  it.each(["missing", "directory"])("rejects a %s profile without opening", async (kind) => {
    const root = await calculationFixture();
    const profileRoot = await mkdtemp(join(tmpdir(), "vasp-invalid-profile-test-"));
    const profile = kind === "directory" ? profileRoot : join(profileRoot, "missing.toml");
    const onOpen = vi.fn();
    const endpoint = await createControlEndpoint({ token: "q".repeat(32), onOpen });
    endpoints.push(endpoint);

    await expect(endpoint.request({ token: endpoint.token, path: root, profile })).resolves.toEqual({
      ok: false,
      error: "invalid_path",
    });
    expect(onOpen).not.toHaveBeenCalled();
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

  it("rejects a directory named OUTCAR", async () => {
    const root = await mkdtemp(join(tmpdir(), "vasp-endpoint-directory-"));
    await mkdir(join(root, "OUTCAR"));
    const onOpen = vi.fn();
    const endpoint = await createControlEndpoint({ token: "d".repeat(32), onOpen });
    endpoints.push(endpoint);
    await expect(endpoint.request({ token: endpoint.token, path: root })).resolves.toMatchObject({
      ok: false,
      error: "invalid_path",
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("aborts an in-flight canonicalization before invoking onOpen when closed", async () => {
    let releaseResolution!: (value: string) => void;
    let resolutionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolutionStarted = resolve;
    });
    const resolution = new Promise<string>((resolve) => {
      releaseResolution = resolve;
    });
    const onOpen = vi.fn();
    const endpoint = await createControlEndpoint({
      token: "r".repeat(32),
      onOpen,
      resolvePath: async () => {
        resolutionStarted();
        return await resolution;
      },
    });
    endpoints.push(endpoint);
    const request = endpoint.request({ token: endpoint.token, path: "deferred" });
    const requestResult = expect(request).rejects.toThrow("control endpoint closed before response");
    await started;
    const closing = endpoint.close();
    releaseResolution("canonical");
    await closing;
    endpoints.pop();
    await requestResult;
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("aborts callbacks already running when the endpoint closes", async () => {
    let releaseOpen!: () => void;
    let openStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      openStarted = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    let sideEffects = 0;
    const endpoint = await createControlEndpoint({
      token: "c".repeat(32),
      resolvePath: async () => "canonical",
      onOpen: async (_calculation, signal) => {
        openStarted();
        await barrier;
        if (!signal.aborted) sideEffects += 1;
      },
    });
    endpoints.push(endpoint);
    const request = endpoint.request({ token: endpoint.token, path: "deferred" });
    const requestResult = expect(request).rejects.toThrow("control endpoint closed before response");
    await started;
    const closing = endpoint.close();
    releaseOpen();
    await closing;
    endpoints.pop();
    await requestResult;
    expect(sideEffects).toBe(0);
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
