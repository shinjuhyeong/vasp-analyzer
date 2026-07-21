import type { ReactElement } from "react";

import type {
  AnalysisMetric,
  AnalysisModuleId,
  CalculationDataset,
  ConvergencePreferences,
  ModuleMode,
} from "../../core/contracts.js";
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

const metricOptions: Readonly<
  Record<
    AnalysisModuleId,
    readonly Readonly<{ value: AnalysisMetric; label: string }>[]
  >
> = {
  energy: [
    { value: "totalEnergy", label: "Total energy" },
    { value: "deltaEnergy", label: "Energy change" },
  ],
  force: [
    { value: "strongestFreeComponent", label: "Strongest free component" },
    { value: "rmsFreeForce", label: "RMS free force" },
  ],
  cellStress: [
    { value: "externalPressure", label: "External pressure" },
    { value: "cellVolume", label: "Cell volume" },
  ],
};

function placeholderFor(id: AnalysisModuleId, mode: ModuleMode): string {
  switch (id) {
    case "energy":
      return `Energy ${mode} view will be available in the detailed analysis module.`;
    case "force":
      return `Force ${mode} view will be available in the detailed analysis module.`;
    case "cellStress":
      return `Cell & Stress ${mode} view will be available in the detailed analysis module.`;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

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
  preferences,
  onPreferencesChange,
}: Pick<ConvergenceWorkspaceProps, "preferences" | "onPreferencesChange"> & {
  readonly id: AnalysisModuleId;
}): ReactElement {
  const label = moduleLabels[id];
  const changeMetric = (metric: AnalysisMetric): void => {
    onPreferencesChange({
      ...preferences,
      metrics: { ...preferences.metrics, [id]: metric },
    });
  };
  const changeMode = (mode: ModuleMode): void => {
    onPreferencesChange({
      ...preferences,
      modes: { ...preferences.modes, [id]: mode },
    });
  };
  return (
    <section className="convergence-module" aria-label={`${label} analysis`}>
      <header className="convergence-module-header">
        <h3>{label}</h3>
        <label>
          <span className="visually-hidden">{label} metric</span>
          <select
            aria-label={`${label} metric`}
            value={preferences.metrics[id]}
            onChange={(event) =>
              changeMetric(event.target.value as AnalysisMetric)
            }
          >
            {metricOptions[id].map(({ value, label: optionLabel }) => (
              <option key={value} value={value}>{optionLabel}</option>
            ))}
          </select>
        </label>
        <div
          className="convergence-mode-picker"
          aria-label={`${label} presentation mode`}
        >
          {(["graph", "table"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-label={`${label} ${mode === "graph" ? "Graph" : "Table"} mode`}
              aria-pressed={preferences.modes[id] === mode}
              onClick={() => changeMode(mode)}
            >
              {mode === "graph" ? "Graph" : "Table"}
            </button>
          ))}
        </div>
      </header>
      <p className="module-placeholder" role="status">
        {placeholderFor(id, preferences.modes[id])}
      </p>
    </section>
  );
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
            preferences={props.preferences}
            onPreferencesChange={props.onPreferencesChange}
          />
        ))}
      </div>
    </section>
  );
}
