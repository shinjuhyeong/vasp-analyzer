import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  MAX_STRUCTURE_PERCENT,
  MIN_STRUCTURE_PERCENT,
} from "../../core/store.js";

export interface ResizableWorkspaceProps {
  readonly structurePercent: number;
  readonly onStructurePercentChange: (percent: number) => void;
  readonly fullScreen: boolean;
  readonly onFullScreenChange: (fullScreen: boolean) => void;
  readonly structure: ReactNode;
  readonly analysis: ReactNode;
}

export const WORKSPACE_SPLITTER_SIZE = 8;
export const MIN_ANALYSIS_HEIGHT = 48;

const clampStructurePercent = (value: number): number =>
  Math.min(MAX_STRUCTURE_PERCENT, Math.max(MIN_STRUCTURE_PERCENT, value));

export function ResizableWorkspace({
  structurePercent,
  onStructurePercentChange,
  fullScreen,
  onFullScreenChange,
  structure,
  analysis,
}: ResizableWorkspaceProps): ReactElement {
  const workspace = useRef<HTMLElement>(null);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = (): void => {
      const height = element.getBoundingClientRect().height;
      setWorkspaceHeight(Number.isFinite(height) && height > 0 ? height : 0);
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

  useEffect(() => {
    if (!fullScreen) return;
    const exitOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onFullScreenChange(false);
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [fullScreen, onFullScreenChange]);

  const updateFromPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    const bounds = workspace.current?.getBoundingClientRect();
    if (!bounds || bounds.height <= 0) return;
    const usableHeight = Math.max(
      1,
      bounds.height - WORKSPACE_SPLITTER_SIZE - MIN_ANALYSIS_HEIGHT,
    );
    onStructurePercentChange(
      clampStructurePercent(((event.clientY - bounds.top) / usableHeight) * 100),
    );
  };
  const usableTrackHeight = Math.max(
    0,
    workspaceHeight - WORKSPACE_SPLITTER_SIZE - MIN_ANALYSIS_HEIGHT,
  );
  const structureSize = usableTrackHeight * (structurePercent / 100);

  return (
    <main
      ref={workspace}
      className={
        fullScreen
          ? "analysis-workspace is-structure-fullscreen"
          : "analysis-workspace"
      }
      style={
        {
          "--structure-size":
            workspaceHeight > 0
              ? `${structureSize}px`
              : `min(${structurePercent}%, calc(100% - ${WORKSPACE_SPLITTER_SIZE + MIN_ANALYSIS_HEIGHT}px))`,
        } as CSSProperties
      }
    >
      {structure}
      {!fullScreen && (
        <>
          <div
            className="splitter workspace-splitter"
            role="separator"
            aria-label="Resize structure and analysis regions"
            aria-orientation="horizontal"
            aria-valuemin={MIN_STRUCTURE_PERCENT}
            aria-valuemax={MAX_STRUCTURE_PERCENT}
            aria-valuenow={Math.round(structurePercent)}
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
              if (event.key === "ArrowUp")
                onStructurePercentChange(
                  clampStructurePercent(structurePercent - 5),
                );
              else if (event.key === "ArrowDown")
                onStructurePercentChange(
                  clampStructurePercent(structurePercent + 5),
                );
              else if (event.key === "Home")
                onStructurePercentChange(MIN_STRUCTURE_PERCENT);
              else if (event.key === "End")
                onStructurePercentChange(MAX_STRUCTURE_PERCENT);
              else return;
              event.preventDefault();
            }}
          >
            <span />
          </div>
          {analysis}
        </>
      )}
    </main>
  );
}
