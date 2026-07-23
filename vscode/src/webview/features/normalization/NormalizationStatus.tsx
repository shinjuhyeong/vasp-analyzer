import type { ReactElement } from "react";

import type { ParserProvenance } from "../../core/contracts.js";

export function NormalizationStatus({
  provenance,
  onOpenReport,
}: {
  readonly provenance: ParserProvenance | null;
  readonly onOpenReport: () => void;
}): ReactElement | null {
  if (!provenance) return null;
  const changed = provenance.normalizationChangedLineCount;
  return (
    <aside className="normalization-status" aria-label="OUTCAR parser status">
      <span>Parser: {provenance.adapter} {provenance.adapterVersion}</span>
      <span>Normalizer: {provenance.normalizerDisplayName ?? "Standard"}</span>
      {changed > 0 ? (
        <span role="alert">OUTCAR normalized: {changed} lines changed.</span>
      ) : null}
      {changed > 0 && provenance.normalizationManifestReference ? (
        <button type="button" onClick={onOpenReport}>Normalization report</button>
      ) : null}
    </aside>
  );
}
