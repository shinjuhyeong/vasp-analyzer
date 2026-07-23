import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [vsixPath] = process.argv.slice(2);

if (!vsixPath) {
  throw new Error("Usage: node scripts/verify-vsix-entrypoint.mjs <vsix>");
}

const archive = new AdmZip(vsixPath);
const manifestEntry = archive.getEntry("extension/package.json");

if (!manifestEntry) {
  throw new Error("VSIX does not contain extension/package.json");
}

const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));

if (typeof manifest.main !== "string" || !manifest.main.endsWith(".cjs")) {
  throw new Error(`Packaged extension main must end in .cjs, received ${JSON.stringify(manifest.main)}`);
}

const entrypointPath = `extension/${manifest.main.replace(/^\.\//, "")}`;

if (!archive.getEntry(entrypointPath)) {
  throw new Error(`VSIX does not contain declared entrypoint ${entrypointPath}`);
}

const extractionRoot = await mkdtemp(join(tmpdir(), "vasp-analyzer-vsix-"));

try {
  archive.extractAllTo(extractionRoot, true);
  const require = createRequire(import.meta.url);
  const originalLoad = Module._load;
  let entrypointExports;

  try {
    Module._load = function (request, parent, isMain) {
      if (request === "vscode") return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    entrypointExports = require(join(extractionRoot, entrypointPath));
  } finally {
    Module._load = originalLoad;
  }

  if (typeof entrypointExports.activate !== "function") {
    throw new Error("Packaged extension entrypoint does not export activate() as a function");
  }
  if (typeof entrypointExports.deactivate !== "function") {
    throw new Error("Packaged extension entrypoint does not export deactivate() as a function");
  }
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}
