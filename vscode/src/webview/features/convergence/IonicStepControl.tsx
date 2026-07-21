import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";

interface IonicStepControlBaseProps {
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
}

export type IonicStepControlProps = IonicStepControlBaseProps &
  (
    | { readonly total: number; readonly steps?: never }
    | { readonly total?: never; readonly steps: readonly unknown[] }
  );

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function IonicStepControl({ total: totalProp, steps, selectedIndex, onSelect }: IonicStepControlProps): ReactElement {
  const total = totalProp ?? steps.length;
  const selectedStep = selectedIndex + 1;
  const [draft, setDraft] = useState(String(selectedStep));

  useEffect(() => setDraft(String(selectedStep)), [selectedStep]);

  const selectDraft = (value: string): void => {
    const step = Number(value);
    if (Number.isFinite(step) && Number.isInteger(step) && step >= 1 && step <= total) {
      onSelect(step - 1);
    }
  };

  const normalizeDraft = (): void => {
    if (draft.trim() === "") {
      setDraft(String(selectedStep));
      return;
    }

    const parsed = Number(draft);
    const step = Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, total) : selectedStep;
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
      <label>
        Ionic step slider
        <input
          type="range"
          aria-label="Ionic step slider"
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
      </label>
      <label>
        Ionic step number
        <input
          type="number"
          aria-label="Ionic step number"
          min="1"
          max={Math.max(total, 1)}
          step="1"
          value={draft}
          disabled={total === 0}
          onChange={(event) => {
            setDraft(event.target.value);
            selectDraft(event.target.value);
          }}
          onBlur={normalizeDraft}
          onKeyDown={handleKeyDown}
        />
      </label>
      <span>/ {total}</span>
    </div>
  );
}
