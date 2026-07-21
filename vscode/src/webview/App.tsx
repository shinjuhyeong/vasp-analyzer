import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
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
import { CompactToolbar } from "./features/layout/CompactToolbar.js";
import type { PalettePosition } from "./features/layout/DraggableCrystalPalette.js";
import { ResizableWorkspace } from "./features/layout/ResizableWorkspace.js";
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
  readonly palettePosition: Readonly<PalettePosition>;
  readonly paletteCollapsed: boolean;
  readonly onPalettePositionChange: (position: Readonly<PalettePosition>) => void;
  readonly onPaletteCollapsedChange: (collapsed: boolean) => void;
  readonly onResetLayout: () => void;
  readonly inspectorWidth: number;
  readonly inspectorCollapsed: boolean;
  readonly onInspectorWidthChange: (width: number) => void;
  readonly onInspectorCollapsedChange: (collapsed: boolean) => void;
  readonly structureFullScreen: boolean;
}

export interface AppProps {
  readonly host: AnalysisHost;
  readonly structure?: ComponentType<AnalysisRegionProps>;
  readonly convergence?: ComponentType<AnalysisRegionProps>;
  readonly rendererFactory?: CrystalRendererFactory;
}

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
  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenSnapshot = useRef<Readonly<{
    structurePercent: number;
    inspectorWidth: number;
    inspectorCollapsed: boolean;
  }> | null>(null);

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
      version: 2,
      selectedStep: state.selectedStep,
      selectedSite: state.selectedSite,
      forceMode: state.forceMode,
      forceScale: state.forceScale,
      layout: state.layout,
    });
  }, [host, load, state]);

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
    onSelectSite: (site) => {
      if (
        site !== null &&
        state.selectedSite === null &&
        state.layout.inspectorCollapsed
      )
        dispatch({
          type: "setLayout",
          layout: { inspectorCollapsed: false },
        });
      dispatch({ type: "selectSite", site });
    },
    onSelectStep: (step) => dispatch({ type: "selectStep", step }),
    palettePosition: { x: state.layout.paletteX, y: state.layout.paletteY },
    paletteCollapsed: state.layout.paletteCollapsed,
    onPalettePositionChange: (position) =>
      dispatch({
        type: "setLayout",
        layout: { paletteX: position.x, paletteY: position.y },
      }),
    onPaletteCollapsedChange: (collapsed) =>
      dispatch({ type: "setLayout", layout: { paletteCollapsed: collapsed } }),
    onResetLayout: () => dispatch({ type: "resetLayout" }),
    inspectorWidth: state.layout.inspectorWidth,
    inspectorCollapsed: state.layout.inspectorCollapsed,
    onInspectorWidthChange: (width) =>
      dispatch({ type: "setLayout", layout: { inspectorWidth: width } }),
    onInspectorCollapsedChange: (collapsed) =>
      dispatch({ type: "setLayout", layout: { inspectorCollapsed: collapsed } }),
    structureFullScreen: fullScreen,
  };
  const Structure = structure;
  const capabilityReason = (name: "dos" | "band" | "charge"): string =>
    state.dataset?.capabilities.find((capability) => capability.name === name)
      ?.reason ?? `${name} analysis is not available`;

  const changeFullScreen = (next: boolean): void => {
    if (next === fullScreen) return;
    if (next) {
      fullScreenSnapshot.current = {
        structurePercent: state.layout.structurePercent,
        inspectorWidth: state.layout.inspectorWidth,
        inspectorCollapsed: state.layout.inspectorCollapsed,
      };
    } else if (fullScreenSnapshot.current) {
      dispatch({ type: "setLayout", layout: fullScreenSnapshot.current });
      fullScreenSnapshot.current = null;
    }
    setFullScreen(next);
  };

  return (
    <ResizableWorkspace
      structurePercent={state.layout.structurePercent}
      onStructurePercentChange={(structurePercent) =>
        dispatch({ type: "setLayout", layout: { structurePercent } })
      }
      fullScreen={fullScreen}
      onFullScreenChange={changeFullScreen}
      structure={<section className="structure-region" aria-label="Crystal structure">
        <CompactToolbar
          title={
            <div className="title-group">
              <span className="eyebrow">Structure</span>
              <strong>
                {state.dataset.root.split(/[\\/]/).filter(Boolean).at(-1) ??
                  "Calculation"}
              </strong>
            </div>
          }
          totalSteps={state.dataset.ionicSteps.length}
          selectedStepIndex={state.selectedStep}
          onSelectStep={(step) => dispatch({ type: "selectStep", step })}
          forceMode={state.forceMode}
          onForceModeChange={(mode) => dispatch({ type: "setForceMode", mode })}
          forceScale={state.forceScale}
          onForceScaleChange={(scale) => dispatch({ type: "setForceScale", scale })}
          fullScreen={fullScreen}
          onFullScreenChange={changeFullScreen}
        />
        <div className="structure-canvas">
          {Structure ? (
            <Structure {...regionProps} />
          ) : rendererFactory ? (
            <CrystalPanel {...regionProps} rendererFactory={rendererFactory} />
          ) : (
            <EmptyStructure {...regionProps} />
          )}
        </div>
      </section>}
      analysis={<section className="analysis-region" aria-label="Calculation analysis">
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
      </section>}
    />
  );
}
