import { useEffect, useState } from "react";
import type { DesignNode } from "../model/types.js";
import { designText } from "../i18n.js";
import { MIXED, NumberField } from "./fields/number-field.js";
import { PaintListEditor } from "./paint.js";
import { registerSection, shared, type InspectorContext } from "./sections.js";

const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
const ids = (context: InspectorContext) => context.targets.map(target => `${target.board}/${target.node.id}`).sort().join(",");

/** Parse "4 2" or "4, 2" into a dash array; empty clears it. */
export function parseDash(text: string): number[] | undefined | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return undefined;
  const values = parts.map(Number);
  return values.every(value => Number.isFinite(value) && value >= 0) ? values : null;
}

function Choice<T extends string>({ context, id, label, value, options, write }: {
  context: InspectorContext; id: string; label: keyof typeof designText; value: T | typeof MIXED;
  options: readonly [T, keyof typeof designText][]; write: (value: T) => void;
}) {
  return <div className="design-field">
    <label htmlFor={`design-field-${id}`}>{t(context, label)}</label>
    <select id={`design-field-${id}`} data-testid={`design-field-${id}`} disabled={!context.editable}
      value={value === MIXED ? "" : value} onChange={event => { if (event.target.value) write(event.target.value as T); }}>
      {value === MIXED && <option value="">{t(context, "mixed")}</option>}
      {options.map(([option, text]) => <option key={option} value={option}>{t(context, text)}</option>)}
    </select>
  </div>;
}

function DashField({ context }: { context: InspectorContext }) {
  const value = shared(context.targets, node => node.strokeDash ?? []);
  const shown = value === MIXED ? "" : value.join(" ");
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const parsed = parseDash(text);
    if (parsed === null || text.trim() === shown) { setText(shown); return; }
    context.update(() => ({ strokeDash: parsed }));
  };
  return <div className="design-field">
    <label htmlFor="design-field-dash">{t(context, "strokeDash")}</label>
    <input id="design-field-dash" data-testid="design-field-dash" type="text" value={text} disabled={!context.editable}
      placeholder={value === MIXED ? t(context, "mixed") : t(context, "strokeDashHint")}
      onChange={event => setText(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") setText(shown); }} />
  </div>;
}

registerSection({
  id: "stroke", tab: "design",
  when: context => context.targets.length > 0,
  render: context => {
    const set = (patch: Partial<DesignNode>) => context.update(() => patch);
    const hasStrokes = context.targets.some(target => target.node.strokes?.length);
    return <section className="design-inspector-section" aria-labelledby="design-section-strokes">
      <PaintListEditor context={context} list="strokes" allowImage={false} fallback="#000000" />
      {hasStrokes && <div className="design-field-grid">
        <NumberField label={t(context, "strokeWidth")} value={shared(context.targets, node => node.strokeWidth ?? 1)} min={0}
          testId="design-field-stroke-width" mixedLabel={t(context, "mixed")} disabled={!context.editable} tokens={context.lengthTokens}
          onCommit={(value, step) => context.update(() => ({ strokeWidth: value as DesignNode["strokeWidth"] }), step ? `stroke-width:${ids(context)}` : undefined)} />
        <Choice context={context} id="stroke-align" label="strokeAlign" value={shared(context.targets, node => node.strokeAlign ?? "inside")}
          options={[["inside", "strokeInside"], ["center", "strokeCenter"], ["outside", "strokeOutside"]]}
          write={value => set({ strokeAlign: value === "inside" ? undefined : value })} />
        <DashField context={context} />
        <Choice context={context} id="stroke-cap" label="strokeCap" value={shared(context.targets, node => node.strokeCap ?? "butt")}
          options={[["butt", "capButt"], ["round", "capRound"], ["square", "capSquare"]]}
          write={value => set({ strokeCap: value === "butt" ? undefined : value })} />
        <Choice context={context} id="stroke-join" label="strokeJoin" value={shared(context.targets, node => node.strokeJoin ?? "miter")}
          options={[["miter", "joinMiter"], ["round", "joinRound"], ["bevel", "joinBevel"]]}
          write={value => set({ strokeJoin: value === "miter" ? undefined : value })} />
      </div>}
    </section>;
  }
});
