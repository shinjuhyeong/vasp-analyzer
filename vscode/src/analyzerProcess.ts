import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export type Method = "getDataset" | "getStep" | "getVolumetric";

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

const PYTHON_ENTRY = "from vasp_analyzer.cli import app; app()";

export function analyzerInvocation(calculationPath: string, pythonPath?: string): {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: false;
} {
  const command = pythonPath?.trim() || (process.platform === "win32" ? "python" : "python3");
  return {
    command,
    args: ["-c", PYTHON_ENTRY, "serve", "--stdio", calculationPath],
    shell: false,
  };
}

export function spawnAnalyzer(
  calculationPath: string,
  pythonPath?: string,
  options?: AnalyzerProcessOptions,
): AnalyzerProcess {
  const invocation = analyzerInvocation(calculationPath, pythonPath);
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
    child.once("error", (error: Error) => this.failAll(new Error(`Analyzer process failed: ${error.message}`)));
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
    if (this.closed) return;
    this.failAll(new Error("Analyzer process was disposed"));
    this.child.kill();
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
    const record = response as { id?: unknown; result?: unknown; error?: { message?: unknown } };
    if (!Number.isSafeInteger(record.id)) return;
    const id = record.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (record.error) {
      pending.reject(new Error(typeof record.error.message === "string" ? record.error.message : "Analyzer request failed"));
    } else if (Object.prototype.hasOwnProperty.call(record, "result")) {
      pending.resolve(record.result);
    } else {
      pending.reject(new Error("Analyzer returned an invalid response"));
    }
  }

  private terminate(error: Error): void {
    if (this.closed) return;
    this.failAll(error);
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
