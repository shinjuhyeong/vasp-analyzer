import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/webview.ts"],
    bundle: true,
    outfile: "dist/webview/index.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
    sourcemap: true,
  }),
]);
