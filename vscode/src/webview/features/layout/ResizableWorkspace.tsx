import {
  useEffect,
  useRef,
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
    onStructurePercentChange(
      clampStructurePercent(((event.clientY - bounds.top) / bounds.height) * 100),
    );
  };

  return (
    <main
      ref={workspace}
      className={
        fullScreen
          ? "analysis-workspace is-structure-fullscreen"
          : "analysis-workspace"
      }
      style={
        { "--structure-percent": `${structurePercent}%` } as CSSProperties
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
