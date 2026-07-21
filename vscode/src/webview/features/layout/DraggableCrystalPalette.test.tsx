// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraggableCrystalPalette } from "./DraggableCrystalPalette.js";

let viewportSize = { width: 300, height: 200 };
let paletteSize = { width: 80, height: 50 };
let toggleSize = { width: 50, height: 30 };
const observers: ControllableResizeObserver[] = [];
const originalResizeObserver = globalThis.ResizeObserver;
const originalWindowResizeObserver = window.ResizeObserver;

class ControllableResizeObserver {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const rectangle = (width: number, height: number): DOMRect =>
  ({ width, height } as DOMRect);

function Harness({
  initialPosition = { x: 10, y: 10 },
  initialCollapsed = true,
  onPositionChange = vi.fn(),
  onCollapsedChange = vi.fn(),
}: {
  readonly initialPosition?: Readonly<{ x: number; y: number }>;
  readonly initialCollapsed?: boolean;
  readonly onPositionChange?: (position: Readonly<{ x: number; y: number }>) => void;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
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
        onCollapsedChange={(next) => {
          onCollapsedChange(next);
          setCollapsed(next);
        }}
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
  beforeEach(() => {
    observers.length = 0;
    viewportSize = { width: 300, height: 200 };
    paletteSize = { width: 80, height: 50 };
    toggleSize = { width: 50, height: 30 };
    globalThis.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
    window.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "viewport")
          return rectangle(viewportSize.width, viewportSize.height);
        if (this.classList.contains("crystal-palette"))
          return rectangle(paletteSize.width, paletteSize.height);
        if (this.classList.contains("crystal-palette-toggle"))
          return rectangle(toggleSize.width, toggleSize.height);
        return rectangle(0, 0);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
    window.ResizeObserver = originalWindowResizeObserver;
  });

  it("starts collapsed with an accessible expansion control", () => {
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: "Expand crystal tools" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("group", { name: "Crystal tools" }),
    ).not.toBeInTheDocument();
  });

  it("drags the collapsed handle without expanding the palette", () => {
    const onPositionChange = vi.fn();
    const onCollapsedChange = vi.fn();
    render(
      <Harness
        initialCollapsed
        onPositionChange={onPositionChange}
        onCollapsedChange={onCollapsedChange}
      />,
    );
    const handle = screen.getByTestId("collapsed-crystal-palette-handle");
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 50, clientY: 45 });

    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 40, y: 35 });
    expect(onCollapsedChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Expand crystal tools" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("releases a collapsed drag during expansion and unmount cleanup", () => {
    const view = render(<Harness initialCollapsed />);
    const handle = screen.getByTestId("collapsed-crystal-palette-handle");
    const releasePointerCapture = vi.fn();
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: () => true, configurable: true },
      releasePointerCapture: { value: releasePointerCapture, configurable: true },
    });
    fireEvent.pointerDown(handle, { pointerId: 6, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Expand crystal tools" }));
    expect(releasePointerCapture).toHaveBeenCalledWith(6);

    const header = screen.getByTestId("crystal-palette-header");
    Object.defineProperties(header, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releasePointerCapture },
    });
    fireEvent.pointerDown(header, { pointerId: 7, clientX: 10, clientY: 10 });
    view.unmount();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("ends a collapsed drag on pointer cancel", () => {
    const changed = vi.fn();
    render(<Harness initialCollapsed onPositionChange={changed} />);
    const handle = screen.getByTestId("collapsed-crystal-palette-handle");
    const releasePointerCapture = vi.fn();
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releasePointerCapture },
    });
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(handle, { pointerId: 8 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 40, clientY: 40 });
    expect(releasePointerCapture).toHaveBeenCalledWith(8);
    expect(changed).not.toHaveBeenCalled();
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

  it("immediately clamps an initially collapsed persisted position so the toggle is reachable", () => {
    const changed = vi.fn();
    render(
      <Harness
        initialCollapsed
        initialPosition={{ x: 280, y: 190 }}
        onPositionChange={changed}
      />,
    );

    expect(changed).toHaveBeenLastCalledWith({ x: 250, y: 170 });
    expect(
      screen.getByRole("button", { name: "Expand crystal tools" }).closest(
        ".crystal-palette-toggle",
      ),
    ).toHaveStyle({ left: "250px", top: "170px" });
  });

  it("clamps a persisted off-screen position immediately when expanded", async () => {
    const changed = vi.fn();
    render(
      <Harness
        initialCollapsed
        initialPosition={{ x: 240, y: 165 }}
        onPositionChange={changed}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: "Expand crystal tools" }),
    );

    expect(changed).toHaveBeenLastCalledWith({ x: 220, y: 150 });
  });

  it("re-clamps the collapsed toggle when the observed viewport shrinks", () => {
    const changed = vi.fn();
    render(
      <Harness
        initialCollapsed
        initialPosition={{ x: 150, y: 100 }}
        onPositionChange={changed}
      />,
    );
    const viewport = screen.getByTestId("viewport");
    const toggle = screen
      .getByRole("button", { name: "Expand crystal tools" })
      .closest(".crystal-palette-toggle");
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observe).toHaveBeenCalledWith(viewport);
    expect(toggle).not.toBeNull();
    expect(observers[0]!.observe).toHaveBeenCalledWith(toggle);

    viewportSize = { width: 120, height: 90 };
    act(() => observers[0]!.trigger());

    expect(changed).toHaveBeenLastCalledWith({ x: 70, y: 60 });
  });

  it("re-clamps when the observed viewport changes without window resize", () => {
    const changed = vi.fn();
    render(
      <Harness
        initialCollapsed={false}
        initialPosition={{ x: 100, y: 80 }}
        onPositionChange={changed}
      />,
    );
    const viewport = screen.getByTestId("viewport");
    const palette = screen.getByRole("group", { name: "Crystal tools" });
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observe).toHaveBeenCalledWith(viewport);
    expect(observers[0]!.observe).toHaveBeenCalledWith(palette);

    viewportSize = { width: 120, height: 90 };
    act(() => observers[0]!.trigger());

    expect(changed).toHaveBeenLastCalledWith({ x: 40, y: 40 });
  });

  it.each([
    ["collapsed toggle", true],
    ["expanded palette", false],
  ])("disconnects %s observation during cleanup", (_label, collapsed) => {
    const view = render(<Harness initialCollapsed={collapsed} />);
    expect(observers).toHaveLength(1);

    view.unmount();

    expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
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
      screen.getByRole("button", { name: "Expand crystal tools" }).closest(
        ".crystal-palette-toggle",
      ),
    ).toHaveStyle({ left: "10px", top: "10px" });
    expect(
      screen.queryByRole("group", { name: "Crystal tools" }),
    ).not.toBeInTheDocument();
  });
});
