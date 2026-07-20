import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("runs in the workspace host and contributes command and OUTCAR menu", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.extensionKind).toEqual(["workspace"]);
    expect(manifest.main).toBe("./dist/extension.js");
    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining(["onStartupFinished", "onCommand:vaspAnalyzer.open"]),
    );
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: "vaspAnalyzer.open" }));
    expect(manifest.contributes.menus["explorer/context"]).toContainEqual(
      expect.objectContaining({ command: "vaspAnalyzer.open", when: "resourceFilename == OUTCAR" }),
    );
  });

  it("does not apply an extension filter to extensionless OUTCAR selections", async () => {
    const source = await readFile(new URL("../extension.ts", import.meta.url), "utf8");
    expect(source).not.toContain("filters:");
    expect(source).toContain("resolveCalculationRoot");
    expect(source).toContain("new ActivationCoordinator<ControlEndpoint>()");
    expect(source).toContain("return activationCoordinator.deactivate()");
    expect(source).toContain("registerContextCleanup(context);");
    expect(source.indexOf("registerContextCleanup(context);")).toBeLessThan(
      source.indexOf("activationCoordinator.activate(plan.factory, plan.install)"),
    );
  });
});
