import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  MAX_INSPECTOR_WIDTH,
  MIN_INSPECTOR_WIDTH,
} from "../../core/store.js";

export interface ResizableAtomInspectorProps {
  readonly width: number;
  readonly collapsed: boolean;
  readonly onWidthChange: (width: number) => void;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly inspector: ReactNode | null;
  readonly children: ReactNode;
  readonly splitterHidden?: boolean;
}

export const MIN_CRYSTAL_WIDTH = 240;
export const INSPECTOR_SPLITTER_SIZE = 8;

const clampInspectorWidth = (value: number): number =>
  Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, value));

const containerInspectorMaximum = (containerWidth: number): number =>
  Math.min(
    MAX_INSPECTOR_WIDTH,
    containerWidth - MIN_CRYSTAL_WIDTH - INSPECTOR_SPLITTER_SIZE,
  );

export function ResizableAtomInspector({
  width,
  collapsed,
  onWidthChange,
  onCollapsedChange,
  inspector,
  children,
  splitterHidden = false,
}: ResizableAtomInspectorProps): ReactElement {
  const layout = useRef<HTMLDivElement>(null);
  const current = useRef({ width, collapsed, hasInspector: inspector !== null });
  const lastPropWidth = useRef(width);
  const onWidthChangeRef = useRef(onWidthChange);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  if (width !== lastPropWidth.current) {
    lastPropWidth.current = width;
    current.current.width = width;
  }
  current.current.collapsed = collapsed;
  current.current.hasInspector = inspector !== null;
  onWidthChangeRef.current = onWidthChange;

  useLayoutEffect(() => {
    const element = layout.current;
    if (!element) return;
    const measure = (): void => {
      const measured = element.getBoundingClientRect().width;
      if (!Number.isFinite(measured) || measured <= 0) return;
      setContainerWidth(measured);
      const state = current.current;
      const maximum = containerInspectorMaximum(measured);
      if (
        !state.collapsed &&
        state.hasInspector &&
        maximum >= MIN_INSPECTOR_WIDTH
      ) {
        const next = Math.min(maximum, clampInspectorWidth(state.width));
        if (next !== state.width) {
          current.current = { ...state, width: next };
          onWidthChangeRef.current(next);
        }
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const maximumWidth =
    containerWidth === null
      ? MAX_INSPECTOR_WIDTH
      : containerInspectorMaximum(containerWidth);
  const cannotFitReadablePanes = maximumWidth < MIN_INSPECTOR_WIDTH;
  const forcedCollapsed =
    inspector !== null && !collapsed && cannotFitReadablePanes;
  const isCollapsed = collapsed || inspector === null || forcedCollapsed;
  const effectiveWidth = Math.min(
    Math.max(MIN_INSPECTOR_WIDTH, width),
    Math.max(MIN_INSPECTOR_WIDTH, maximumWidth),
  );

  const updateFromPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    const bounds = layout.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const maximum = containerInspectorMaximum(bounds.width);
    if (maximum < MIN_INSPECTOR_WIDTH) return;
    onWidthChange(
      Math.min(maximum, clampInspectorWidth(bounds.right - event.clientX)),
    );
  };

  return (
    <div
      ref={layout}
      data-testid="atom-inspector-layout"
      className={[
        "atom-inspector-layout",
        isCollapsed ? "is-inspector-collapsed" : "",
        splitterHidden && !isCollapsed ? "is-inspector-splitter-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--inspector-width": `${effectiveWidth}px` } as CSSProperties}
    >
      <div className="crystal-main">{children}</div>
      {isCollapsed ? (
        <button
          className="atom-inspector-affordance"
          type="button"
          disabled={inspector === null || forcedCollapsed}
          aria-label={
            inspector === null ? "No atom selected" : "Expand atom inspector"
          }
          title={
            inspector === null
              ? "Select an atom to inspect it"
              : "Expand atom inspector"
          }
          onClick={() => onCollapsedChange(false)}
        >
          <span aria-hidden="true">{inspector === null ? "Atom" : "+"}</span>
        </button>
      ) : (
        <>
          {!splitterHidden && (
            <div
              className="splitter atom-inspector-splitter"
              role="separator"
              aria-label="Resize atom inspector"
              aria-orientation="vertical"
              aria-valuemin={MIN_INSPECTOR_WIDTH}
              aria-valuemax={MAX_INSPECTOR_WIDTH}
              aria-valuenow={Math.round(width)}
              tabIndex={0}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                updateFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture?.(event.pointerId))
                  updateFromPointer(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture?.(event.pointerId))
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft")
                  onWidthChange(
                    Math.min(maximumWidth, clampInspectorWidth(width + 10)),
                  );
                else if (event.key === "ArrowRight")
                  onWidthChange(
                    Math.min(maximumWidth, clampInspectorWidth(width - 10)),
                  );
                else if (event.key === "Home")
                  onWidthChange(MIN_INSPECTOR_WIDTH);
                else if (event.key === "End")
                  onWidthChange(maximumWidth);
                else return;
                event.preventDefault();
              }}
            >
              <span />
            </div>
          )}
          <div className="atom-inspector-slot">
            <button
              className="atom-inspector-collapse"
              type="button"
              aria-label="Collapse atom inspector"
              onClick={() => onCollapsedChange(true)}
            >
              -
            </button>
            {inspector}
          </div>
        </>
      )}
    </div>
  );
}
