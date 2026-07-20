import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  AnalyzerProcess,
  AnalyzerProtocolError,
  analyzerInvocation,
  type AnalyzerChild,
} from "../analyzerProcess.js";

function fakeChild(): AnalyzerChild & { stdout: PassThrough; stderr: PassThrough; exit: (code?: number) => void } {
  const emitter = new EventEmitter() as AnalyzerChild & {
    stdout: PassThrough;
    stderr: PassThrough;
    exit: (code?: number) => void;
  };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.stdin = new PassThrough();
  emitter.kill = vi.fn(() => true);
  emitter.exit = (code = 0) => emitter.emit("exit", code, null);
  return emitter;
}

describe("AnalyzerProcess", () => {
  it("defaults to the pipx-style analyzer executable without a shell", () => {
    const invocation = analyzerInvocation("/work/a path/$(unsafe)");
    expect(invocation.command).toBe("analyzer");
    expect(invocation.shell).toBe(false);
    expect(invocation.args).toEqual(["serve", "--stdio", "/work/a path/$(unsafe)"]);
  });

  it.each(["/opt/tools/analyzer", String.raw`C:\Tools\VASP Analyzer\analyzer.exe`])(
    "uses explicit executable path %s as one non-shell command",
    (executablePath) => {
      const invocation = analyzerInvocation("/work/calc", { executablePath });
      expect(invocation).toMatchObject({ command: executablePath, shell: false });
      expect(invocation.args).toEqual(["serve", "--stdio", "/work/calc"]);
    },
  );

  it("gives an explicit Python module override precedence over executablePath", () => {
    const invocation = analyzerInvocation("/work/a path/$(unsafe)", {
      executablePath: "custom-analyzer",
      pythonPath: "python-custom",
    });
    expect(invocation.command).toBe("python-custom");
    expect(invocation.shell).toBe(false);
    expect(invocation.args.slice(0, 2)).toEqual(["-m", "vasp_analyzer.cli"]);
    expect(invocation.args.at(-1)).toBe("/work/a path/$(unsafe)");
  });

  it("keeps a Windows calculation path as one literal argument", () => {
    const calculation = String.raw`C:\Users\name\calc & echo unsafe`;
    const invocation = analyzerInvocation(calculation);
    expect(invocation.shell).toBe(false);
    expect(invocation.args.at(-1)).toBe(calculation);
  });

  it("correlates newline-delimited responses by JSON id", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child);
    const first = analyzer.request("getDataset", {});
    const second = analyzer.request("getStep", { stepIndex: 0 });

    child.stdout.write('{"id":2,"result":{"stepIndex":0}}\n{"id":1,"result":{"schemaVersion":1}}\n');

    await expect(first).resolves.toMatchObject({ schemaVersion: 1 });
    await expect(second).resolves.toMatchObject({ stepIndex: 0 });
    analyzer.dispose();
  });

  it("rejects protocol errors and all pending requests when the child exits", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child);
    const failed = analyzer.request("getDataset", {});
    child.stdout.write('{"id":1,"error":{"code":"invalid_request","message":"bad"}}\n');
    await expect(failed).rejects.toThrow("bad");

    const pending = analyzer.request("getDataset", {});
    child.exit(7);
    await expect(pending).rejects.toThrow(/exited/);
  });

  it.each(["capability_unavailable", "step_not_found", "invalid_request"])(
    "preserves the typed protocol error %s",
    async (code) => {
      const child = fakeChild();
      const analyzer = new AnalyzerProcess(child);
      const pending = analyzer.request("getDataset", {});
      child.stdout.write(`${JSON.stringify({ id: 1, error: { code, message: "typed failure" } })}\n`);
      const error = await pending.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AnalyzerProtocolError);
      expect(error).toMatchObject({ code, message: "typed failure" });
    },
  );

  it("bounds unterminated stdout, stderr, and request duration", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child, { maxLineBytes: 32, maxStderrBytes: 16, requestTimeoutMs: 10 });
    const oversized = analyzer.request("getDataset", {});
    child.stderr.write("private path that must stay bounded");
    child.stdout.write("x".repeat(33));
    await expect(oversized).rejects.toThrow(/size limit/);
    expect(analyzer.stderrTail.length).toBeLessThanOrEqual(16);

    const other = fakeChild();
    const timed = new AnalyzerProcess(other, { requestTimeoutMs: 5 }).request("getDataset", {});
    await expect(timed).rejects.toThrow(/timed out/);
  });

  it("bounds outbound requests independently from large dataset responses", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child, { maxRequestBytes: 64, maxLineBytes: 1024 });
    await expect(analyzer.request("getStep", { extra: "x".repeat(80) })).rejects.toThrow(/request exceeds/);
  });

  it("rejects a request when stdin cannot accept it", async () => {
    const child = fakeChild();
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("closed"));
      },
    });
    const analyzer = new AnalyzerProcess(child);
    await expect(analyzer.request("getDataset", {})).rejects.toThrow("closed");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("terminates and rejects pending requests on output stream errors", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child);
    const pending = analyzer.request("getDataset", {});
    child.stdout.emit("error", new Error("broken output"));
    await expect(pending).rejects.toThrow("broken output");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("kills a live child once and rejects pending once when the child emits errors", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child);
    let rejected = 0;
    const pending = analyzer.request("getDataset", {}).catch((error: unknown) => {
      rejected += 1;
      throw error;
    });
    child.emit("error", new Error("spawn channel failed"));
    child.emit("error", new Error("duplicate error"));
    analyzer.dispose();
    await expect(pending).rejects.toThrow("spawn channel failed");
    expect(rejected).toBe(1);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects a correlated response without a result or error", async () => {
    const child = fakeChild();
    const analyzer = new AnalyzerProcess(child);
    const pending = analyzer.request("getDataset", {});
    child.stdout.write('{"id":1}\n');
    await expect(pending).rejects.toThrow(/invalid response/);
  });
});
