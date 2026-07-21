// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResizableWorkspace } from "./ResizableWorkspace.js";

describe("ResizableWorkspace", () => {
  it("supports the near-full End value and five-point keyboard steps", () => {
    const onChange = vi.fn();
    const view = render(
      <ResizableWorkspace
        structurePercent={60}
        onStructurePercentChange={onChange}
        fullScreen={false}
        onFullScreenChange={vi.fn()}
        structure={<div>structure</div>}
        analysis={<div>analysis</div>}
      />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize structure and analysis regions",
    });

    fireEvent.keyDown(separator, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(95);

    view.rerender(
      <ResizableWorkspace
        structurePercent={95}
        onStructurePercentChange={onChange}
        fullScreen={false}
        onFullScreenChange={vi.fn()}
        structure={<div>structure</div>}
        analysis={<div>analysis</div>}
      />,
    );
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  it("clamps pointer dragging at both supported bounds and releases capture", () => {
    const onChange = vi.fn();
    render(
      <ResizableWorkspace
        structurePercent={60}
        onStructurePercentChange={onChange}
        fullScreen={false}
        onFullScreenChange={vi.fn()}
        structure={<div>structure</div>}
        analysis={<div>analysis</div>}
      />,
    );
    const separator = screen.getByRole("separator");
    const workspace = separator.closest("main")!;
    Object.defineProperty(workspace, "getBoundingClientRect", {
      value: () => ({ top: 10, height: 200 }),
    });
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    Object.defineProperties(separator, {
      setPointerCapture: { value: setCapture },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: releaseCapture },
    });

    fireEvent.pointerDown(separator, { pointerId: 4, clientY: 220 });
    expect(onChange).toHaveBeenLastCalledWith(95);
    fireEvent.pointerMove(separator, { pointerId: 4, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(30);
    fireEvent.pointerUp(separator, { pointerId: 4 });
    expect(setCapture).toHaveBeenCalledWith(4);
    expect(releaseCapture).toHaveBeenCalledWith(4);
  });

  it("maps pointer position through the same usable track space as rendering", () => {
    const onChange = vi.fn();
    render(
      <ResizableWorkspace
        structurePercent={60}
        onStructurePercentChange={onChange}
        fullScreen={false}
        onFullScreenChange={vi.fn()}
        structure={<div>structure</div>}
        analysis={<div>analysis</div>}
      />,
    );
    const separator = screen.getByRole("separator");
    const workspace = separator.closest("main")!;
    Object.defineProperty(workspace, "getBoundingClientRect", {
      value: () => ({ top: 0, height: 360 }),
    });
    Object.defineProperty(separator, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(separator, { pointerId: 8, clientY: 152 });

    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it("hides analysis and its separator in structure full-screen and exits on Escape", () => {
    const onFullScreenChange = vi.fn();
    render(
      <ResizableWorkspace
        structurePercent={72}
        onStructurePercentChange={vi.fn()}
        fullScreen
        onFullScreenChange={onFullScreenChange}
        structure={<div>structure controls</div>}
        analysis={<div>convergence content</div>}
      />,
    );

    expect(screen.getByText("structure controls")).toBeVisible();
    expect(screen.queryByText("convergence content")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /structure and analysis/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFullScreenChange).toHaveBeenCalledWith(false);
  });

  it("applies the split percentage only after reserving recoverable fixed tracks", () => {
    let callback: ResizeObserverCallback = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    render(
      <ResizableWorkspace
        structurePercent={95}
        onStructurePercentChange={vi.fn()}
        fullScreen={false}
        onFullScreenChange={vi.fn()}
        structure={<div>structure</div>}
        analysis={<div>analysis</div>}
      />,
    );
    const workspace = screen.getByText("structure").closest("main")!;
    Object.defineProperty(workspace, "getBoundingClientRect", {
      value: () => ({ height: 360 }),
    });

    act(() => callback([], {} as ResizeObserver));

    const structureSize = Number.parseFloat(
      workspace.style.getPropertyValue("--structure-size"),
    );
    expect(structureSize).toBeCloseTo((360 - 8 - 48) * 0.95);
    expect(structureSize + 8 + 48).toBeLessThanOrEqual(360);
    vi.unstubAllGlobals();
  });

  it("disconnects workspace size observation", () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = disconnect;
    });
    const view = render(
      <ResizableWorkspace
        structurePercent={60}
        onStructurePercentChange={vi.fn()}
        fullScreen={false}
        onFullScreenChange={vi.fn()}
        structure={<div>structure</div>}
        analysis={<div>analysis</div>}
      />,
    );
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
