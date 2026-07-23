import { useEffect, useState, type ReactElement } from "react";

import type { AnalysisHost, NormalizationManifest } from "../../core/contracts.js";

export function NormalizationReport({
  host,
  manifestReference,
  onClose,
}: {
  readonly host: AnalysisHost;
  readonly manifestReference: string;
  readonly onClose: () => void;
}): ReactElement {
  const [manifest, setManifest] = useState<NormalizationManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void host.request("getNormalizationManifest", { manifestReference }).then(
      (result) => {
        if (active && "changes" in result) setManifest(result);
      },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load normalization report");
      },
    );
    return () => { active = false; };
  }, [host, manifestReference]);
  return (
    <section className="normalization-report" aria-label="Normalization report">
      <header><h2>Normalization report</h2><button type="button" onClick={onClose}>Close</button></header>
      {error ? <p role="alert">{error}</p> : null}
      {!manifest && !error ? <p>Loading report…</p> : null}
      {manifest ? <>
        <p>{manifest.displayName}: {manifest.changedLineCount} changed lines</p>
        <div className="detail-table-scroll"><table className="detail-table">
          <thead><tr><th>Line</th><th>Rule</th><th>Original</th><th>Normalized</th></tr></thead>
          <tbody>{manifest.changes.map((change) => <tr key={`${change.sourceLine}-${change.ruleId}`}>
            <td>{change.sourceLine}</td><td>{change.ruleId}</td>
            <td><code>{change.originalExcerpt}</code></td><td><code>{change.emittedExcerpt}</code></td>
          </tr>)}</tbody>
        </table></div>
      </> : null}
    </section>
  );
}
