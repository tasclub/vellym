import type { ChangeEvent } from "react";
import { Button } from "./button.js";
import styles from "./choice-control.module.css";

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface ChoiceControlProps {
  mode: "select" | "segmented";
  options: readonly ChoiceOption[];
  value: string;
  onChange(value: string): void;
  "aria-label": string;
  disabled?: boolean;
}

/** Shared host control for choosing one value, either as a select or a segment. */
export function ChoiceControl({ mode, options, value, onChange, disabled, ...aria }: ChoiceControlProps) {
  if (mode === "select") {
    return <select
      className={styles.select}
      aria-label={aria["aria-label"]}
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }
  return <div className={styles.segments} role="group" aria-label={aria["aria-label"]}>
    {options.map((option) => <Button
      key={option.value}
      className={styles.segment}
      aria-pressed={value === option.value}
      disabled={disabled}
      onClick={() => onChange(option.value)}
    >{option.label}</Button>)}
  </div>;
}
