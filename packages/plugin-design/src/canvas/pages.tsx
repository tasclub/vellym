import { useEffect, useRef, useState } from "react";
import type { DesignPage } from "../edit/operations.js";
import { designText } from "../i18n.js";

/**
 * The page list. Editable: add, rename (double-click or F2), reorder (Alt+↑↓ or drag) and
 * delete (asks first when the page has boards; the last page stays).
 */
export function Pages({ pages, active, onChange, locale, editable = false, onAdd, onRename, onMove, onDelete, boardCount }: {
  pages: readonly DesignPage[]; active: string; onChange: (id: string) => void; locale: "ja" | "en";
  editable?: boolean; onAdd?(): void; onRename?(id: string, title: string): void; onMove?(id: string, to: number): void;
  onDelete?(id: string): void; boardCount?(id: string): number;
}) {
  const t = (key: keyof typeof designText) => designText[key][locale];
  const [renaming, setRenaming] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const list = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirm) cancel.current?.focus(); }, [confirm]);
  const pending = useRef(0);
  const focusTab = (id: string) => {
    cancelAnimationFrame(pending.current);
    const was = document.activeElement;
    pending.current = requestAnimationFrame(() => {
      // A late frame must not take the focus from wherever it went meanwhile (another tab's name field).
      const current = document.activeElement;
      if (current !== was && current !== document.body && current !== null) return;
      list.current?.querySelector<HTMLElement>(`[data-testid="design-page-${CSS.escape(id)}"]`)?.focus();
    });
  };
  const startRename = (id: string) => { cancelAnimationFrame(pending.current); setRenaming(id); };
  const activePage = pages.find(page => page.id === active);
  const remove = (id: string) => {
    if ((boardCount?.(id) ?? 0) > 0) setConfirm(id);
    else onDelete?.(id);
  };
  return <div className="design-pages">
    <div className="design-section-head">
      <h2 id="design-pages-heading">{t("pages")}</h2>
      {editable && onAdd && <button type="button" data-testid="design-page-add" aria-label={t("addPage")} onClick={onAdd}>＋</button>}
    </div>
    {pages.length ? <div ref={list} role="tablist" aria-labelledby="design-pages-heading" aria-orientation="vertical" data-testid="design-pages">
      {pages.map((page, index) => renaming === page.id
        ? <input key={page.id} className="design-layer-name-input" data-testid="design-page-rename" autoFocus defaultValue={page.title ?? ""}
          aria-label={t("pageRename")} placeholder={page.id}
          onKeyDown={event => {
            if (event.key === "Escape") { setRenaming(undefined); focusTab(page.id); }
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={event => {
            const title = event.currentTarget.value.trim();
            setRenaming(undefined);
            if (title && title !== page.title) onRename?.(page.id, title);
            focusTab(page.id);
          }} />
        : <button key={page.id} type="button" role="tab"
          id={`design-page-${index}`} aria-controls="design-page-panel" aria-selected={active === page.id}
          tabIndex={active === page.id ? 0 : -1} data-testid={`design-page-${page.id}`} className="design-page-tab"
          draggable={editable} data-drop={dragging && dragging !== page.id ? "true" : undefined}
          onDragStart={event => { setDragging(page.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", page.id); }}
          onDragEnd={() => setDragging(undefined)}
          onDragOver={event => { if (dragging && dragging !== page.id) event.preventDefault(); }}
          onDrop={event => {
            event.preventDefault();
            const from = dragging;
            setDragging(undefined);
            if (!from || from === page.id) return;
            const box = event.currentTarget.getBoundingClientRect();
            const after = event.clientY > box.top + box.height / 2;
            onMove?.(from, index + (after ? 1 : 0));
          }}
          onDoubleClick={() => { if (editable && onRename) startRename(page.id); }}
          onKeyDown={event => {
            if (editable && event.key === "F2" && onRename) { event.preventDefault(); startRename(page.id); return; }
            if (editable && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && onMove) {
              event.preventDefault();
              const to = event.key === "ArrowUp" ? index - 1 : index + 2;
              if (to >= 0 && to <= pages.length) { onMove(page.id, to); focusTab(page.id); }
              return;
            }
            const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1
              : event.key === "ArrowDown" ? (index + 1) % pages.length
              : event.key === "ArrowUp" ? (index + pages.length - 1) % pages.length : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(pages[next]!.id);
            (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
          }} onClick={() => onChange(page.id)}>{page.title ?? page.id}</button>)}
    </div> : <p className="design-inspector-empty">{t("noPages")}</p>}
    {editable && onDelete && activePage && pages.length > 1 && <button type="button" className="design-inline-button design-page-delete"
      data-testid="design-page-delete" onClick={() => remove(activePage.id)}>
      {t("deletePage").replace("{name}", activePage.title ?? activePage.id)}</button>}
    {confirm && <div className="design-confirm design-page-confirm" role="alertdialog" aria-modal="false" aria-labelledby="design-page-confirm-text"
      data-testid="design-page-confirm" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setConfirm(undefined); } }}>
      <p id="design-page-confirm-text">{t("deletePageConfirm")
        .replace("{name}", pages.find(page => page.id === confirm)?.title ?? confirm).replace("{count}", String(boardCount?.(confirm) ?? 0))}</p>
      <div>
        <button ref={cancel} type="button" data-testid="design-page-confirm-cancel" onClick={() => setConfirm(undefined)}>{t("cancel")}</button>
        <button type="button" data-testid="design-page-confirm-ok" onClick={() => { const id = confirm; setConfirm(undefined); onDelete?.(id); }}>{t("deleteConfirm")}</button>
      </div>
    </div>}
  </div>;
}
