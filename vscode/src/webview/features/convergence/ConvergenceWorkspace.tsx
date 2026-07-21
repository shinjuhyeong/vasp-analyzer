import type { ReactElement } from "react";

import type {
  AnalysisModuleId,
  CalculationDataset,
  ConvergencePreferences,
} from "../../core/contracts.js";
import { CellStressModule } from "./CellStressModule.js";
import { EnergyModule } from "./EnergyModule.js";
import { ForceModule } from "./ForceModule.js";
import { IonicStepControl } from "./IonicStepControl.js";

export interface ConvergenceWorkspaceProps {
  readonly dataset: CalculationDataset;
  readonly selectedIndex: number;
  readonly preferences: ConvergencePreferences;
  readonly onSelectStep: (index: number) => void;
  readonly onPreferencesChange: (next: ConvergencePreferences) => void;
  readonly onSelectSite: (siteIndex: number) => void;
}

const moduleOrder: readonly AnalysisModuleId[] = ["energy", "force", "cellStress"];

const moduleLabels: Readonly<Record<AnalysisModuleId, string>> = {
  energy: "Energy",
  force: "Force",
  cellStress: "Cell & Stress",
};

function ModulePicker({
  selected,
  onChange,
}: {
  readonly selected: readonly AnalysisModuleId[];
  readonly onChange: (id: AnalysisModuleId, enabled: boolean) => void;
}): ReactElement {
  return (
    <div className="convergence-module-picker" aria-label="Convergence modules">
      {moduleOrder.map((id) => {
        const enabled = selected.includes(id);
        return (
          <button
            key={id}
            type="button"
            aria-label={`${moduleLabels[id]} module`}
            aria-pressed={enabled}
            onClick={() => onChange(id, !enabled)}
          >
            {moduleLabels[id]}
          </button>
        );
      })}
    </div>
  );
}

function ModuleSlot({
  id,
  dataset,
  selectedIndex,
  preferences,
  onSelectStep,
  onPreferencesChange,
  onSelectSite,
}: ConvergenceWorkspaceProps & {
  readonly id: AnalysisModuleId;
}): ReactElement {
  const changeMode = (mode: "graph" | "table"): void => {
    onPreferencesChange({
      ...preferences,
      modes: { ...preferences.modes, [id]: mode },
    });
  };
  const common = { dataset, selectedIndex, mode: preferences.modes[id], onModeChange: changeMode, onSelectStep };
  switch (id) {
    case "energy": return <section className="convergence-module" aria-label="Energy analysis"><EnergyModule {...common} metric={preferences.metrics.energy} onMetricChange={(metric) => onPreferencesChange({ ...preferences, metrics: { ...preferences.metrics, energy: metric } })} /></section>;
    case "force": return <section className="convergence-module" aria-label="Force analysis"><ForceModule {...common} metric={preferences.metrics.force} onMetricChange={(metric) => onPreferencesChange({ ...preferences, metrics: { ...preferences.metrics, force: metric } })} onSelectSite={onSelectSite} /></section>;
    case "cellStress": return <section className="convergence-module" aria-label="Cell & Stress analysis"><CellStressModule {...common} metric={preferences.metrics.cellStress} onMetricChange={(metric) => onPreferencesChange({ ...preferences, metrics: { ...preferences.metrics, cellStress: metric } })} /></section>;
    default: { const unreachable: never = id; return unreachable; }
  }
}

export function ConvergenceWorkspace(props: ConvergenceWorkspaceProps): ReactElement {
  const selected = moduleOrder.filter((id) =>
    props.preferences.selectedModules.includes(id),
  );
  const setSelected = (id: AnalysisModuleId, enabled: boolean): void => {
    const next = enabled
      ? moduleOrder.filter((candidate) => selected.includes(candidate) || candidate === id)
      : selected.filter((candidate) => candidate !== id);
    if (next.length > 0)
      props.onPreferencesChange({ ...props.preferences, selectedModules: next });
  };
  return (
    <section className="convergence-workspace" aria-label="Convergence workspace">
      <div className="convergence-workspace-controls">
        <IonicStepControl
          total={props.dataset.ionicSteps.length}
          selectedIndex={props.selectedIndex}
          onSelect={props.onSelectStep}
          labelPrefix="Convergence "
        />
        <ModulePicker selected={selected} onChange={setSelected} />
      </div>
      <div
        className="convergence-module-grid"
        data-count={selected.length}
        data-testid="convergence-module-grid"
      >
        {selected.map((id) => (
          <ModuleSlot
            key={id}
            id={id}
            {...props}
          />
        ))}
      </div>
    </section>
  );
}
