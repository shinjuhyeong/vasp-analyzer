import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

export type AnalysisTabId = "convergence" | "parameters";

export interface AnalysisTabsProps {
  readonly convergence: ReactNode;
  readonly parameters: ReactNode;
  readonly capabilityReasons: Readonly<{
    dos: string;
    band: string;
    charge: string;
  }>;
}

const enabledTabs: readonly AnalysisTabId[] = ["convergence", "parameters"];
const labels: Readonly<Record<AnalysisTabId, string>> = {
  convergence: "Convergence",
  parameters: "Parameters",
};

export function AnalysisTabs({
  convergence,
  parameters,
  capabilityReasons,
}: AnalysisTabsProps): ReactElement {
  const [active, setActive] = useState<AnalysisTabId>("convergence");
  const tabRefs = useRef<Partial<Record<AnalysisTabId, HTMLButtonElement | null>>>({});

  const selectAndFocus = (next: AnalysisTabId): void => {
    setActive(next);
    tabRefs.current[next]?.focus();
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, current: AnalysisTabId): void => {
    const index = enabledTabs.indexOf(current);
    let next: AnalysisTabId | null = null;
    if (event.key === "ArrowRight") next = enabledTabs[(index + 1) % enabledTabs.length]!;
    if (event.key === "ArrowLeft") next = enabledTabs[(index - 1 + enabledTabs.length) % enabledTabs.length]!;
    if (event.key === "Home") next = enabledTabs[0]!;
    if (event.key === "End") next = enabledTabs.at(-1)!;
    if (next === null) return;
    event.preventDefault();
    selectAndFocus(next);
  };

  return (
    <>
      <div className="tab-list" role="tablist" aria-label="Analysis type">
        {enabledTabs.map((id) => (
          <button
            key={id}
            ref={(element) => { tabRefs.current[id] = element; }}
            id={`analysis-tab-${id}`}
            type="button"
            role="tab"
            aria-controls={`analysis-panel-${id}`}
            aria-selected={active === id}
            tabIndex={active === id ? 0 : -1}
            onClick={() => setActive(id)}
            onKeyDown={(event) => navigate(event, id)}
          >
            {labels[id]}
          </button>
        ))}
        <button type="button" role="tab" aria-selected="false" disabled title={capabilityReasons.dos}>DOS/PDOS</button>
        <button type="button" role="tab" aria-selected="false" disabled title={capabilityReasons.band}>Band</button>
        <button type="button" role="tab" aria-selected="false" disabled title={capabilityReasons.charge}>Charge</button>
      </div>
      <p className="capability-hint">
        Future analyses: DOS/PDOS — {capabilityReasons.dos} · Band — {capabilityReasons.band} · Charge — {capabilityReasons.charge}
      </p>
      <div
        id="analysis-panel-convergence"
        className="analysis-content"
        role="tabpanel"
        aria-labelledby="analysis-tab-convergence"
        hidden={active !== "convergence"}
      >
        {convergence}
      </div>
      <div
        id="analysis-panel-parameters"
        className="analysis-content"
        role="tabpanel"
        aria-labelledby="analysis-tab-parameters"
        hidden={active !== "parameters"}
      >
        {parameters}
      </div>
    </>
  );
}
