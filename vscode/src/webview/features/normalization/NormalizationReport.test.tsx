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

  it("renders escaped rule summaries and manifest warnings in labelled regions", async () => {
    const request = vi.fn().mockResolvedValue({
      manifestReference: "a".repeat(64), normalizerId: "home-barrier",
      displayName: "Home VASP Barrier", schemaVersion: 1,
      definitionSha256: "b".repeat(64), sourceSha256: "c".repeat(64),
      sourceSize: 10, sourceMtimeNs: 20, changedLineCount: 3,
      firstChangedLine: 7, lastChangedLine: 9,
      ruleChangedLineCounts: { "named-row": 2, "<b>other</b>": 1 },
      warnings: ["Review <img src=x onerror=alert(1)> before use."],
      changes: [
        { sourceLine: 7, ruleId: "named-row", originalExcerpt: "a", emittedExcerpt: "b" },
        { sourceLine: 8, ruleId: "named-row", originalExcerpt: "c", emittedExcerpt: "d" },
        { sourceLine: 9, ruleId: "<b>other</b>", originalExcerpt: "e", emittedExcerpt: "f" },
      ],
    });
    render(<NormalizationReport
      host={{ request } as unknown as AnalysisHost}
      manifestReference={"a".repeat(64)}
      onClose={vi.fn()}
    />);

    const summaries = await screen.findByRole("list", { name: "Rule change summary" });
    expect(summaries).toHaveTextContent("named-row: 2 lines");
    expect(summaries).toHaveTextContent("<b>other</b>: 1 line");
    expect(screen.getByRole("list", { name: "Normalization warnings" })).toHaveTextContent(
      "Review <img src=x onerror=alert(1)> before use.",
    );
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows clear empty states for rules, warnings, and changed lines", async () => {
    const request = vi.fn().mockResolvedValue({
      manifestReference: "a".repeat(64), normalizerId: "standard",
      displayName: "Standard", schemaVersion: 1,
      definitionSha256: "b".repeat(64), sourceSha256: "c".repeat(64),
      sourceSize: 10, sourceMtimeNs: 20, changedLineCount: 0,
      firstChangedLine: null, lastChangedLine: null,
      ruleChangedLineCounts: {}, warnings: [], changes: [],
    });
    render(<NormalizationReport
      host={{ request } as unknown as AnalysisHost}
      manifestReference={"a".repeat(64)}
      onClose={vi.fn()}
    />);

    expect(await screen.findByText("No rule changes recorded.")).toBeInTheDocument();
    expect(screen.getByText("No normalization warnings.")).toBeInTheDocument();
    expect(screen.getByText("No changed lines to display.")).toBeInTheDocument();
  });
});
