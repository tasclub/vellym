import { useEffect, useState } from "react";
import type { DesignNode, TextNode } from "../model/types.js";
import { designText } from "../i18n.js";
import { styleRange, styleWhole, type SpanStyle } from "../tools/text-tool.js";
import { MIXED, NumberField } from "./fields/number-field.js";
import { registerSection, shared, type InspectorContext, type InspectorTarget } from "./sections.js";

const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
/** Styles a selected run can carry; paragraph and box settings always apply to the whole text. */
const RUN_KEYS = new Set(["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textDecoration", "textTransform"]);
const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

/** The partial node that turns `before` into `after` (removed keys become undefined). */
function patchOf(before: DesignNode, after: DesignNode): Partial<DesignNode> {
  const patch: Record<string, unknown> = { ...after };
  for (const key of Object.keys(before)) if (!(key in after)) patch[key] = undefined;
  return patch as Partial<DesignNode>;
}

function rangeFor(context: InspectorContext, target: InspectorTarget) {
  const range = context.textRange;
  return range && range.board === target.board && range.id === target.node.id ? range : undefined;
}

function apply(context: InspectorContext, style: Partial<SpanStyle> & Record<string, unknown>, mergeKey?: string) {
  context.update(target => {
    if (target.node.type !== "text") return;
    const node = target.node as TextNode, range = rangeFor(context, target);
    const runOnly = Object.keys(style).every(key => RUN_KEYS.has(key));
    const next = range && runOnly ? styleRange(node, range.start, range.end, style) : styleWhole(node, style);
    return patchOf(node, next);
  }, mergeKey);
}

function TextInput({ context, id, label, value, write }: {
  context: InspectorContext; id: string; label: keyof typeof designText; value: string | typeof MIXED; write: (value: string) => void;
}) {
  const shown = value === MIXED ? "" : value;
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => { if (text.trim() !== shown) write(text.trim()); };
  return <div className="design-field">
    <label htmlFor={`design-field-${id}`}>{t(context, label)}</label>
    <input id={`design-field-${id}`} data-testid={`design-field-${id}`} type="text" value={text} disabled={!context.editable}
      placeholder={value === MIXED ? t(context, "mixed") : undefined} onChange={event => setText(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") setText(shown); }} />
  </div>;
}

function Select({ context, id, label, value, options, write }: {
  context: InspectorContext; id: string; label: keyof typeof designText; value: string | typeof MIXED;
  options: readonly (readonly [string, keyof typeof designText | string])[]; write: (value: string) => void;
}) {
  return <div className="design-field">
    <label htmlFor={`design-field-${id}`}>{t(context, label)}</label>
    <select id={`design-field-${id}`} data-testid={`design-field-${id}`} disabled={!context.editable}
      value={value === MIXED ? "" : value} onChange={event => { if (event.target.value) write(event.target.value); }}>
      {value === MIXED && <option value="">{t(context, "mixed")}</option>}
      {options.map(([option, text]) => <option key={option} value={option}>{text in designText ? t(context, text as keyof typeof designText) : text}</option>)}
    </select>
  </div>;
}

registerSection({
  id: "text", tab: "design",
  when: context => context.targets.length > 0 && context.targets.every(target => target.node.type === "text"),
  render: context => {
    const ids = context.targets.map(target => `${target.board}/${target.node.id}`).sort().join(",");
    const read = <K extends keyof TextNode>(key: K, fallback: TextNode[K]) => shared(context.targets, node => (node as TextNode)[key] ?? fallback);
    const range = context.targets.length === 1 ? rangeFor(context, context.targets[0]!) : undefined;
    return <section className="design-inspector-section" aria-labelledby="design-section-text">
      <h2 id="design-section-text">{t(context, "sectionText")}</h2>
      {range && <p className="design-inspector-note" data-testid="design-text-range">
        {t(context, "textRangeNote").replace("{count}", String(range.end - range.start))}
        <button type="button" className="design-inline-button" onClick={context.clearTextRange}>{t(context, "textWhole")}</button>
      </p>}
      <div className="design-field-grid">
        <TextInput context={context} id="font-family" label="fontFamily" value={read("fontFamily", "") as string | typeof MIXED}
          write={value => apply(context, { fontFamily: value || undefined })} />
        <NumberField label={t(context, "fontSize")} value={read("fontSize", 16) as number | string | typeof MIXED} min={1} testId="design-field-font-size"
          mixedLabel={t(context, "mixed")} disabled={!context.editable} tokens={context.lengthTokens}
          onCommit={(value, step) => apply(context, { fontSize: value as TextNode["fontSize"] }, step ? `font-size:${ids}` : undefined)} />
        <Select context={context} id="font-weight" label="fontWeight" value={String(read("fontWeight", 400))}
          options={WEIGHTS.map(weight => [weight, weight] as const)}
          write={value => apply(context, { fontWeight: value === "400" ? undefined : Number(value) })} />
        <TextInput context={context} id="line-height" label="lineHeight" value={read("lineHeight", "auto") === MIXED ? MIXED : String(read("lineHeight", "auto"))}
          write={value => {
            const parsed = value === "" || value === "auto" ? undefined : /^\d+(?:\.\d+)?%$/.test(value) ? value as `${number}%`
              : Number.isFinite(Number(value)) ? Number(value) : null;
            if (parsed !== null) apply(context, { lineHeight: parsed });
          }} />
        <NumberField label={t(context, "letterSpacing")} value={read("letterSpacing", 0) as number | string | typeof MIXED} testId="design-field-letter-spacing"
          mixedLabel={t(context, "mixed")} disabled={!context.editable} tokens={context.lengthTokens}
          onCommit={(value, step) => apply(context, { letterSpacing: value === 0 ? undefined : value as TextNode["letterSpacing"] }, step ? `letter-spacing:${ids}` : undefined)} />
        <Select context={context} id="text-align" label="textAlign" value={read("textAlign", "left") as string | typeof MIXED}
          options={[["left", "alignLeft"], ["center", "alignCenter"], ["right", "alignRight"], ["justify", "alignJustify"]]}
          write={value => apply(context, { textAlign: value === "left" ? undefined : value as TextNode["textAlign"] })} />
        <Select context={context} id="vertical-align" label="verticalAlign" value={read("verticalAlign", "top") as string | typeof MIXED}
          options={[["top", "alignTop"], ["middle", "alignMiddle"], ["bottom", "alignBottom"]]}
          write={value => apply(context, { verticalAlign: value === "top" ? undefined : value })} />
        <Select context={context} id="text-decoration" label="textDecoration" value={read("textDecoration", "none") as string | typeof MIXED}
          options={[["none", "decorationNone"], ["underline", "decorationUnderline"], ["line-through", "decorationStrike"]]}
          write={value => apply(context, { textDecoration: value === "none" ? undefined : value })} />
        <Select context={context} id="text-transform" label="textTransform" value={read("textTransform", "none") as string | typeof MIXED}
          options={[["none", "caseNone"], ["uppercase", "caseUpper"], ["lowercase", "caseLower"], ["capitalize", "caseTitle"]]}
          write={value => apply(context, { textTransform: value === "none" ? undefined : value })} />
        <Select context={context} id="auto-resize" label="autoResize" value={read("autoResize", "widthAndHeight") as string | typeof MIXED}
          options={[["widthAndHeight", "resizeWidth"], ["height", "resizeHeight"], ["none", "resizeFixed"]]}
          write={value => apply(context, { autoResize: value })} />
      </div>
    </section>;
  }
});
