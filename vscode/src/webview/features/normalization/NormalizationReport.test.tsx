// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AnalysisHost } from "../../core/contracts.js";
import { NormalizationReport } from "./NormalizationReport.js";

describe("NormalizationReport", () => {
  it("fetches line changes only after mounting and renders excerpts as text", async () => {
    const request = vi.fn().mockResolvedValue({
      manifestReference: "a".repeat(64), normalizerId: "home-barrier",
      displayName: "Home VASP Barrier", schemaVersion: 1,
      definitionSha256: "b".repeat(64), sourceSha256: "c".repeat(64),
      sourceSize: 10, sourceMtimeNs: 20, changedLineCount: 1,
      firstChangedLine: 7, lastChangedLine: 7,
      ruleChangedLineCounts: { named: 1 }, warnings: [],
      changes: [{ sourceLine: 7, ruleId: "named", originalExcerpt: "<script>x</script>", emittedExcerpt: "0 0 0 1 1 1" }],
    });
    render(<NormalizationReport
      host={{ request } as unknown as AnalysisHost}
      manifestReference={"a".repeat(64)}
      onClose={vi.fn()}
    />);

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "getNormalizationManifest", { manifestReference: "a".repeat(64) },
    ));
    expect(await screen.findByText("<script>x</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
