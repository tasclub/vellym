import { useRef, type PointerEvent } from "react";
import { selectable, type Selection } from "../edit/selection.js";
import { enclosing, measureNode } from "./overlay.js";
import type { Bounds } from "./viewport.js";
import type { BoardRow, CanvasModel, Hit } from "./model.js";

interface SelectGesture {
  pointer: number; x: number; y: number; start: { x: number; y: number };
  hit?: Hit; moved: boolean; shift: boolean; deep: boolean; moveItems?: Selection[];
}

/**
 * Clicks, marquee and hover on the canvas. A press on a node selects it at once so the same
 * drag can move it: `onMove` hands that drag to the transform.
 */
export function useSelection(m: CanvasModel, onMove: (event: PointerEvent<HTMLDivElement>, items: Selection[], start: { x: number; y: number }) => void) {
  const gesture = useRef<SelectGesture | undefined>(undefined);
  const { selected, geometry, store } = m;

  const press = (event: PointerEvent<HTMLElement>, start: { x: number; y: number }) => {
    const hit = m.hitAt(event.clientX, event.clientY), deep = event.ctrlKey || event.metaKey;
    let moveItems: Selection[] | undefined;
    const item = hit && store.editable ? m.choose(hit, deep ? "deep" : "normal") : undefined;
    if (item && m.isSelected(item)) moveItems = selected;
    else if (item && !event.shiftKey) { moveItems = [item]; m.setSelected([item]); }
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
      start, hit, shift: event.shiftKey, deep, moved: false, moveItems };
    m.setHover(undefined);
  };
  /** Pressing a board's label selects the board; dragging it moves the board. */
  const pressLabel = (event: PointerEvent<HTMLElement>, board: BoardRow) => {
    const index = geometry.find(item => item.name === board.name)!.index;
    if (!selectable(index, board.spec.root.id)) return false;
    const item = { board: board.name, id: board.spec.root.id };
    const items = m.isSelected(item) ? selected : [item];
    if (!m.isSelected(item)) m.setSelected([item]);
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
      start: m.worldPoint(event.clientX, event.clientY), hit: { board: board.name, chain: [board.spec.root.id] },
      shift: false, deep: false, moved: false, moveItems: items };
    return true;
  };
  /** True when this pointer belongs to a selection gesture (handled here). */
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag) return false;
    if (drag.pointer !== event.pointerId) return true;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 3) drag.moved = true;
    if (drag.moved && drag.hit && drag.moveItems?.length) {
      gesture.current = undefined;
      onMove(event, drag.moveItems, drag.start);
      return true;
    }
    if (drag.moved && !drag.hit) {
      const end = m.worldPoint(event.clientX, event.clientY);
      m.setMarquee({ x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y),
        width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) });
    }
    return true;
  };
  const hover = (event: PointerEvent<HTMLDivElement>) => {
    const hit = m.hitAt(event.clientX, event.clientY), item = hit && m.choose(hit, "normal");
    m.setHover(item && !m.isSelected(item) ? item : undefined);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    gesture.current = undefined;
    m.setMarquee(undefined);
    if (drag.moved) {
      if (drag.hit) return;
      const end = m.worldPoint(event.clientX, event.clientY);
      const area = { x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y),
        width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) };
      const overlaps = (box: Bounds) => box.x <= area.x + area.width && box.x + box.width >= area.x &&
        box.y <= area.y + area.height && box.y + box.height >= area.y;
      const contains = (box: Bounds) => box.x >= area.x && box.y >= area.y &&
        box.x + box.width <= area.x + area.width && box.y + box.height <= area.y + area.height;
      const items = geometry.flatMap(board => {
        const root = [...board.index.values()].find(item => item.depth === 0)!;
        const box = measureNode(m.world.current!, board, root.node.id);
        const ids = box && contains(enclosing(box)) ? [root.node.id] :
          [...board.index.values()].filter(item => item.depth === 1).filter(item => {
            const box = measureNode(m.world.current!, board, item.node.id);
            return box && overlaps(enclosing(box));
          }).map(item => item.node.id);
        return ids.filter(id => selectable(board.index, id)).map(id => ({ board: board.name, id }));
      });
      m.merge(items, drag.shift);
    } else if (drag.hit) {
      const item = m.choose(drag.hit, drag.deep ? "deep" : "normal");
      if (item) {
        if (drag.shift && m.isSelected(item)) m.setSelected(selected.filter(other => other.board !== item.board || other.id !== item.id));
        else m.merge([item], drag.shift);
      }
    } else if (!drag.shift) m.setSelected([]);
  };
  const cancel = () => { gesture.current = undefined; m.setMarquee(undefined); };

  return { gesture, press, pressLabel, move, hover, release, cancel };
}
