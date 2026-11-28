import { useEffect, useId, useRef, useState } from "react";
import { HexAlphaColorPicker } from "react-colorful";
import { TOKEN_REFERENCE_PATTERN } from "../model/values.js";
import { designText } from "../i18n.js";
import { useInspectorLocale } from "./fields/locale.js";
import { TokenButton, type TokenOption } from "./fields/token-button.js";

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TOKEN = new RegExp(TOKEN_REFERENCE_PATTERN);
/** #rgb(a) → #rrggbb(aa), lower case; anything else is returned unchanged. */
export function normalizeHex(value: string): string {
  if (!HEX.test(value)) return value;
  const body = value.slice(1).toLowerCase();
  return `#${body.length <= 4 ? [...body].map(c => c + c).join("") : body}`;
}
export function isColorInput(value: string): boolean { return HEX.test(value) || TOKEN.test(value); }

/**
 * A colour: a swatch that opens the colour area, hue and opacity (react-colorful), a
 * hex text field, and a token picker. Dragging in the picker commits as it goes
 * (the caller merges the steps into one undo).
 */
export function ColorField({ label, value, onCommit, tokens, resolve, testId, disabled }: {
  label: string; value: string | undefined; onCommit: (value: string, step: boolean) => void;
  tokens: readonly TokenOption[]; resolve: (value: string) => string | undefined; testId: string; disabled?: boolean;
}) {
  const locale = useInspectorLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const swatch = useRef<HTMLButtonElement>(null);
  const shown = value ? resolve(value) ?? value : "transparent";
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === value || !isColorInput(trimmed)) { setText(value ?? ""); return; }
    onCommit(normalizeHex(trimmed), false);
  };
  const close = () => { setOpen(false); swatch.current?.focus(); };
  return <div className="design-field design-color-field">
    <label htmlFor={id}>{label}</label>
    <div className="design-color-row">
      <button ref={swatch} type="button" className="design-swatch" style={{ background: shown }} disabled={disabled}
        aria-label={designText.openColorPicker[locale].replace("{field}", label)} aria-expanded={open}
        data-testid={`${testId}-swatch`} onClick={() => setOpen(!open)} />
      <input id={id} type="text" value={text} disabled={disabled} data-testid={testId} spellCheck={false}
        onChange={event => setText(event.target.value)} onBlur={event => commit(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); commit(event.currentTarget.value); }
          if (event.key === "Escape") { event.preventDefault(); setText(value ?? ""); }
        }} />
      {!disabled && <TokenButton tokens={tokens} label={label} onPick={path => onCommit(`{${path}}`, false)} />}
    </div>
    {open && <div className="design-color-popover" role="group" aria-label={label} data-testid={`${testId}-picker`}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <HexAlphaColorPicker color={value && HEX.test(value) ? normalizeHex(value) : "#000000"}
        onChange={next => onCommit(next.toLowerCase(), true)} />
      <button type="button" onClick={close}>{designText.closePresentation[locale]}</button>
    </div>}
  </div>;
}
