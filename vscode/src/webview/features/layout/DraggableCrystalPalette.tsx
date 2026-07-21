import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

export interface PalettePosition {
  readonly x: number;
  readonly y: number;
}

export interface DraggableCrystalPaletteProps {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly position: Readonly<PalettePosition>;
  readonly collapsed: boolean;
  readonly onPositionChange: (position: Readonly<PalettePosition>) => void;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onReset: () => void;
  readonly children: ReactNode;
}

const clampPosition = (
  desired: Readonly<PalettePosition>,
  viewport: DOMRect,
  palette: DOMRect,
): PalettePosition => ({
  x: Math.min(
    Math.max(0, desired.x),
    Math.max(0, viewport.width - palette.width),
  ),
  y: Math.min(
    Math.max(0, desired.y),
    Math.max(0, viewport.height - palette.height),
  ),
});

export function DraggableCrystalPalette({
  viewportRef,
  position,
  collapsed,
  onPositionChange,
  onCollapsedChange,
  onReset,
  children,
}: DraggableCrystalPaletteProps): ReactElement {
  const measuredRef = useRef<HTMLElement>(null);
  const setMeasuredElement = useCallback((element: HTMLElement | null) => {
    measuredRef.current = element;
  }, []);
  const drag = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly position: Readonly<PalettePosition>;
    readonly owner: HTMLDivElement;
  } | null>(null);

  const cancelActiveDrag = useCallback((): void => {
    const current = drag.current;
    drag.current = null;
    if (current?.owner.hasPointerCapture?.(current.pointerId))
      current.owner.releasePointerCapture?.(current.pointerId);
  }, []);

  useEffect(() => cancelActiveDrag, [cancelActiveDrag, collapsed]);

  const bounded = (desired: Readonly<PalettePosition>): PalettePosition | null => {
    const viewport = viewportRef.current;
    const palette = measuredRef.current;
    if (!viewport || !palette) return null;
    return clampPosition(
      desired,
      viewport.getBoundingClientRect(),
      palette.getBoundingClientRect(),
    );
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    const palette = measuredRef.current;
    if (!viewport || !palette) return;
    const reclamp = (): void => {
      const next = bounded(position);
      if (next && (next.x !== position.x || next.y !== position.y))
        onPositionChange(next);
    };
    reclamp();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", reclamp);
      return () => window.removeEventListener("resize", reclamp);
    }
    const observer = new ResizeObserver(reclamp);
    observer.observe(viewport);
    observer.observe(palette);
    return () => observer.disconnect();
  }, [collapsed, onPositionChange, position, viewportRef]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, select, textarea, label")
    )
      return;
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      position,
      owner: event.currentTarget,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (
      !current ||
      current.pointerId !== event.pointerId ||
      !event.currentTarget.hasPointerCapture?.(event.pointerId)
    )
      return;
    const next = bounded({
      x: current.position.x + event.clientX - current.clientX,
      y: current.position.y + event.clientY - current.clientY,
    });
    if (next) onPositionChange(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return;
    cancelActiveDrag();
  };

  if (collapsed)
    return (
      <div
        ref={setMeasuredElement}
        className="crystal-palette-toggle"
        style={{ left: position.x, top: position.y }}
      >
        <div
          className="crystal-palette-drag-handle"
          data-testid="collapsed-crystal-palette-handle"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span aria-hidden="true">⋮⋮</span>
          <span>Crystal tools</span>
        </div>
        <button
          type="button"
          aria-label="Expand crystal tools"
          aria-expanded="false"
          onClick={() => onCollapsedChange(false)}
        >
          Expand
        </button>
      </div>
    );

  return (
    <div
      ref={setMeasuredElement}
      className="crystal-palette"
      role="group"
      aria-label="Crystal tools"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="crystal-palette-header"
        data-testid="crystal-palette-header"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <strong>Crystal tools</strong>
        <span className="crystal-palette-actions">
          <button type="button" onClick={onReset}>Reset layout</button>
          <button
            type="button"
            aria-label="Collapse crystal tools"
            aria-expanded="true"
            onClick={() => onCollapsedChange(true)}
          >
            Collapse
          </button>
        </span>
      </div>
      <div className="crystal-controls">{children}</div>
    </div>
  );
}
