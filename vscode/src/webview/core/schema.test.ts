import { describe, expect, it } from "vitest";

import { DATASET_SCHEMA_VERSION } from "./schema.js";

describe("packaged dataset schema", () => {
  it("publishes schema 3 as the Webview runtime contract", () => {
    expect(DATASET_SCHEMA_VERSION).toBe(3);
  });
});
