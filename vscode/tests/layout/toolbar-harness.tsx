import { useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import { CompactToolbar } from "../../src/webview/features/layout/CompactToolbar.js";
import "../../src/webview/styles.css";

function ToolbarHarness(): ReactElement {
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [comparisonEnabled, setComparisonEnabled] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setSelectedStepIndex(-1)}>
        Select Initial
      </button>
      <CompactToolbar
        title={
          <div className="title-group">
            <span className="eyebrow">Structure</span>
            <strong>calculation</strong>
          </div>
        }
        totalSteps={12}
        selectedStepIndex={selectedStepIndex}
        onSelectStep={setSelectedStepIndex}
        forceMode="free"
        onForceModeChange={() => undefined}
        forceScale={10}
        onForceScaleChange={() => undefined}
        fullScreen={false}
        onFullScreenChange={() => undefined}
        initialAvailable
        comparison={{
          enabled: comparisonEnabled,
          target: 0,
          displacementScale: 10,
          onEnabledChange: setComparisonEnabled,
          onTargetChange: () => undefined,
          onDisplacementScaleChange: () => undefined,
        }}
      />
    </>
  );
}

const app = document.querySelector("#app");
if (!app) throw new Error("Missing layout harness root");
createRoot(app).render(<ToolbarHarness />);
