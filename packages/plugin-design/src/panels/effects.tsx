import type { DesignNode, Shadow } from "../model/types.js";
import { designText } from "../i18n.js";
import { ColorField } from "./color-picker.js";
import { MIXED, NumberField } from "./fields/number-field.js";
import { registerSection, shared, type InspectorContext } from "./sections.js";

const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
const ids = (context: InspectorContext) => context.targets.map(target => `${target.board}/${target.node.id}`).sort().join(",");
const DEFAULT_SHADOW: Shadow = { x: 0, y: 4, blur: 8, spread: 0, color: "#00000040" };

registerSection({
  id: "effects", tab: "design",
  when: context => context.targets.length > 0,
  render: context => {
    const value = shared(context.targets, node => node.shadows ?? []);
    const write = (change: (shadows: Shadow[]) => Shadow[], mergeKey?: string) => context.update(target => {
      const next = change(structuredClone(target.node.shadows ?? []));
      return { shadows: next.length ? next : undefined };
    }, mergeKey);
    const blur = (key: "blur" | "backgroundBlur", label: keyof typeof designText) =>
      <NumberField label={t(context, label)} value={shared(context.targets, node => node[key] ?? 0)} min={0}
        testId={`design-field-${key === "blur" ? "layer-blur" : "background-blur"}`} mixedLabel={t(context, "mixed")}
        disabled={!context.editable} tokens={context.lengthTokens}
        onCommit={(next, step) => context.update(() => ({ [key]: next === 0 ? undefined : next } as Partial<DesignNode>),
          step ? `${key}:${ids(context)}` : undefined)} />;
    return <section className="design-inspector-section" aria-labelledby="design-section-effects">
      <div className="design-section-head">
        <h2 id="design-section-effects">{t(context, "sectionEffects")}</h2>
        {context.editable && <button type="button" data-testid="design-shadow-add" aria-label={t(context, "addShadow")}
          onClick={() => write(shadows => [...shadows, { ...DEFAULT_SHADOW }])}>＋</button>}
      </div>
      {value === MIXED ? <p className="design-inspector-empty">{t(context, "mixed")}</p> : <ol className="design-paint-list">
        {value.map((shadow, index) => {
          const row = `design-shadow-${index}`;
          const set = (patch: Partial<Shadow>, step = false) =>
            write(items => items.map((item, i) => i === index ? { ...item, ...patch } : item), step ? `shadow:${index}:${ids(context)}` : undefined);
          const length = (key: "x" | "y" | "blur" | "spread", label: keyof typeof designText) =>
            <NumberField label={t(context, label)} value={shadow[key] ?? 0} testId={`${row}-${key}`} mixedLabel={t(context, "mixed")}
              min={key === "blur" ? 0 : undefined} disabled={!context.editable} tokens={context.lengthTokens}
              onCommit={(next, step) => set({ [key]: next } as Partial<Shadow>, step)} />;
          return <li key={index} className="design-paint" data-testid={row}>
            <div className="design-paint-head">
              <select aria-label={t(context, "shadowKind")} data-testid={`${row}-kind`} value={shadow.inset ? "inner" : "drop"}
                disabled={!context.editable} onChange={event => set({ inset: event.target.value === "inner" ? true : undefined })}>
                <option value="drop">{t(context, "shadowDrop")}</option>
                <option value="inner">{t(context, "shadowInner")}</option>
              </select>
              {context.editable && <span className="design-paint-actions">
                <button type="button" aria-label={t(context, "paintRemove")} data-testid={`${row}-remove`}
                  onClick={() => write(items => items.filter((_, i) => i !== index))}>×</button>
              </span>}
            </div>
            <div className="design-field-grid">
              {length("x", "fieldX")}{length("y", "fieldY")}{length("blur", "shadowBlur")}{length("spread", "shadowSpread")}
              <ColorField label={t(context, "paintColor")} value={shadow.color} testId={`${row}-color`} disabled={!context.editable}
                tokens={context.colorTokens} resolve={context.resolveColor} onCommit={(color, step) => set({ color }, step)} />
            </div>
          </li>;
        })}
      </ol>}
      <div className="design-field-grid">
        {blur("blur", "layerBlur")}
        {blur("backgroundBlur", "backgroundBlur")}
      </div>
    </section>;
  }
});
