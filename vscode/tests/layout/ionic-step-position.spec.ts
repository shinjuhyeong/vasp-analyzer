import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const harnessHtml = await readFile(new URL("./toolbar-harness.html", import.meta.url), "utf8");
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./toolbar-harness.tsx", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outdir: testDirectory,
  define: { "process.env.NODE_ENV": '"development"' },
});
const javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const stylesheet = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
if (!javascript || !stylesheet) throw new Error("Harness bundle did not emit JavaScript and CSS");

for (const width of [1280, 640]) {
  test(`anchors ionic controls in the fixed primary grid at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 300 });
    await page.setContent(harnessHtml);
    await page.addStyleTag({ content: stylesheet });
    await page.addScriptTag({ content: javascript });

    const slider = page.getByLabel("Ionic step slider");
    await expect(slider).toBeVisible();
    const x = async (): Promise<number> =>
      slider.evaluate((node) => node.getBoundingClientRect().x);
    const row = page.getByTestId("structure-toolbar-primary");
    const initialX = await x();
    const initialHeight = await row.evaluate((node) => node.getBoundingClientRect().height);

    await page.getByRole("button", { name: "Select Initial" }).click();
    const selectedInitialX = await x();
    expect.soft(selectedInitialX).toBe(initialX);

    await page.getByLabel("Compare structures").check();
    const comparisonX = await x();
    expect.soft(comparisonX).toBe(initialX);
    expect(await row.evaluate((node) => node.getBoundingClientRect().height)).toBe(initialHeight);

    const expandBounds = await page.getByRole("button", { name: "Enter structure full-screen" }).boundingBox();
    expect(expandBounds).not.toBeNull();
    expect(expandBounds!.x).toBeGreaterThanOrEqual(0);
    expect(expandBounds!.x + expandBounds!.width).toBeLessThanOrEqual(width);

    console.log(JSON.stringify({
      width,
      initialX,
      selectedInitialX,
      comparisonX,
      primaryRowHeight: initialHeight,
      expandRight: expandBounds!.x + expandBounds!.width,
    }));
  });
}
