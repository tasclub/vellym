import { useState, type KeyboardEvent } from "react";
import { designText } from "../i18n.js";
import { InspectorLocale } from "./fields/locale.js";
import { inspectorSections, type InspectorContext, type InspectorTab } from "./sections.js";
// Built-in sections register themselves on import, in this order.
import "./text.js";
import "./paint.js";
import "./stroke.js";
import "./effects.js";

const TABS: readonly [InspectorTab, keyof typeof designText][] = [["design", "tabDesign"], ["prototype", "tabPrototype"], ["code", "tabCode"]];

/** The right panel: tabs, then every registered section that applies to the selection. */
export function Inspector({ context }: { context: InspectorContext }) {
  const [tab, setTab] = useState<InspectorTab>("design");
  const t = (key: keyof typeof designText) => designText[key][context.locale];
  const sections = inspectorSections.filter(section => section.tab === tab && section.when(context));
  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next]![0]);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return <InspectorLocale.Provider value={context.locale}>
    <aside className="design-inspector" aria-label={t("inspector")} data-testid="design-inspector">
      <div role="tablist" aria-label={t("inspector")} className="design-inspector-tabs">
        {TABS.map(([id, label], index) => <button key={id} type="button" role="tab" id={`design-tab-${id}`}
          aria-selected={tab === id} aria-controls="design-inspector-panel" tabIndex={tab === id ? 0 : -1}
          data-testid={`design-tab-${id}`} onClick={() => setTab(id)} onKeyDown={event => keys(event, index)}>{t(label)}</button>)}
      </div>
      <div id="design-inspector-panel" role="tabpanel" aria-labelledby={`design-tab-${tab}`}>
        {context.targets.length > 0 && <p className="design-inspector-summary" data-testid="design-inspector-summary">
          {context.targets.length === 1 ? context.targets[0]!.node.name ?? context.targets[0]!.node.id
            : t("selectedCount").replace("{count}", String(context.targets.length))}</p>}
        {sections.length ? sections.map(section => <div key={section.id}>{section.render(context)}</div>)
          : <p className="design-inspector-empty">{t("noSectionsYet")}</p>}
      </div>
    </aside>
  </InspectorLocale.Provider>;
}
