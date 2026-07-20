import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import type {
  AnalysisHost,
  CalculationDataset,
  IonicStep,
  Site,
} from "./core/contracts.js";
import { analysisReducer, initialAnalysisState } from "./core/store.js";
import { ConvergencePanel } from "./features/convergence/ConvergencePanel.js";
import { IonicStepControl } from "./features/convergence/IonicStepControl.js";
import { CrystalPanel } from "./features/structure/CrystalPanel.js";
import type { CrystalRendererFactory } from "./renderers/CrystalRenderer.js";

export interface AnalysisRegionProps {
  readonly dataset: CalculationDataset;
  readonly sites: readonly Site[];
  readonly selectedStep: IonicStep;
  readonly selectedStepIndex: number;
  readonly selectedSite: Site | null;
  readonly forceMode: "free" | "raw";
  readonly forceScale: number;
  readonly onSelectSite: (siteIndex: number | null) => void;
  readonly onSelectStep: (arrayIndex: number) => void;
}

export interface AppProps {
  readonly host: AnalysisHost;
  readonly structure?: ComponentType<AnalysisRegionProps>;
  readonly convergence?: ComponentType<AnalysisRegionProps>;
  readonly rendererFactory?: CrystalRendererFactory;
}

const MIN_STRUCTURE_PERCENT = 30;
const MAX_STRUCTURE_PERCENT = 80;

function EmptyStructure({ selectedStep }: AnalysisRegionProps): ReactElement {
  return (
    <div className="empty-slot">
      Crystal workspace for ionic step {selectedStep.index + 1}
    </div>
  );
}

function DefaultConvergence({
  dataset,
  selectedStepIndex,
  onSelectStep,
}: AnalysisRegionProps): ReactElement {
  return (
    <ConvergencePanel
      dataset={dataset}
      selectedIndex={selectedStepIndex}
      onSelectStep={onSelectStep}
    />
  );
}

function clampSplit(value: number): number {
  const clamped = Math.min(
    MAX_STRUCTURE_PERCENT,
    Math.max(MIN_STRUCTURE_PERCENT, value),
  );
  return Math.round(clamped / 5) * 5;
}

export function App({
  host,
  structure,
  convergence: Convergence = DefaultConvergence,
  rendererFactory,
}: AppProps): ReactElement {
  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState);
  const [load, setLoad] = useState<
    Readonly<{ host: AnalysisHost | null; error: string | null }>
  >({ host: null, error: null });
  const [split, setSplit] = useState(60);
  const workspace = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoad({ host: null, error: null });
    void host.request("getDataset", {}).then(
      (result) => {
        if (active && "schemaVersion" in result) {
          const persisted = host.getState();
          dispatch(
            persisted
              ? { type: "datasetLoaded", dataset: result, persisted }
              : { type: "datasetLoaded", dataset: result },
          );
          setLoad({ host, error: null });
        }
      },
      (reason: unknown) => {
        if (active)
          setLoad({
            host,
            error:
              reason instanceof Error
                ? reason.message
                : "Unable to load the calculation",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [host]);

  useEffect(() => {
    if (!state.dataset || load.host !== host || load.error !== null) return;
    host.setState({
      selectedStep: state.selectedStep,
      selectedSite: state.selectedSite,
    });
  }, [host, load, state.dataset, state.selectedSite, state.selectedStep]);

  const selectedStep = state.dataset?.ionicSteps[state.selectedStep];
  const selectedSite = useMemo(
    () =>
      state.dataset?.sites.find(
        (site) => site.siteIndex === state.selectedSite,
      ) ?? null,
    [state.dataset, state.selectedSite],
  );

  if (load.host === host && load.error)
    return (
      <main className="status-panel" role="alert">
        {load.error}
      </main>
    );
  if (load.host !== host || !state.dataset)
    return (
      <main className="status-panel" aria-live="polite">
        Loading VASP calculation…
      </main>
    );
  if (!selectedStep)
    return (
      <main className="status-panel" aria-live="polite">
        No ionic steps are available in this calculation.
      </main>
    );

  const regionProps: AnalysisRegionProps = {
    dataset: state.dataset,
    sites: state.dataset.sites,
    selectedStep,
    selectedStepIndex: state.selectedStep,
    selectedSite,
    forceMode: state.forceMode,
    forceScale: state.forceScale,
    onSelectSite: (site) => dispatch({ type: "selectSite", site }),
    onSelectStep: (step) => dispatch({ type: "selectStep", step }),
  };
  const Structure = structure;
  const capabilityReason = (name: "dos" | "band" | "charge"): string =>
    state.dataset?.capabilities.find((capability) => capability.name === name)
      ?.reason ?? `${name} analysis is not available`;

  const updateFromPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    const bounds = workspace.current?.getBoundingClientRect();
    if (!bounds || bounds.height <= 0) return;
    setSplit(clampSplit(((event.clientY - bounds.top) / bounds.height) * 100));
  };

  return (
    <main
      className={`analysis-workspace split-${split}`}
      ref={workspace}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
          updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
      }}
    >
      <section className="structure-region" aria-label="Crystal structure">
        <header className="workspace-toolbar">
          <div className="title-group">
            <span className="eyebrow">Structure</span>
            <strong>
              {state.dataset.root.split(/[\\/]/).filter(Boolean).at(-1) ??
                "Calculation"}
            </strong>
          </div>
          <IonicStepControl
            steps={state.dataset.ionicSteps}
            selectedIndex={state.selectedStep}
            onSelect={(step) => dispatch({ type: "selectStep", step })}
          />
          <label>
            Force components
            <select
              value={state.forceMode}
              onChange={(event) =>
                dispatch({
                  type: "setForceMode",
                  mode: event.target.value as "free" | "raw",
                })
              }
            >
              <option value="free">Movable only</option>
              <option value="raw">All components</option>
            </select>
          </label>
          <label>
            Force vector scale
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={state.forceScale}
              onChange={(event) =>
                dispatch({
                  type: "setForceScale",
                  scale: Number(event.target.value),
                })
              }
            />
          </label>
        </header>
        <div className="structure-canvas">
          {Structure ? (
            <Structure {...regionProps} />
          ) : rendererFactory ? (
            <CrystalPanel {...regionProps} rendererFactory={rendererFactory} />
          ) : (
            <EmptyStructure {...regionProps} />
          )}
        </div>
      </section>

      <div
        className="splitter"
        role="separator"
        aria-label="Resize structure and analysis regions"
        aria-orientation="horizontal"
        aria-valuemin={MIN_STRUCTURE_PERCENT}
        aria-valuemax={MAX_STRUCTURE_PERCENT}
        aria-valuenow={Math.round(split)}
        tabIndex={0}
        onPointerDown={(event) => {
          workspace.current?.setPointerCapture?.(event.pointerId);
          updateFromPointer(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp")
            setSplit((value) => clampSplit(value - 5));
          else if (event.key === "ArrowDown")
            setSplit((value) => clampSplit(value + 5));
          else if (event.key === "Home") setSplit(MIN_STRUCTURE_PERCENT);
          else if (event.key === "End") setSplit(MAX_STRUCTURE_PERCENT);
          else return;
          event.preventDefault();
        }}
      >
        <span />
      </div>

      <section className="analysis-region" aria-label="Calculation analysis">
        <div className="tab-list" role="tablist" aria-label="Analysis type">
          <button type="button" role="tab" aria-selected="true">
            Convergence
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            title={capabilityReason("dos")}
          >
            DOS/PDOS
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            title={capabilityReason("band")}
          >
            Band
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            title={capabilityReason("charge")}
          >
            Charge
          </button>
        </div>
        <p className="capability-hint">
          Future analyses: DOS/PDOS — {capabilityReason("dos")} · Band —{" "}
          {capabilityReason("band")} · Charge — {capabilityReason("charge")}
        </p>
        <div className="analysis-content" role="tabpanel">
          <Convergence {...regionProps} />
        </div>
      </section>
    </main>
  );
}
