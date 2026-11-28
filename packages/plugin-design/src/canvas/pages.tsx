import type { DesignCanvasSpec } from "../model/types.js";
import { designText } from "../i18n.js";

export function Pages({ pages, active, onChange, locale }: {
  pages: NonNullable<DesignCanvasSpec["pages"]>; active: string; onChange: (id: string) => void; locale: "ja" | "en";
}) {
  return <aside style={{ width: 160, flexShrink: 0, padding: 8, borderRight: "1px solid #cbd5e1", overflow: "auto" }}>
    <h2 id="design-pages-heading">{designText.pages[locale]}</h2>
    <div role="tablist" aria-labelledby="design-pages-heading" aria-orientation="vertical" data-testid="design-pages">
      {pages.map((page, index) => <button key={page.id} type="button" role="tab"
        id={`design-page-${index}`} aria-controls="design-page-panel" aria-selected={active === page.id}
        tabIndex={active === page.id ? 0 : -1} data-testid={`design-page-${page.id}`}
        style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
        onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1
            : event.key === "ArrowDown" ? (index + 1) % pages.length
            : event.key === "ArrowUp" ? (index + pages.length - 1) % pages.length : -1;
          if (next < 0) return;
          event.preventDefault();
          onChange(pages[next]!.id);
          (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
        }} onClick={() => onChange(page.id)}>{page.title ?? page.id}</button>)}
    </div>
  </aside>;
}
