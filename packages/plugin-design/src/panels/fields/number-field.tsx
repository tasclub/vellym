import { useEffect, useId, useState } from "react";
import { TOKEN_REFERENCE_PATTERN } from "../../model/values.js";
import { evaluate } from "./expression.js";
import { TokenButton, type TokenOption } from "./token-button.js";

export const MIXED = Symbol("mixed");
export type FieldValue = number | string | undefined | typeof MIXED;
const TOKEN = new RegExp(TOKEN_REFERENCE_PATTERN);

/**
 * A number input: Enter or leaving the field commits once; ↑/↓ step by 1 (Shift 10) and commit
 * at once (the caller merges repeats); Escape restores. Typed arithmetic such as `16*2` is
 * evaluated. With `tokens`, a token reference `{a.b}` is also accepted.
 */
export function NumberField({ label, value, onCommit, min, max, scale = 1, suffix, tokens, mixedLabel, disabled, testId }: {
  label: string; value: FieldValue; onCommit: (value: number | string, step: boolean) => void;
  min?: number; max?: number; scale?: number; suffix?: string; tokens?: readonly TokenOption[];
  mixedLabel: string; disabled?: boolean; testId: string;
}) {
  const id = useId();
  const shown = value === MIXED || value === undefined ? "" : typeof value === "number" ? String(Math.round(value * scale * 100) / 100) : value;
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (raw: string, step = false) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === shown) { setText(shown); return; }
    if (tokens && TOKEN.test(trimmed)) { onCommit(trimmed, step); return; }
    const number = evaluate(trimmed);
    if (number === undefined) { setText(shown); return; }
    onCommit(clamp(number) / scale, step);
  };
  return <div className="design-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} data-testid={testId} type="text" inputMode="decimal" value={text} disabled={disabled}
      placeholder={value === MIXED ? mixedLabel : undefined} aria-describedby={suffix ? `${id}-suffix` : undefined}
      onChange={event => setText(event.target.value)}
      onBlur={event => commit(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); commit(event.currentTarget.value); }
        else if (event.key === "Escape") { event.preventDefault(); setText(shown); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const base = typeof value === "number" ? value * scale : evaluate(text) ?? 0;
          event.preventDefault();
          const next = clamp(base + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
          setText(String(Math.round(next * 100) / 100));
          onCommit(next / scale, true);
        }
      }} />
    {suffix && <span id={`${id}-suffix`} className="design-field-suffix">{suffix}</span>}
    {tokens && !disabled && <TokenButton tokens={tokens} label={label} onPick={path => onCommit(`{${path}}`, false)} />}
  </div>;
}
