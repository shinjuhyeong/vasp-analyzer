// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DraggableCrystalPalette } from "./DraggableCrystalPalette.js";

function Harness({
  initialPosition = { x: 10, y: 10 },
  initialCollapsed = true,
  onPositionChange = vi.fn(),
}: {
  readonly initialPosition?: Readonly<{ x: number; y: number }>;
  readonly initialCollapsed?: boolean;
  readonly onPositionChange?: (position: Readonly<{ x: number; y: number }>) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initialPosition);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <div ref={viewportRef} data-testid="viewport">
      <DraggableCrystalPalette
        viewportRef={viewportRef}
        position={position}
        collapsed={collapsed}
        onPositionChange={(next) => {
          onPositionChange(next);
          setPosition(next);
        }}
        onCollapsedChange={setCollapsed}
        onReset={() => {
          setPosition({ x: 10, y: 10 });
          setCollapsed(true);
        }}
      >
        <button type="button">A crystal control</button>
      </DraggableCrystalPalette>
    </div>
  );
}

describe("DraggableCrystalPalette", () => {
  it("starts collapsed with an accessible expansion control", () => {
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: "Expand crystal tools" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("group", { name: "Crystal tools" }),
    ).not.toBeInTheDocument();
  });

  it("captures pointer drag on its header and clamps to the viewport", async () => {
    const changed = vi.fn();
    render(<Harness initialCollapsed={false} onPositionChange={changed} />);
    const viewport = screen.getByTestId("viewport");
    const palette = screen.getByRole("group", { name: "Crystal tools" });
    const header = screen.getByTestId("crystal-palette-header");
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ width: 300, height: 200 }),
    });
    Object.defineProperty(palette, "getBoundingClientRect", {
      value: () => ({ width: 80, height: 50 }),
    });
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    Object.defineProperties(header, {
      setPointerCapture: { value: setCapture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releaseCapture },
    });

    fireEvent.pointerDown(header, { pointerId: 4, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(header, { pointerId: 4, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(header, { pointerId: 4 });

    expect(setCapture).toHaveBeenCalledWith(4);
    expect(releaseCapture).toHaveBeenCalledWith(4);
    expect(changed).toHaveBeenLastCalledWith({ x: 220, y: 150 });
    await userEvent.setup().click(screen.getByRole("button", { name: "A crystal control" }));
    expect(setCapture).toHaveBeenCalledOnce();
  });

  it("allows the header label to initiate drag without capturing controls", async () => {
    render(<Harness initialCollapsed={false} />);
    const header = screen.getByTestId("crystal-palette-header");
    const setCapture = vi.fn();
    Object.defineProperty(header, "setPointerCapture", { value: setCapture });

    fireEvent.pointerDown(screen.getByText("Crystal tools"), { pointerId: 2 });
    expect(setCapture).toHaveBeenCalledWith(2);

    await userEvent.setup().click(screen.getByRole("button", { name: "Reset layout" }));
    expect(setCapture).toHaveBeenCalledOnce();
  });

  it("re-clamps an off-screen position after viewport resize", () => {
    const changed = vi.fn();
    render(
      <Harness
        initialCollapsed={false}
        initialPosition={{ x: 250, y: 170 }}
        onPositionChange={changed}
      />,
    );
    const viewport = screen.getByTestId("viewport");
    const palette = screen.getByRole("group", { name: "Crystal tools" });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ width: 200, height: 100 }),
    });
    Object.defineProperty(palette, "getBoundingClientRect", {
      value: () => ({ width: 60, height: 40 }),
    });

    fireEvent(window, new Event("resize"));

    expect(changed).toHaveBeenLastCalledWith({ x: 140, y: 60 });
  });

  it("resets to the collapsed default position", async () => {
    render(
      <Harness
        initialCollapsed={false}
        initialPosition={{ x: 80, y: 60 }}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Reset layout" }));

    expect(
      screen.getByRole("button", { name: "Expand crystal tools" }),
    ).toHaveStyle({ left: "10px", top: "10px" });
    expect(
      screen.queryByRole("group", { name: "Crystal tools" }),
    ).not.toBeInTheDocument();
  });
});
