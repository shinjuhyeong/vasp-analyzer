import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export type Method = "getDataset" | "getStep" | "getVolumetric" | "getNormalizationManifest" | "getNormalizedOutcar";

export class AnalyzerProtocolError extends Error {
  override readonly name = "AnalyzerProtocolError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AnalyzerChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface AnalyzerProcessOptions {
  readonly requestTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxLineBytes?: number;
  readonly maxStderrBytes?: number;
}

export interface AnalyzerLaunchConfiguration {
  readonly executablePath?: string;
  readonly pythonPath?: string;
  readonly profilePath?: string;
}

export function analyzerInvocation(calculationPath: string, configuration: AnalyzerLaunchConfiguration = {}): {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: false;
} {
  const pythonPath = configuration.pythonPath?.trim();
  const command = pythonPath || configuration.executablePath?.trim() || "analyzer";
  const profileArgs = configuration.profilePath === undefined
    ? []
    : ["--profile", configuration.profilePath];
  return {
    command,
    args: pythonPath
      ? ["-m", "vasp_analyzer.cli", "serve", "--stdio", calculationPath, ...profileArgs]
      : ["serve", "--stdio", calculationPath, ...profileArgs],
    shell: false,
  };
}

export function spawnAnalyzer(
  calculationPath: string,
  configuration?: AnalyzerLaunchConfiguration,
  options?: AnalyzerProcessOptions,
): AnalyzerProcess {
  const invocation = analyzerInvocation(calculationPath, configuration);
  const child: ChildProcessWithoutNullStreams = spawn(invocation.command, [...invocation.args], {
    shell: invocation.shell,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  return new AnalyzerProcess(child, options);
}

export class AnalyzerProcess {
  private readonly pending = new Map<number, Pending>();
  private readonly requestTimeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxLineBytes: number;
  private readonly maxStderrBytes: number;
  private nextId = 0;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = Buffer.alloc(0);
  private closed = false;
  private killIssued = false;

  constructor(
    private readonly child: AnalyzerChild,
    options: AnalyzerProcessOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
    this.maxLineBytes = options.maxLineBytes ?? 256 * 1024 * 1024;
    this.maxStderrBytes = options.maxStderrBytes ?? 64 * 1024;
    child.stdout.on("data", (chunk: Buffer | string) => this.onStdout(Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer | string) => this.onStderr(Buffer.from(chunk)));
    child.stdin.on("error", (error: Error) => this.terminate(new Error(`Analyzer stdin failed: ${error.message}`)));
    child.stdout.on("error", (error: Error) => this.terminate(new Error(`Analyzer stdout failed: ${error.message}`)));
    child.stderr.on("error", (error: Error) => this.terminate(new Error(`Analyzer stderr failed: ${error.message}`)));
    child.on("error", (error: Error) =>
      this.terminate(new Error(`Analyzer process failed: ${error.message}`)),
    );
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) =>
      this.failAll(new Error(`Analyzer process exited (${code ?? signal ?? "unknown"})`)),
    );
  }

  get stderrTail(): string {
    return this.stderrBuffer.toString("utf8");
  }

  request(method: Method, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Analyzer process is closed"));
    const id = ++this.nextId;
    const line = Buffer.from(`${JSON.stringify({ id, method, params })}\n`, "utf8");
    if (line.length > this.maxRequestBytes) return Promise.reject(new Error("Analyzer request exceeds the size limit"));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Analyzer request ${id} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(line, (error?: Error | null) => {
        if (!error) return;
        this.terminate(error);
      });
    });
  }

  dispose(): void {
    this.failAll(new Error("Analyzer process was disposed"));
    this.killChild();
  }

  private onStderr(chunk: Buffer): void {
    this.stderrBuffer = Buffer.concat([this.stderrBuffer, chunk]);
    if (this.stderrBuffer.length > this.maxStderrBytes) {
      this.stderrBuffer = this.stderrBuffer.subarray(this.stderrBuffer.length - this.maxStderrBytes);
    }
  }

  private onStdout(chunk: Buffer): void {
    if (this.closed) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const newline = this.stdoutBuffer.indexOf(10);
      if (newline < 0) {
        if (this.stdoutBuffer.length > this.maxLineBytes) {
          this.terminate(new Error("Analyzer response exceeds the size limit"));
        }
        return;
      }
      if (newline > this.maxLineBytes) {
        this.terminate(new Error("Analyzer response exceeds the size limit"));
        return;
      }
      const line = this.stdoutBuffer.subarray(0, newline).toString("utf8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      this.onResponse(line);
      if (this.closed) return;
    }
  }

  private onResponse(line: string): void {
    let response: unknown;
    try {
      response = JSON.parse(line);
    } catch {
      this.terminate(new Error("Analyzer returned invalid JSON"));
      return;
    }
    if (!response || typeof response !== "object") return;
    const record = response as { id?: unknown; result?: unknown; error?: unknown };
    if (!Number.isSafeInteger(record.id)) return;
    const id = record.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (record.error !== undefined) {
      if (
        record.error &&
        typeof record.error === "object" &&
        typeof (record.error as { code?: unknown }).code === "string" &&
        typeof (record.error as { message?: unknown }).message === "string"
      ) {
        const protocolError = record.error as { code: string; message: string };
        pending.reject(new AnalyzerProtocolError(protocolError.code, protocolError.message));
      } else {
        pending.reject(new Error("Analyzer returned an invalid response"));
      }
    } else if (Object.prototype.hasOwnProperty.call(record, "result")) {
      pending.resolve(record.result);
    } else {
      pending.reject(new Error("Analyzer returned an invalid response"));
    }
  }

  private terminate(error: Error): void {
    this.failAll(error);
    this.killChild();
  }

  private killChild(): void {
    if (this.killIssued) return;
    this.killIssued = true;
    this.child.kill();
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.stdoutBuffer = Buffer.alloc(0);
  }
}
