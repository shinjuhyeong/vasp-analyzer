import { build } from "esbuild";
import { rm } from "node:fs/promises";

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
]);
