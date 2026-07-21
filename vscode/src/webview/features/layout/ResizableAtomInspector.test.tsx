// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ResizableAtomInspector } from "./ResizableAtomInspector.js";

describe("ResizableAtomInspector", () => {
  it("renders a narrow affordance instead of an empty inspector before selection", () => {
    render(
      <ResizableAtomInspector
        width={280}
        collapsed={false}
        onWidthChange={vi.fn()}
        onCollapsedChange={vi.fn()}
        inspector={null}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );

    expect(screen.getByRole("button", { name: "No atom selected" })).toBeDisabled();
    expect(screen.queryByRole("separator", { name: /atom inspector/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("atom-inspector-layout")).toHaveClass("is-inspector-collapsed");
  });

  it("collapses and reopens an available inspector", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    const view = render(
      <ResizableAtomInspector
        width={280}
        collapsed={false}
        onWidthChange={vi.fn()}
        onCollapsedChange={onCollapsedChange}
        inspector={<aside>atom data</aside>}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );
    await user.click(screen.getByRole("button", { name: "Collapse atom inspector" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);

    view.rerender(
      <ResizableAtomInspector
        width={280}
        collapsed
        onWidthChange={vi.fn()}
        onCollapsedChange={onCollapsedChange}
        inspector={<aside>atom data</aside>}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );
    await user.click(screen.getByRole("button", { name: "Expand atom inspector" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("clamps pointer widths and supports left/right keyboard resizing", () => {
    const onWidthChange = vi.fn();
    const view = render(
      <ResizableAtomInspector
        width={300}
        collapsed={false}
        onWidthChange={onWidthChange}
        onCollapsedChange={vi.fn()}
        inspector={<aside>atom data</aside>}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );
    const separator = screen.getByRole("separator", { name: "Resize atom inspector" });
    const layout = screen.getByTestId("atom-inspector-layout");
    Object.defineProperty(layout, "getBoundingClientRect", {
      value: () => ({ right: 1000, width: 800 }),
    });
    Object.defineProperties(separator, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(separator, { pointerId: 3, clientX: 0 });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    fireEvent.pointerMove(separator, { pointerId: 3, clientX: 999 });
    expect(onWidthChange).toHaveBeenLastCalledWith(220);

    view.rerender(
      <ResizableAtomInspector
        width={300}
        collapsed={false}
        onWidthChange={onWidthChange}
        onCollapsedChange={vi.fn()}
        inspector={<aside>atom data</aside>}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenLastCalledWith(310);
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith(290);
  });

  it("clamps inspector width against the internal crystal viewport on resize", () => {
    let callback: ResizeObserverCallback = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe = observe;
      disconnect = disconnect;
    });
    let containerWidth = 600;
    const onWidthChange = vi.fn();
    const view = render(
      <ResizableAtomInspector
        width={480}
        collapsed={false}
        onWidthChange={onWidthChange}
        onCollapsedChange={vi.fn()}
        inspector={<aside>atom data</aside>}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );
    const layout = screen.getByTestId("atom-inspector-layout");
    Object.defineProperty(layout, "getBoundingClientRect", {
      value: () => ({ width: containerWidth, right: containerWidth }),
    });

    act(() => callback([], {} as ResizeObserver));
    expect(onWidthChange).toHaveBeenLastCalledWith(352);
    expect(layout.style.getPropertyValue("--inspector-width")).toBe("352px");
    const callsAfterFirstClamp = onWidthChange.mock.calls.length;
    act(() => callback([], {} as ResizeObserver));
    expect(onWidthChange).toHaveBeenCalledTimes(callsAfterFirstClamp);

    containerWidth = 520;
    act(() => callback([], {} as ResizeObserver));
    expect(onWidthChange).toHaveBeenLastCalledWith(272);
    expect(layout.style.getPropertyValue("--inspector-width")).toBe("272px");
    expect(observe).toHaveBeenCalledWith(layout);

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("forces the narrow affordance when both readable panes cannot fit", () => {
    let callback: ResizeObserverCallback = () => undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    render(
      <ResizableAtomInspector
        width={280}
        collapsed={false}
        onWidthChange={vi.fn()}
        onCollapsedChange={vi.fn()}
        inspector={<aside>atom data</aside>}
      >
        <div>crystal</div>
      </ResizableAtomInspector>,
    );
    const layout = screen.getByTestId("atom-inspector-layout");
    Object.defineProperty(layout, "getBoundingClientRect", {
      value: () => ({ width: 400, right: 400 }),
    });

    act(() => callback([], {} as ResizeObserver));

    expect(layout).toHaveClass("is-inspector-collapsed");
    expect(screen.queryByRole("separator", { name: "Resize atom inspector" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand atom inspector" })).toBeDisabled();
    vi.unstubAllGlobals();
  });
});
