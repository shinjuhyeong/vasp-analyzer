// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NormalizationStatus } from "./NormalizationStatus.js";

describe("NormalizationStatus", () => {
  it("shows parser provenance, transformed warning, and opens details lazily", () => {
    const open = vi.fn();
    render(<NormalizationStatus provenance={{
      adapter: "vaspparser", adapterVersion: "0.0.7", dialect: "home",
      profileId: null, normalizationRules: [], compatibilityMetadata: [],
      normalizerId: "home-barrier", normalizerDisplayName: "Home VASP Barrier",
      normalizerSchemaVersion: 1, normalizerDefinitionSha256: "a".repeat(64),
      normalizationChangedLineCount: 875, normalizationManifestReference: "b".repeat(64),
      normalizationWarnings: [],
    }} onOpenReport={open} />);

    expect(screen.getByText(/vaspparser 0\.0\.7/)).toBeInTheDocument();
    expect(screen.getByText(/Home VASP Barrier/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("875 lines");
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(open).toHaveBeenCalledOnce();
  });
});
