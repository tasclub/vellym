import type { AlignMode } from "../edit/align.js";
import { designText } from "../i18n.js";
import { registerSection, type InspectorContext } from "./sections.js";

const t = (context: InspectorContext, key: keyof typeof designText) => designText[key][context.locale];
const ALIGN: readonly [AlignMode, keyof typeof designText, string][] = [
  ["left", "alignToLeft", "⇤"], ["centerX", "alignToCenterX", "↔"], ["right", "alignToRight", "⇥"],
  ["top", "alignToTop", "⤒"], ["centerY", "alignToCenterY", "↕"], ["bottom", "alignToBottom", "⤓"]
];

registerSection({
  id: "align", tab: "design",
  when: context => !!context.arrange && context.editable,
  render: context => <section className="design-inspector-section" aria-labelledby="design-section-align">
    <h2 id="design-section-align">{t(context, "sectionAlign")}</h2>
    <div className="design-align" role="group" aria-label={t(context, "sectionAlign")}>
      {ALIGN.map(([mode, label, glyph]) => <button key={mode} type="button" data-testid={`design-align-${mode}`}
        aria-label={t(context, label)} title={t(context, label)} onClick={() => context.arrange!.align(mode)}>{glyph}</button>)}
      <button type="button" data-testid="design-distribute-x" aria-label={t(context, "distributeX")} title={t(context, "distributeX")}
        disabled={!context.arrange?.canDistribute} onClick={() => context.arrange!.distribute("x")}>⋯</button>
      <button type="button" data-testid="design-distribute-y" aria-label={t(context, "distributeY")} title={t(context, "distributeY")}
        disabled={!context.arrange?.canDistribute} onClick={() => context.arrange!.distribute("y")}>⋮</button>
    </div>
  </section>
}, { before: "position" });
