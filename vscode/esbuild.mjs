import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

await rm("dist", { recursive: true, force: true });

await Promise.all([
  build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
    legalComments: "none",
  }),
  build({
    entryPoints: ["src/webview.ts"],
    bundle: true,
    outfile: "dist/webview/index.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  build({
    entryPoints: ["src/webview/core/schema.ts"],
    bundle: true,
    outfile: "dist/webview/schema-contract.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
    legalComments: "none",
  }),
]);

const require = createRequire(import.meta.url);
const schemaContract = require("./dist/webview/schema-contract.cjs");
const webview = await readFile("dist/webview/index.js");
await writeFile(
  "dist/webview/contract.json",
  JSON.stringify({
    schemaVersion: schemaContract.DATASET_SCHEMA_VERSION,
    webviewSha256: createHash("sha256").update(webview).digest("hex"),
  }),
);
await rm("dist/webview/schema-contract.cjs");
