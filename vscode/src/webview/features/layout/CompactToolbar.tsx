import type { ReactElement, ReactNode } from "react";

import { ForceScaleControl } from "../controls/ForceScaleControl.js";
import { IonicStepControl } from "../convergence/IonicStepControl.js";

export interface CompactToolbarProps {
  readonly title: ReactNode;
  readonly totalSteps: number;
  readonly selectedStepIndex: number;
  readonly onSelectStep: (index: number) => void;
  readonly forceMode: "free" | "raw";
  readonly onForceModeChange: (mode: "free" | "raw") => void;
  readonly forceScale: number;
  readonly onForceScaleChange: (scale: number) => void;
  readonly fullScreen: boolean;
  readonly onFullScreenChange: (fullScreen: boolean) => void;
  readonly initialAvailable?: boolean;
  readonly comparison?: Readonly<{
    enabled: boolean; target: number; displacementScale: number;
    onEnabledChange: (enabled: boolean) => void;
    onTargetChange: (target: number) => void;
    onDisplacementScaleChange: (scale: number) => void;
  }>;
}

export function CompactToolbar({
  title,
  totalSteps,
  selectedStepIndex,
  onSelectStep,
  forceMode,
  onForceModeChange,
  forceScale,
  onForceScaleChange,
  fullScreen,
  onFullScreenChange,
  initialAvailable = false,
  comparison,
}: CompactToolbarProps): ReactElement {
  return (
    <header className="workspace-toolbar">
      {title}
      <div className="toolbar-control toolbar-step-control">
        <IonicStepControl
          total={totalSteps}
          selectedIndex={selectedStepIndex}
          onSelect={onSelectStep}
          includeInitial={initialAvailable}
        />
      </div>
      {selectedStepIndex === -1 && totalSteps > 0 && comparison && <>
        <label className="toolbar-control"><input aria-label="Compare structures" type="checkbox" checked={comparison.enabled} onChange={(event) => comparison.onEnabledChange(event.target.checked)} />Compare</label>
        {comparison.enabled && <>
          <label className="toolbar-control">Compare target<input aria-label="Comparison target number" type="number" min="1" max={totalSteps} value={comparison.target + 1} onChange={(event) => comparison.onTargetChange(Number(event.target.value) - 1)} /></label>
          <ForceScaleControl value={comparison.displacementScale} onChange={comparison.onDisplacementScaleChange} label="Displacement arrow multiplier" />
        </>}
      </>}
      {!comparison?.enabled && <>
      <label className="toolbar-control">
        Force components
        <select
          value={forceMode}
          onChange={(event) =>
            onForceModeChange(event.target.value as "free" | "raw")
          }
        >
          <option value="free">Movable only</option>
          <option value="raw">All components</option>
        </select>
      </label>
      <div className="toolbar-control toolbar-force-control">
        <ForceScaleControl value={forceScale} onChange={onForceScaleChange} />
      </div>
      </>}
      <button
        className="fullscreen-toggle"
        type="button"
        aria-label={
          fullScreen
            ? "Exit structure full-screen"
            : "Enter structure full-screen"
        }
        aria-pressed={fullScreen}
        onClick={() => onFullScreenChange(!fullScreen)}
      >
        {fullScreen ? "Restore" : "Expand"}
      </button>
    </header>
  );
}
