import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, open, realpath, stat, unlink } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_RESPONSE_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 2000;

export interface ControlRequest {
  readonly token: string;
  readonly path: string;
}

export type ControlResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface ControlEndpointOptions {
  readonly token?: string;
  readonly address?: string;
  readonly onOpen: (canonicalRoot: string) => void | Promise<void>;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
}

export interface ControlEndpoint {
  readonly address: string;
  readonly token: string;
  request(request: ControlRequest): Promise<ControlResponse>;
  sendRaw(payload: Buffer): Promise<ControlResponse>;
  close(): Promise<void>;
}

function secureTokenEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest) && actual.length === expected.length;
}

export async function resolveCalculationRoot(candidate: string): Promise<string> {
  if (!candidate || candidate.includes("\0")) throw new Error("invalid calculation path");
  const resolved = await realpath(candidate);
  const metadata = await stat(resolved);
  const root = metadata.isFile() && basename(resolved).toUpperCase() === "OUTCAR" ? dirname(resolved) : resolved;
  if (!metadata.isDirectory() && root === resolved) throw new Error("calculation path is not a directory or OUTCAR");
  const canonicalRoot = await realpath(root);
  const outcar = join(canonicalRoot, "OUTCAR");
  await access(outcar, fsConstants.R_OK);
  const handle = await open(outcar, "r");
  await handle.close();
  return canonicalRoot;
}

function defaultAddress(): string {
  const id = `${process.pid}-${randomBytes(12).toString("hex")}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\vasp-analyzer-${id}`
    : join(tmpdir(), `vasp-analyzer-${id}.sock`);
}

async function socketIsActive(address: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(address);
    const finish = (active: boolean) => {
      socket.destroy();
      resolve(active);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(200, () => finish(false));
  });
}

async function prepareUnixAddress(address: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const metadata = await lstat(address);
    if (metadata.isSymbolicLink() || !metadata.isSocket()) {
      throw new Error("control endpoint path is not a socket");
    }
    if (await socketIsActive(address)) throw new Error("control endpoint is already active");
    await unlink(address);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function encodeResponse(response: ControlResponse, maximum: number): Buffer {
  const encoded = Buffer.from(`${JSON.stringify(response)}\n`, "utf8");
  if (encoded.length > maximum) return Buffer.from('{"ok":false,"error":"response_too_large"}\n');
  return encoded;
}

export async function createControlEndpoint(options: ControlEndpointOptions): Promise<ControlEndpoint> {
  const token = options.token ?? randomBytes(32).toString("base64url");
  if (token.length < 32 || token.length > 512) throw new Error("control token length is invalid");
  const address = options.address ?? defaultAddress();
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  await prepareUnixAddress(address);

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let responded = false;
    const respond = (response: ControlResponse) => {
      if (responded) return;
      responded = true;
      socket.end(encodeResponse(response, maxResponseBytes));
    };
    socket.setTimeout(requestTimeoutMs, () => respond({ ok: false, error: "timeout" }));
    socket.on("data", (chunk: Buffer) => {
      if (responded) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxRequestBytes) {
        respond({ ok: false, error: "request_too_large" });
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      const line = buffer.subarray(0, newline);
      void (async () => {
        let request: Partial<ControlRequest>;
        try {
          request = JSON.parse(line.toString("utf8")) as Partial<ControlRequest>;
        } catch {
          respond({ ok: false, error: "invalid_request" });
          return;
        }
        if (!secureTokenEqual(request.token, token)) {
          respond({ ok: false, error: "unauthorized" });
          return;
        }
        if (typeof request.path !== "string" || request.path.length > 32767) {
          respond({ ok: false, error: "invalid_path" });
          return;
        }
        try {
          const canonicalRoot = await resolveCalculationRoot(request.path);
          if (responded) return;
          await options.onOpen(canonicalRoot);
          respond({ ok: true });
        } catch {
          respond({ ok: false, error: "invalid_path" });
        }
      })();
    });
    socket.once("close", () => {
      responded = true;
      sockets.delete(socket);
    });
    socket.once("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(address, () => {
      server.off("error", onError);
      resolve();
    });
  });

  let closed = false;
  const sendRaw = async (payload: Buffer): Promise<ControlResponse> =>
    await new Promise<ControlResponse>((resolve, reject) => {
      const client = createConnection(address);
      let response = Buffer.alloc(0);
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("control endpoint request timed out"));
      }, requestTimeoutMs + 250);
      client.once("connect", () => client.write(payload));
      client.on("data", (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > maxResponseBytes) client.destroy(new Error("control endpoint response exceeds limit"));
      });
      client.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      client.once("end", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(response.toString("utf8")) as ControlResponse);
        } catch (error) {
          reject(error);
        }
      });
    });

  return {
    address,
    token,
    request: async (request) => await sendRaw(Buffer.from(`${JSON.stringify(request)}\n`, "utf8")),
    sendRaw,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      if (process.platform !== "win32") {
        try {
          await unlink(address);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    },
  };
}
