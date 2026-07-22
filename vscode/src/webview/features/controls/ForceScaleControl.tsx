import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 1000;
const LOG_RANGE = Math.log10(MAX_SCALE / MIN_SCALE);

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const scaleToSlider = (scale: number): number =>
  Math.log10(clamp(scale, MIN_SCALE, MAX_SCALE) / MIN_SCALE) / LOG_RANGE;

export const sliderToScale = (position: number): number =>
  MIN_SCALE * 10 ** (clamp(position, 0, 1) * LOG_RANGE);

const stableScale = (value: number): number => Number(value.toPrecision(4));

export const sliderPositionToScale = (position: number): number => stableScale(sliderToScale(position));

export interface ForceScaleControlProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly label?: string;
}

export function ForceScaleControl({ value, onChange, label = "Force vector scale" }: ForceScaleControlProps): ReactElement {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const changeDraft = (nextDraft: string): void => {
    setDraft(nextDraft);
    const nextValue = Number(nextDraft);
    if (Number.isFinite(nextValue) && nextValue >= MIN_SCALE && nextValue <= MAX_SCALE) {
      onChange(nextValue);
    }
  };

  const normalizeDraft = (): void => {
    if (draft.trim() === "") {
      setDraft(String(value));
      return;
    }

    const parsed = Number(draft);
    const nextValue = Number.isFinite(parsed) ? clamp(parsed, MIN_SCALE, MAX_SCALE) : value;
    setDraft(String(nextValue));
    onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      normalizeDraft();
    }
  };

  return (
    <div>
      <label>
        {label} slider
        <input
          type="range"
          aria-label={`${label} slider`}
          min="0"
          max="1"
          step="0.001"
          value={scaleToSlider(value)}
          onChange={(event) => onChange(sliderPositionToScale(Number(event.target.value)))}
        />
      </label>
      <label>
        {label} number
        <input
          type="number"
          aria-label={`${label} number`}
          min={MIN_SCALE}
          max={MAX_SCALE}
          value={draft}
          onChange={(event) => changeDraft(event.target.value)}
          onBlur={normalizeDraft}
          onKeyDown={handleKeyDown}
        />
      </label>
      <output>{stableScale(value)}×</output>
    </div>
  );
}
