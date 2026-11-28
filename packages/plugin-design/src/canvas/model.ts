import type { Dispatch, RefObject, SetStateAction } from "react";
import type { PluginRenderContext } from "@vellym/plugin-api";
import type { CanvasRendererData, DesignRow } from "../render/board-view.js";
import type { DesignBoardSpec, DesignNode } from "../model/types.js";
import type { DesignStore } from "../edit/store.js";
import { pickAt, selectable, type Selection } from "../edit/selection.js";
import { designText } from "../i18n.js";
import { boardElement, type BoardGeometry } from "./overlay.js";
import type { Bounds } from "./viewport.js";

export type BoardRow = DesignRow<DesignBoardSpec>;
export interface Hit { board: string; chain: string[] }

/**
 * What every part of the canvas screen shares: the model, the boards on the page, the
 * selection, and the canvas's coordinates. Built once per render by the screen.
 */
export interface CanvasModel {
  context: PluginRenderContext;
  store: DesignStore;
  data: CanvasRendererData;
  locale: "ja" | "en";
  t(key: keyof typeof designText): string;
  /** The current page id ("" without pages). */
  active: string;
  /** The page's boards as loaded (with the store's roots), and as drawn (with drag previews). */
  saved: BoardRow[];
  boards: BoardRow[];
  geometry: BoardGeometry[];
  selected: Selection[];
  setSelected: Dispatch<SetStateAction<Selection[]>>;
  setHover: Dispatch<SetStateAction<Selection | undefined>>;
  setMarquee: Dispatch<SetStateAction<Bounds | undefined>>;
  setStatus: Dispatch<SetStateAction<string>>;
  world: RefObject<HTMLDivElement | null>;
  viewport: RefObject<HTMLDivElement | null>;
  isSelected(item: Selection): boolean;
  worldPoint(x: number, y: number): { x: number; y: number };
  hitAt(x: number, y: number): Hit | undefined;
  choose(hit: Hit, mode: "normal" | "deep" | "enter"): Selection | undefined;
  merge(items: Selection[], add: boolean): void;
  /** The root as loaded for this render. */
  savedRoot(name: string): DesignNode | undefined;
  /** The store's root now (falls back to the loaded one): read this when committing later. */
  currentRoot(name: string): DesignNode | undefined;
}

export function byBoard(items: readonly Selection[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) groups.set(item.board, [...groups.get(item.board) ?? [], item.id]);
  return groups;
}

/** Keys and pointers in inputs, buttons, links and text being edited are not canvas commands. */
export function editableTarget(event: { nativeEvent: Event }): boolean {
  return event.nativeEvent.composedPath().some(target =>
    target instanceof HTMLElement && (target.matches("input, textarea, select, button, a") || target.isContentEditable));
}

export function createModel(parts: Omit<CanvasModel, "isSelected" | "worldPoint" | "hitAt" | "choose" | "merge" | "savedRoot" | "currentRoot" | "t">): CanvasModel {
  const { selected, geometry, saved, store, world, setSelected, locale } = parts;
  const model: CanvasModel = {
    ...parts,
    t: key => designText[key][locale],
    isSelected: item => selected.some(other => other.board === item.board && other.id === item.id),
    worldPoint(x, y) {
      const element = world.current!;
      const rect = element.getBoundingClientRect();
      const scale = Number(element.style.getPropertyValue("--design-scale")) || 1;
      return { x: (x - rect.x) / scale, y: (y - rect.y) / scale };
    },
    hitAt(x, y) {
      const element = world.current;
      if (!element) return;
      for (const board of [...geometry].reverse()) {
        const host = boardElement(element, board.name);
        for (const hit of host?.shadowRoot?.elementsFromPoint(x, y) ?? []) {
          const chain: string[] = [];
          for (let node: Element | null = hit; node; node = node.parentElement) {
            const id = node.getAttribute("data-node-id");
            if (id && board.index.has(id)) chain.push(id);
          }
          if (chain.length && chain.every(id => selectable(board.index, id))) return { board: board.name, chain };
        }
      }
    },
    choose(hit, mode) {
      const index = geometry.find(board => board.name === hit.board)!.index;
      const id = pickAt(index, hit.chain, selected.filter(item => item.board === hit.board).map(item => item.id), mode);
      return id ? { board: hit.board, id } : undefined;
    },
    merge: (items, add) => setSelected(previous => add
      ? [...previous, ...items.filter(item => !previous.some(other => item.board === other.board && item.id === other.id))]
      : items),
    savedRoot: name => saved.find(board => board.name === name)?.spec.root,
    currentRoot: name => store.root(name) ?? saved.find(board => board.name === name)?.spec.root
  };
  return model;
}
