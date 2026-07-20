import type { ReactElement } from "react";

export interface IonicStepControlProps {
  readonly steps: readonly { readonly index: number }[];
  readonly selectedIndex: number;
  readonly onSelect: (arrayIndex: number) => void;
}

export function IonicStepControl({ steps, selectedIndex, onSelect }: IonicStepControlProps): ReactElement {
  return (
    <label>
      Ionic step
      <select
        value={selectedIndex}
        disabled={steps.length === 0}
        onChange={(event) => onSelect(Number(event.target.value))}
      >
        {steps.map((step, arrayIndex) => (
          <option key={arrayIndex} value={arrayIndex}>
            {step.index + 1} / {steps.length}
          </option>
        ))}
      </select>
    </label>
  );
}
