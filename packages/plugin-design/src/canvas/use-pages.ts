import type { DesignChange, DesignPage } from "../edit/operations.js";
import type { CanvasModel } from "./model.js";

/**
 * Page operations on the canvas's `spec.pages`, one undo step each. A board without `page` is on
 * the first page, so before the order or the first page changes, such boards get an explicit
 * `page` in the same operation (they stay where they were).
 */
export function usePages(m: CanvasModel, setPage: (id: string) => void) {
  const { store, data, t } = m;
  const canvas = data.canvas;
  const pages = (canvas?.spec.pages ?? []) as DesignPage[];
  const pageOf = (name: string, spec: { page?: string }) => { const value = store.pageOf(name); return value === null ? spec.page : value; };
  const resolved = (name: string, spec: { page?: string }) => pageOf(name, spec) ?? pages[0]?.id;
  const boardCount = (id: string) => data.boards.filter(board => resolved(board.name, board.spec) === id).length;
  const pin = (except: ReadonlySet<string> = new Set()): DesignChange[] => pages.length ? data.boards
    .filter(board => !except.has(board.name) && pageOf(board.name, board.spec) === undefined)
    .map(board => ({ targetName: board.name, field: "page" as const, before: undefined, after: pages[0]!.id })) : [];
  const apply = (after: DesignPage[], extra: DesignChange[] = []) => !!canvas &&
    store.apply({ changes: [{ targetName: canvas.name, field: "pages", before: store.pages(canvas.name) ?? pages, after }, ...extra] });

  const add = () => {
    const taken = new Set(pages.map(page => page.id));
    let n = pages.length + 1;
    while (taken.has(`page-${n}`)) n++;
    const page = { id: `page-${n}`, title: t("pageName").replace("{number}", String(pages.length + 1)) };
    if (apply([...pages, page])) setPage(page.id);
  };
  const rename = (id: string, title: string) => apply(pages.map(page => page.id === id ? { ...page, title } : page));
  /** Move to list position `to` (0 = top), counted before the move. */
  const move = (id: string, to: number) => {
    const from = pages.findIndex(page => page.id === id);
    if (from < 0) return;
    const next = pages.filter(page => page.id !== id);
    next.splice(from < to ? to - 1 : to, 0, pages[from]!);
    if (next.every((page, i) => page.id === pages[i]!.id)) return;
    apply(next, pin());
  };
  const remove = async (id: string) => {
    if (pages.length <= 1 || !canvas) return;
    const doomed = data.boards.filter(board => resolved(board.name, board.spec) === id);
    for (const board of doomed) {
      if (!board.hash || !m.context.deleteResource) continue;
      store.forget(board.name);
      const result = await m.context.deleteResource(board.name, { baseHash: board.hash });
      if (!result.ok) { m.setStatus(result.message); return; }
    }
    const next = pages.filter(page => page.id !== id);
    if (apply(next, pin(new Set(doomed.map(board => board.name)))) && m.active === id) setPage(next[0]!.id);
  };
  return { pages, boardCount, add, rename, move, remove };
}
