import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";

export interface IonicStepControlProps {
  readonly total: number;
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
  readonly labelPrefix?: string;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function IonicStepControl({
  total,
  selectedIndex,
  onSelect,
  labelPrefix = "",
}: IonicStepControlProps): ReactElement {
  const selectedStep = selectedIndex + 1;
  const accessibleLabel = (suffix: "slider" | "number"): string =>
    labelPrefix ? `${labelPrefix}ionic step ${suffix}` : `Ionic step ${suffix}`;
  const [draft, setDraft] = useState(String(selectedStep));

  useEffect(() => setDraft(String(selectedStep)), [selectedStep]);

  const normalizeDraft = (): void => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setDraft(String(selectedStep));
      return;
    }

    const step = clamp(parsed, 1, total);
    setDraft(String(step));
    onSelect(step - 1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      normalizeDraft();
    }
  };

  return (
    <div>
      <div>
        <span>Ionic step slider</span>
        <input
          type="range"
          aria-label={accessibleLabel("slider")}
          min="1"
          max={Math.max(total, 1)}
          step="1"
          value={selectedStep}
          disabled={total === 0}
          onChange={(event) => {
            const step = Number(event.target.value);
            setDraft(event.target.value);
            onSelect(step - 1);
          }}
        />
      </div>
      <div>
        <span>Ionic step number</span>
        <input
          type="number"
          aria-label={accessibleLabel("number")}
          min="1"
          max={Math.max(total, 1)}
          step="1"
          value={draft}
          disabled={total === 0}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={normalizeDraft}
          onKeyDown={handleKeyDown}
        />
      </div>
      <span>{selectedStep} / {total}</span>
    </div>
  );
}
