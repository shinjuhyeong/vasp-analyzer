import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { CALCULATION_OPEN_DIALOG_OPTIONS, calculationPanelKey } from "../openCalculation.js";

describe("extension manifest", () => {
  it("runs in the workspace host and contributes command and OUTCAR menu", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.extensionKind).toEqual(["workspace"]);
    expect(manifest.main).toBe("./dist/extension.cjs");
    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining(["onStartupFinished", "onCommand:vaspAnalyzer.open"]),
    );
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: "vaspAnalyzer.open" }));
    for (const command of [
      "vaspAnalyzer.openNormalizedOutcar",
      "vaspAnalyzer.compareNormalizedOutcar",
    ]) {
      expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
        command,
        enablement: "vaspAnalyzer.normalizationAvailable",
      }));
    }
    const menu = manifest.contributes.menus["explorer/context"].find(
      (entry: { command?: string }) => entry.command === "vaspAnalyzer.open",
    );
    expect(menu.when).toBe("resourceFilename =~ /^outcar$/i");
    expect(CALCULATION_OPEN_DIALOG_OPTIONS).toMatchObject({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: false,
    });
    expect(calculationPanelKey("/work/calc", null)).not.toBe(
      calculationPanelKey("/work/calc", "/profiles/home.toml"),
    );
  });

  it("does not apply an extension filter to extensionless OUTCAR selections", async () => {
    const source = await readFile(new URL("../extension.ts", import.meta.url), "utf8");
    expect(source).not.toContain("filters:");
    expect(source).toContain("resolveCalculation");
    expect(source).toContain("new ActivationCoordinator<ControlEndpoint>()");
    expect(source).toContain("return activationCoordinator.deactivate()");
    expect(source).toContain("registerContextCleanup(context);");
    expect(source.indexOf("registerContextCleanup(context);")).toBeLessThan(
      source.indexOf("activationCoordinator.activate(plan.factory, plan.install)"),
    );
  });
});
