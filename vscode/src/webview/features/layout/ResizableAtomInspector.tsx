import {
  useRef,
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

const clampInspectorWidth = (value: number): number =>
  Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, value));

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
  const isCollapsed = collapsed || inspector === null;

  const updateFromPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    const bounds = layout.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    onWidthChange(clampInspectorWidth(bounds.right - event.clientX));
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
      style={{ "--inspector-width": `${width}px` } as CSSProperties}
    >
      <div className="crystal-main">{children}</div>
      {isCollapsed ? (
        <button
          className="atom-inspector-affordance"
          type="button"
          disabled={inspector === null}
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
                  onWidthChange(clampInspectorWidth(width + 10));
                else if (event.key === "ArrowRight")
                  onWidthChange(clampInspectorWidth(width - 10));
                else if (event.key === "Home")
                  onWidthChange(MIN_INSPECTOR_WIDTH);
                else if (event.key === "End")
                  onWidthChange(MAX_INSPECTOR_WIDTH);
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
