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
        <h3>Rule changes</h3>
        {Object.keys(manifest.ruleChangedLineCounts).length > 0 ? (
          <ul aria-label="Rule change summary">
            {Object.entries(manifest.ruleChangedLineCounts)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([ruleId, count]) => (
                <li key={ruleId}><code>{ruleId}</code>: {count} {count === 1 ? "line" : "lines"}</li>
              ))}
          </ul>
        ) : <p>No rule changes recorded.</p>}
        <h3>Warnings</h3>
        {manifest.warnings.length > 0 ? (
          <ul aria-label="Normalization warnings">
            {manifest.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
          </ul>
        ) : <p>No normalization warnings.</p>}
        <h3>Changed lines</h3>
        {manifest.changes.length > 0 ? (
          <div className="detail-table-scroll"><table className="detail-table">
            <thead><tr><th>Line</th><th>Rule</th><th>Original</th><th>Normalized</th></tr></thead>
            <tbody>{manifest.changes.map((change) => <tr key={`${change.sourceLine}-${change.ruleId}`}>
              <td>{change.sourceLine}</td><td>{change.ruleId}</td>
              <td><code>{change.originalExcerpt}</code></td><td><code>{change.emittedExcerpt}</code></td>
            </tr>)}</tbody>
          </table></div>
        ) : <p>No changed lines to display.</p>}
      </> : null}
    </section>
  );
}
