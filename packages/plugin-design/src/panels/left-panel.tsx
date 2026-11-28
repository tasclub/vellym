import { useState, type KeyboardEvent, type ReactNode } from "react";
import { designText } from "../i18n.js";

type Tab = "pages" | "layers" | "components";
const TABS: readonly [Tab, keyof typeof designText][] = [["pages", "pages"], ["layers", "layers"], ["components", "components"]];

/** The left panel: pages, layers and (later) components, as tabs. */
export function LeftPanel({ locale, pages, layers, components, initial }: {
  locale: "ja" | "en"; pages: ReactNode; layers: ReactNode; components?: ReactNode; initial: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initial);
  const t = (key: keyof typeof designText) => designText[key][locale];
  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next]![0]);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return <aside className="design-left-panel" aria-label={t("leftPanel")} data-testid="design-left-panel">
    <div role="tablist" aria-label={t("leftPanel")} className="design-inspector-tabs">
      {TABS.map(([id, label], index) => <button key={id} type="button" role="tab" id={`design-left-tab-${id}`}
        aria-selected={tab === id} aria-controls="design-left-panel-body" tabIndex={tab === id ? 0 : -1}
        data-testid={`design-left-tab-${id}`} onClick={() => setTab(id)} onKeyDown={event => keys(event, index)}>{t(label)}</button>)}
    </div>
    <div id="design-left-panel-body" role="tabpanel" aria-labelledby={`design-left-tab-${tab}`} className="design-left-panel-body">
      {tab === "pages" ? pages : tab === "layers" ? layers
        : components ?? <p className="design-inspector-empty">{t("noComponentsYet")}</p>}
    </div>
  </aside>;
}
