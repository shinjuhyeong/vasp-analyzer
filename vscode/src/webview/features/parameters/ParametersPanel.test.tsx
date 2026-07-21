// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ParameterOccurrence } from "../../core/contracts.js";
import { ParametersPanel, effectiveParameters } from "./ParametersPanel.js";

const parameters: readonly ParameterOccurrence[] = [
  { key: "encut", rawKey: "ENCUT", rawValue: "400", value: 400, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 0, lineNumber: 12 },
  { key: "ibrion", rawKey: "IBRION", rawValue: "2", value: 2, unit: null, category: "ionic", description: "Ionic relaxation algorithm", ordinal: 1, lineNumber: 14 },
  { key: "encut", rawKey: "ENCUT", rawValue: "520", value: 520, unit: "eV", category: "electronic", description: "Plane-wave cutoff", ordinal: 2, lineNumber: 18 },
  { key: "home_vector", rawKey: "HOME_VECTOR", rawValue: "1 2.5 -3", value: [1, 2.5, -3], unit: null, category: null, description: null, ordinal: 3, lineNumber: null },
];

describe("ParametersPanel", () => {
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
});
