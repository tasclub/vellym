import { useEffect, useId, useRef, useState } from "react";
import { designText } from "../../i18n.js";
import { useInspectorLocale } from "./locale.js";

export interface TokenOption { path: string; value: string | number }

/**
 * The button beside a value that picks a token. The token list and editing belong to
 * the token panel; this only offers the canvas's tokens that suit the field.
 */
export function TokenButton({ tokens, label, onPick }: { tokens: readonly TokenOption[]; label: string; onPick: (path: string) => void }) {
  const locale = useInspectorLocale();
  const [open, setOpen] = useState(false);
  const list = useId(), button = useRef<HTMLButtonElement>(null), first = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <span className="design-token-picker">
    <button ref={button} type="button" aria-haspopup="true" aria-expanded={open} aria-controls={open ? list : undefined}
      aria-label={designText.pickToken[locale].replace("{field}", label)} data-testid="design-token-button"
      onClick={() => setOpen(!open)}>◇</button>
    {open && <div id={list} role="group" aria-label={designText.tokens[locale]} className="design-token-list"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      {tokens.length ? tokens.map((token, i) => <button key={token.path} ref={i ? undefined : first} type="button"
        data-testid={`design-token-${token.path}`} onClick={() => { onPick(token.path); close(); }}>
        <span>{token.path}</span><span className="design-token-value">{String(token.value)}</span>
      </button>) : <p>{designText.noTokens[locale]}</p>}
    </div>}
  </span>;
}
