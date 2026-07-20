// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SeriesChart } from "./SeriesChart.js";

const axes = {
  xAxis: { label: "Ionic step" },
  yAxis: { label: "Force", unit: "eV/angstrom" },
};

it("keeps the SVG noninteractive and exposes real keyboard-operable HTML buttons", () => {
  const select = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const view = render(
    <SeriesChart
      ariaLabel="Forces"
      {...axes}
      series={[
        {
          id: "strongest-force",
          label: "Strongest force",
          points: [
            {
              id: "force-10",
              x: 10,
              y: null,
              selectionIndex: 0,
              ariaLabel: "Force at ionic step 11: unavailable",
            },
            {
              id: "force-20",
              x: 20,
              y: 0.2,
              selectionIndex: 1,
              ariaLabel: "Force at ionic step 21: 0.2 eV per angstrom",
            },
          ],
        },
      ]}
      selectedIndex={1}
      onSelect={select}
    />,
  );
  expect(screen.getByTestId("Forces-visual")).toHaveAttribute("aria-hidden", "true");
  const missing = screen.getByRole("button", { name: "Force at ionic step 11: unavailable" });
  const point = screen.getByRole("button", { name: "Force at ionic step 21: 0.2 eV per angstrom" });
  expect(point).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(missing, { key: "Enter" });
  fireEvent.keyDown(point, { key: " " });
  fireEvent.click(point);
  expect(select.mock.calls).toEqual([[0], [1], [1]]);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it("maps irregular generic numeric x values and accepts DOS-like units", () => {
  render(
    <SeriesChart
      ariaLabel="Density of states"
      xAxis={{ label: "Energy", unit: "eV" }}
      yAxis={{ label: "DOS", unit: "states/eV/cell" }}
      series={[
        {
          id: "dos",
          label: "Total DOS",
          points: [
            { id: "a", x: 0, y: 1, ariaLabel: "DOS 1" },
            { id: "b", x: 1, y: 2, ariaLabel: "DOS 2" },
            { id: "c", x: 4, y: 3, ariaLabel: "DOS 3" },
          ],
        },
      ]}
    />,
  );
  const points = screen.getByTestId("Density of states-visual").querySelectorAll(".chart-point");
  expect([...points].map((point) => Number(point.getAttribute("cx")))).toEqual([54, 196.5, 624]);
  expect(screen.getByText("Total DOS (states/eV/cell)")).toBeVisible();
});

it("accepts band-like negative x coordinates and keeps nulls as gaps", () => {
  render(
    <SeriesChart
      ariaLabel="Band path"
      xAxis={{ label: "Wave vector" }}
      yAxis={{ label: "Energy", unit: "eV" }}
      series={[
        {
          id: "band",
          label: "Band 1",
          points: [
            { id: "left", x: -1, y: -2, ariaLabel: "left" },
            { id: "gap", x: 0, y: null, ariaLabel: "gap" },
            { id: "right", x: 2, y: 3, ariaLabel: "right" },
          ],
        },
      ]}
    />,
  );
  expect(screen.getByTestId("Band path-visual").querySelectorAll("polyline")).toHaveLength(2);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("renders zero-point and all-null series without manufacturing visual points", () => {
  const { rerender } = render(
    <SeriesChart ariaLabel="Empty" {...axes} series={[]} />,
  );
  expect(screen.getByTestId("Empty-visual")).toBeVisible();
  rerender(
    <SeriesChart
      ariaLabel="Missing"
      {...axes}
      series={[
        {
          id: "total-energy",
          label: "Total energy",
          points: [
            {
              id: "missing",
              x: 0,
              y: null,
              selectionIndex: 0,
              ariaLabel: "Total energy at ionic step 1: unavailable",
            },
          ],
        },
      ]}
      selectedIndex={0}
      onSelect={() => undefined}
    />,
  );
  expect(screen.getByText("No values available")).toBeVisible();
  expect(screen.getByTestId("Missing-visual").querySelector(".chart-point")).toBeNull();
  expect(screen.getByRole("button", { name: /unavailable/ })).toBeVisible();
});
