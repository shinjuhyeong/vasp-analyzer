import { useEffect, useState, type ReactElement, type ReactNode } from "react";

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
  const [comparisonTargetDraft, setComparisonTargetDraft] = useState(String((comparison?.target ?? 0) + 1));
  useEffect(() => setComparisonTargetDraft(String((comparison?.target ?? 0) + 1)), [comparison?.target]);
  const commitComparisonTarget = (): void => {
    if (!comparison) return;
    const parsed = Number(comparisonTargetDraft);
    if (comparisonTargetDraft.trim() === "" || !Number.isFinite(parsed)) {
      setComparisonTargetDraft(String(comparison.target + 1));
      return;
    }
    const target = Math.max(0, Math.min(totalSteps - 1, Math.trunc(parsed) - 1));
    setComparisonTargetDraft(String(target + 1));
    if (target !== comparison.target) comparison.onTargetChange(target);
  };
  return (
    <header className="workspace-toolbar">
      <div className="toolbar-primary-row" data-testid="structure-toolbar-primary">
        {title}
        <div className="toolbar-control toolbar-step-control">
          <IonicStepControl
            total={totalSteps}
            selectedIndex={selectedStepIndex}
            onSelect={onSelectStep}
            includeInitial={initialAvailable}
          />
        </div>
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
      </div>
      <div className="toolbar-secondary-dock" data-testid="structure-toolbar-secondary">
        {selectedStepIndex === -1 ? totalSteps > 0 && comparison && <>
          <label className="toolbar-control"><input aria-label="Compare structures" type="checkbox" checked={comparison.enabled} onChange={(event) => comparison.onEnabledChange(event.target.checked)} />Compare</label>
          {comparison.enabled && <>
            <label className="toolbar-control">Compare target slider<input aria-label="Comparison target slider" type="range" min="1" max={totalSteps} step="1" value={comparison.target + 1} onChange={(event) => comparison.onTargetChange(Number(event.target.value) - 1)} /></label>
            <label className="toolbar-control">Compare target number<input aria-label="Comparison target number" type="number" min="1" max={totalSteps} value={comparisonTargetDraft} onChange={(event) => setComparisonTargetDraft(event.target.value)} onBlur={commitComparisonTarget} onKeyDown={(event) => { if (event.key === "Enter") commitComparisonTarget(); }} /></label>
            <ForceScaleControl value={comparison.displacementScale} onChange={comparison.onDisplacementScaleChange} label="Displacement arrow multiplier" />
          </>}
        </> : <>
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
      </div>
    </header>
  );
}
