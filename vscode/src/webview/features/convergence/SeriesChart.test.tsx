// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SeriesChart } from "./SeriesChart.js";

it("supports keyboard point selection, gaps, selected markers, and observer cleanup", () => {
  const select = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = disconnect; });
  const view = render(<SeriesChart ariaLabel="Forces" series={[{
    id: "strongest-force", label: "Strongest force", unit: "eV/angstrom",
    points: [
      { arrayIndex: 0, displayedStep: 1, value: null, ariaLabel: "Force at ionic step 1: unavailable" },
      { arrayIndex: 1, displayedStep: 2, value: 0.2, ariaLabel: "Force at ionic step 2: 0.2 eV per angstrom" },
    ],
  }]} selectedIndex={1} onSelect={select} />);
  expect(screen.queryByLabelText("Force at ionic step 1: unavailable")).not.toBeInTheDocument();
  const point = screen.getByLabelText("Force at ionic step 2: 0.2 eV per angstrom");
  expect(point).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(point, { key: "Enter" });
  expect(select).toHaveBeenCalledWith(1);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it("renders zero-point and all-null series without manufacturing points", () => {
  const { rerender } = render(<SeriesChart ariaLabel="Empty" series={[]} selectedIndex={0} onSelect={() => undefined} />);
  expect(screen.getByRole("img", { name: "Empty" })).toBeVisible();
  rerender(<SeriesChart ariaLabel="Missing" series={[{
    id: "total-energy", label: "Total energy", unit: "eV",
    points: [{ arrayIndex: 0, displayedStep: 1, value: null, ariaLabel: "Total energy at ionic step 1: unavailable" }],
  }]} selectedIndex={0} onSelect={() => undefined} />);
  expect(screen.getByText("No values available")).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
