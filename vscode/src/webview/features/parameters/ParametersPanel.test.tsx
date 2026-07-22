// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ParameterOccurrence } from "../../core/contracts.js";
import { ParametersPanel, effectiveParameters } from "./ParametersPanel.js";

const parameters: readonly ParameterOccurrence[] = [
  { key: "encut", rawKey: "ENCUT", rawValue: "400", value: 400, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 0, lineNumber: 12 },
  { key: "ibrion", rawKey: "IBRION", rawValue: "2", value: 2, unit: null, category: "ionic", description: "Ionic relaxation algorithm", ordinal: 1, lineNumber: 14 },
  { key: "encut", rawKey: "ENCUT", rawValue: "520", value: 520, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 2, lineNumber: 18 },
  { key: "home_vector", rawKey: "HOME_VECTOR", rawValue: "1 2.5 -3", value: [1, 2.5, -3], unit: null, category: null, description: null, ordinal: 3, lineNumber: null },
];

describe("ParametersPanel", () => {
  it("preserves standard effective values and an unknown home occurrence from transport", async () => {
    const transported: readonly ParameterOccurrence[] = [
      { key: "encut", rawKey: "ENCUT", rawValue: "520", value: 520, unit: "eV", category: "electronic", description: "Plane-wave cutoff energy", ordinal: 0, lineNumber: 8 },
      { key: "ediffg", rawKey: "EDIFFG", rawValue: "-0.02", value: -0.02, unit: "eV/angstrom", category: "ionic", description: "Ionic convergence threshold: force criterion", ordinal: 1, lineNumber: 9 },
      { key: "home_effective", rawKey: "HOME_EFFECTIVE", rawValue: "alpha-beta", value: "alpha-beta", unit: null, category: null, description: null, ordinal: 2, lineNumber: 10 },
    ];

    render(<ParametersPanel parameters={transported} />);

    expect(screen.getByRole("row", { name: /ENCUT.*520.*eV.*Plane-wave cutoff energy/ })).toBeVisible();
    expect(screen.getByRole("row", { name: /EDIFFG.*-0\.02.*eV\/angstrom.*force criterion/ })).toBeVisible();
    expect(screen.getByRole("row", { name: /HOME_EFFECTIVE.*alpha-beta.*Unrecognized/ })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Raw parameters" }));
    expect(screen.getByRole("row", { name: /HOME_EFFECTIVE.*alpha-beta.*10/ })).toBeVisible();
  });

  it("shows sign-aware EDIFFG meanings and keeps untyped metadata conservative", () => {
    const ediffgValues: readonly ParameterOccurrence[] = [
      { key: "ediffg-positive", rawKey: "EDIFFG_POSITIVE", rawValue: "0.02", value: 0.02, unit: "eV", category: "ionic", description: "Ionic convergence threshold: energy-change criterion", ordinal: 0, lineNumber: 8 },
      { key: "ediffg-negative", rawKey: "EDIFFG_NEGATIVE", rawValue: "-0.02", value: -0.02, unit: "eV/angstrom", category: "ionic", description: "Ionic convergence threshold: force criterion", ordinal: 1, lineNumber: 9 },
      { key: "ediffg-zero", rawKey: "EDIFFG_ZERO", rawValue: "0", value: 0, unit: null, category: "ionic", description: "Ionic convergence criterion disabled", ordinal: 2, lineNumber: 10 },
      { key: "ediffg-raw", rawKey: "EDIFFG_RAW", rawValue: "home-value", value: "home-value", unit: null, category: "ionic", description: "Ionic convergence threshold (uninterpreted)", ordinal: 3, lineNumber: 11 },
    ];

    render(<ParametersPanel parameters={ediffgValues} />);

    expect(screen.getByRole("row", { name: /EDIFFG_POSITIVE.*0\.02.*eV.*energy-change criterion/ })).toBeVisible();
    expect(screen.getByRole("row", { name: /EDIFFG_NEGATIVE.*-0\.02.*eV\/angstrom.*force criterion/ })).toBeVisible();
    expect(screen.getByRole("row", { name: /EDIFFG_ZERO.*disabled/ })).toBeVisible();
    expect(screen.getByRole("row", { name: /EDIFFG_RAW.*home-value.*uninterpreted/ })).toBeVisible();
  });

  it("renders canonical scanner metadata in scientific parameter groups", () => {
    const parsedMetadata: readonly ParameterOccurrence[] = [
      { key: "ediff", rawKey: "EDIFF", rawValue: "1E-6", value: 1e-6, unit: "eV", category: "electronic", description: "Electronic convergence tolerance", ordinal: 0, lineNumber: 3 },
      { key: "ispin", rawKey: "ISPIN", rawValue: "2", value: 2, unit: null, category: "spin", description: "Spin-polarization mode", ordinal: 1, lineNumber: 3 },
      { key: "ncore", rawKey: "NCORE", rawValue: "4", value: 4, unit: null, category: "parallelization", description: "Bands distributed per orbital group", ordinal: 2, lineNumber: 3 },
      { key: "lwave", rawKey: "LWAVE", rawValue: "F", value: false, unit: null, category: "output", description: "Write WAVECAR output", ordinal: 3, lineNumber: 3 },
    ];

    render(<ParametersPanel parameters={parsedMetadata} />);

    for (const group of ["Electronic", "Spin", "Parallelization", "Output"]) {
      expect(screen.getByRole("heading", { name: group })).toBeVisible();
    }
    expect(screen.getByText("Electronic convergence tolerance")).toBeVisible();
    expect(screen.queryByText("Unrecognized OUTCAR parameter")).not.toBeInTheDocument();
  });

  it("uses the last occurrence as effective while raw mode preserves every source occurrence", async () => {
    render(<ParametersPanel parameters={parameters} />);

    expect(screen.queryByRole("cell", { name: "400" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "520" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Raw parameters" }));

    expect(screen.getAllByRole("row", { name: /ENCUT/ })).toHaveLength(2);
    const rawRows = screen.getAllByRole("row").slice(1);
    expect(rawRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("ENCUT400"),
      expect.stringContaining("IBRION2"),
      expect.stringContaining("ENCUT520"),
      expect.stringContaining("HOME_VECTOR1 2.5 -3"),
    ]);
  });

  it("groups effective values by category and formats typed tuples without losing raw text", async () => {
    render(<ParametersPanel parameters={parameters} />);

    expect(screen.getByRole("heading", { name: "Electronic" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ionic" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Other" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "[1, 2.5, -3]" })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: /origin/i })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Raw parameters" }));
    expect(screen.getByRole("cell", { name: "1 2.5 -3" })).toBeVisible();
    expect(screen.getByText(/does not infer whether values came from INCAR or VASP defaults/i)).toBeVisible();
  });

  it("searches keys values descriptions and categories", async () => {
    render(<ParametersPanel parameters={parameters} />);
    const search = screen.getByRole("searchbox", { name: "Search parameters" });

    await userEvent.setup().type(search, "relaxation");
    expect(screen.getByRole("cell", { name: "IBRION" })).toBeVisible();
    expect(screen.queryByRole("cell", { name: "ENCUT" })).not.toBeInTheDocument();

    await userEvent.setup().clear(search);
    await userEvent.setup().type(search, "electronic");
    expect(screen.getByRole("cell", { name: "ENCUT" })).toBeVisible();

    await userEvent.setup().clear(search);
    await userEvent.setup().type(search, "2.5");
    expect(screen.getByRole("cell", { name: "HOME_VECTOR" })).toBeVisible();
  });

  it("applies category filtering only to interpreted values and never drops raw occurrences", async () => {
    render(<ParametersPanel parameters={parameters} />);
    await userEvent.setup().selectOptions(
      screen.getByRole("combobox", { name: "Parameter category" }),
      "electronic",
    );
    expect(screen.getByRole("cell", { name: "ENCUT" })).toBeVisible();
    expect(screen.queryByRole("cell", { name: "IBRION" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Raw parameters" }));
    expect(screen.getAllByRole("row", { name: /ENCUT/ })).toHaveLength(2);
    expect(within(screen.getByRole("table", { name: "Raw OUTCAR parameters" })).getByRole("row", { name: /IBRION/ })).toBeVisible();
    expect(screen.getByRole("row", { name: /HOME_VECTOR/ })).toBeVisible();
  });

  it("orders effective parameters deterministically by category and key", () => {
    expect(effectiveParameters(parameters).map(({ key }) => key)).toEqual([
      "encut",
      "ibrion",
      "home_vector",
    ]);
  });

  it("keeps duplicate ordinal and raw-key occurrences distinct through raw search and view transitions", async () => {
    const duplicateMetadata: readonly ParameterOccurrence[] = [
      { key: "home_duplicate", rawKey: "HOME_DUPLICATE", rawValue: "alpha", value: "alpha", unit: null, category: null, description: null, ordinal: 7, lineNumber: 30 },
      { key: "home_duplicate", rawKey: "HOME_DUPLICATE", rawValue: "beta", value: "beta", unit: null, category: null, description: null, ordinal: 7, lineNumber: 31 },
    ];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();

    try {
      render(<ParametersPanel parameters={duplicateMetadata} />);
      await user.click(screen.getByRole("button", { name: "Raw parameters" }));
      expect(screen.getAllByRole("row", { name: /HOME_DUPLICATE/ }).map((row) => row.textContent)).toEqual([
        expect.stringContaining("alpha"),
        expect.stringContaining("beta"),
      ]);

      const search = screen.getByRole("searchbox", { name: "Search parameters" });
      await user.type(search, "beta");
      expect(screen.getAllByRole("row", { name: /HOME_DUPLICATE/ })).toHaveLength(1);
      expect(screen.getByRole("row", { name: /HOME_DUPLICATE/ })).toHaveTextContent("beta");
      await user.clear(search);
      await user.click(screen.getByRole("button", { name: "Interpreted parameters" }));
      await user.click(screen.getByRole("button", { name: "Raw parameters" }));

      expect(screen.getAllByRole("row", { name: /HOME_DUPLICATE/ }).map((row) => row.textContent)).toEqual([
        expect.stringContaining("alpha"),
        expect.stringContaining("beta"),
      ]);
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
    } finally {
      consoleError.mockRestore();
    }
  });
});
