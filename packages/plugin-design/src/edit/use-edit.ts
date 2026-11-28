import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { PluginRenderContext } from "@vellym/plugin-api";
import type { CanvasRendererData } from "../render/board-view.js";
import type { DesignOperation } from "./operations.js";
import { DesignStore } from "./store.js";

declare global {
  interface Window {
    /** Explicit opt-in set by the browser test before loading the application. */
    __vellymDesignTest?: boolean;
    __vellymDesign?: { apply: (operation: DesignOperation) => boolean };
  }
}

export function useDesignEdit(data: CanvasRendererData, context: PluginRenderContext) {
  const noticeKey = `vellym-design-reloaded:${data.canvas?.name ?? ""}`;
  const [reloaded] = useState(() => {
    if (context.isStatic) return false;
    const value = sessionStorage.getItem(noticeKey);
    sessionStorage.removeItem(noticeKey);
    return value === "true";
  });
  const [store] = useState(() => new DesignStore(data, context, () => {
    sessionStorage.setItem(noticeKey, "true");
    window.location.reload();
  }));
  store.context = context;
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => { store.observe(data); }, [store, data]);
  useLayoutEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!store.editable || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) ||
          event.key.toLowerCase() !== "z") return;
      // Preserve native undo in form fields and the in-place text editor (including Shadow DOM).
      if (event.composedPath().some(target => target instanceof HTMLElement &&
          (target.matches("input, textarea, select") || target.isContentEditable))) return;
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    };
    window.addEventListener("keydown", keyboard);
    if (window.__vellymDesignTest && store.editable) window.__vellymDesign = { apply: op => store.apply(op) };
    return () => {
      window.removeEventListener("keydown", keyboard);
      delete window.__vellymDesign;
      store.dispose();
    };
  }, [store]);
  const withRoots = <T extends { name: string; spec: object }>(row: T): T => {
    const root = store.root(row.name), position = store.position(row.name), page = store.pageOf(row.name);
    if (!store.editable || (!root && !position && page === null)) return row;
    const spec: Record<string, unknown> = { ...row.spec, ...(root ? { root } : {}), ...(position && "x" in row.spec ? position : {}) };
    if (page !== null && "canvas" in row.spec) { if (page === undefined) delete spec.page; else spec.page = page; }
    return { ...row, spec } as T;
  };
  const pages = data.canvas && store.editable ? store.pages(data.canvas.name) : undefined;
  return {
    store, reloaded,
    data: { ...data, canvas: data.canvas && pages ? { ...data.canvas, spec: { ...data.canvas.spec, pages: pages.length ? pages : undefined } } : data.canvas,
      boards: data.boards.map(withRoots), components: data.components.map(withRoots) }
  };
}
