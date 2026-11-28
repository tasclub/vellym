import { useRef, useState } from "react";
import type { DesignNode } from "../model/types.js";
import type { BoardPosition, DesignChange } from "../edit/operations.js";
import { indexBoard, type Selection } from "../edit/selection.js";
import { duplicate } from "../edit/clipboard.js";
import { angleOf, HANDLES, moveNodes, movable, resizable, resizeNodes, rotate, rotateNodes, updateNodes,
  type Handle, type WorldBox } from "../edit/transform.js";
import { isGradient, positionAt, type Gradient } from "../panels/gradient-axis.js";
import type { PaintList } from "../panels/sections.js";
import { enclosing, measureNode } from "./overlay.js";
import { gridLines, handleEdges, snapBox, type Gap, type Guide, type SnapTargets } from "../edit/snap.js";
import { resizeBox } from "../edit/transform.js";
import type { Bounds } from "./viewport.js";
import { byBoard, type CanvasModel } from "./model.js";

/** A drag of the selection: the model changes only on release (one undo step). */
export interface TransformGesture {
  pointer: number; kind: "move" | "resize" | "rotate" | "gradient"; handle?: Handle;
  /** For a gradient stop drag: which paint and stop, and the node's measured box. */
  stop?: { board: string; id: string; list: PaintList; paint: number; index: number; box: WorldBox };
  start: { x: number; y: number }; roots: Map<string, DesignNode>; ids: Map<string, string[]>;
  boxes: Map<string, Map<string, WorldBox>>; frame?: WorldBox; angle: number;
  rotations: Map<string, Map<string, number>>; next?: Map<string, DesignNode>;
  /** Boards whose root is selected move as a whole (their `spec.x`/`y`). */
  positions: Map<string, BoardPosition>; nextPositions?: Map<string, BoardPosition>;
  /** Alt+drag: the roots before the copies were made (what one undo returns to). */
  origins?: Map<string, DesignNode>; restore?: Selection[];
  /** What a move or a one-node resize snaps to, and the moving box at the start (world units). */
  snap?: { targets: SnapTargets; box: Bounds; world: WorldBox };
}

/** What a drag draws before it commits: replaced roots and board positions. */
export function usePreviews() {
  const [preview, setPreview] = useState<ReadonlyMap<string, DesignNode>>();
  const [previewPositions, setPreviewPositions] = useState<ReadonlyMap<string, BoardPosition>>();
  const [marks, setMarks] = useState<{ guides: Guide[]; gaps: Gap[] }>();
  return { preview, setPreview, previewPositions, setPreviewPositions, marks, setMarks };
}
export type Previews = ReturnType<typeof usePreviews>;

const boxOf = (box: { x: number; y: number; width: number; height: number; rotation: number }): WorldBox =>
  ({ cx: box.x + box.width / 2, cy: box.y + box.height / 2, width: box.width, height: box.height, rotation: box.rotation });

export function useTransform(m: CanvasModel, previews: Previews) {
  const transform = useRef<TransformGesture | undefined>(undefined);
  const { store, geometry, saved, selected } = m;
  const handles: readonly Handle[] = !store.editable || !selected.length ? []
    : [...byBoard(selected)].some(([name, ids]) => {
        const board = geometry.find(item => item.name === name);
        return board && movable(board.index, ids).length;
      }) ? HANDLES
    : selected.length === 1 && geometry.some(board => board.name === selected[0]!.board &&
        resizable(board.index, [selected[0]!.id]).length) ? ["e", "s", "se"] : [];
  const rotatable = handles.length === HANDLES.length;

  const begin = (pointer: number, kind: TransformGesture["kind"], items: readonly Selection[],
    start: { x: number; y: number }, handle?: Handle) => {
    const world = m.world.current;
    if (!world || !store.editable) return;
    const ids = byBoard(items), roots = new Map<string, DesignNode>();
    const boxes = new Map<string, Map<string, WorldBox>>(), rotations = new Map<string, Map<string, number>>();
    const all: WorldBox[] = [];
    for (const [name, list] of ids) {
      const board = geometry.find(item => item.name === name), root = m.savedRoot(name);
      if (!board || !root) continue;
      roots.set(name, root);
      const measured = new Map<string, WorldBox>(), angles = new Map<string, number>();
      for (const id of list) {
        const box = measureNode(world, board, id);
        if (box) {
          const value = boxOf(box);
          measured.set(id, value);
          all.push(value);
        }
        angles.set(id, board.index.get(id)?.node.rotation ?? 0);
      }
      boxes.set(name, measured);
      rotations.set(name, angles);
    }
    if (!all.length) return;
    const outer = all.map(box => enclosing({ x: box.cx - box.width / 2, y: box.cy - box.height / 2,
      width: box.width, height: box.height, rotation: box.rotation }));
    const left = Math.min(...outer.map(box => box.x)), top = Math.min(...outer.map(box => box.y));
    const right = Math.max(...outer.map(box => box.x + box.width)), bottom = Math.max(...outer.map(box => box.y + box.height));
    const frame = all.length > 1 ? { cx: (left + right) / 2, cy: (top + bottom) / 2, width: right - left, height: bottom - top, rotation: 0 } : undefined;
    const centre = frame ?? all[0]!;
    const positions = new Map<string, BoardPosition>();
    if (kind === "move") for (const [name, list] of ids) {
      const board = saved.find(row => row.name === name);
      if (board && list.includes(board.spec.root.id)) positions.set(name, store.position(name) ?? { x: board.spec.x, y: board.spec.y });
    }
    transform.current = { pointer, kind, handle, start, roots, ids, boxes, frame, rotations, positions,
      angle: angleOf(centre.cx, centre.cy, start.x, start.y),
      snap: kind === "move" || (kind === "resize" && all.length === 1 && Math.abs(all[0]!.rotation) < 0.01)
        ? snapTargets(ids, positions, frame ? { x: left, y: top, width: right - left, height: bottom - top } : enclosing({
          x: all[0]!.cx - all[0]!.width / 2, y: all[0]!.cy - all[0]!.height / 2, width: all[0]!.width, height: all[0]!.height, rotation: all[0]!.rotation }), centre)
        : undefined };
    m.setHover(undefined);
  };

  /**
   * Snap targets: the moving nodes' siblings and parents (and the parents' layout grids); for
   * whole boards, the other boards. Only what is on the page now (measured once per drag).
   */
  const snapTargets = (ids: Map<string, string[]>, positions: Map<string, BoardPosition>, box: Bounds, world: WorldBox) => {
    const element = m.world.current!, boxes: Bounds[] = [], lines = { x: [] as number[], y: [] as number[] };
    for (const [name, list] of ids) {
      const board = geometry.find(item => item.name === name);
      if (!board) continue;
      const moving = new Set(list);
      for (const id of list) {
        const parentId = board.index.get(id)?.parentId;
        if (parentId === undefined) continue;
        const parent = board.index.get(parentId)!.node;
        const parentBox = measureNode(element, board, parentId);
        if (parentBox) {
          boxes.push(enclosing(parentBox));
          if (parent.type === "frame" && Math.abs(parentBox.rotation) < 0.01) {
            const grid = gridLines(parentBox, parent.layoutGrids);
            lines.x.push(...grid.x); lines.y.push(...grid.y);
          }
        }
        for (const child of "children" in parent && Array.isArray(parent.children) ? parent.children as DesignNode[] : []) {
          if (moving.has(child.id) || child.visible === false) continue;
          const sibling = measureNode(element, board, child.id);
          if (sibling) boxes.push(enclosing(sibling));
        }
      }
    }
    if (positions.size) for (const board of geometry) {
      if (positions.has(board.name)) continue;
      const root = [...board.index.values()].find(item => item.depth === 0)!;
      const other = measureNode(element, board, root.node.id);
      if (other) boxes.push(enclosing(other));
    }
    return { targets: { boxes, lines }, box, world };
  };
  const snapThreshold = () => 4 / (Number(m.world.current?.style.getPropertyValue("--design-scale")) || 1);

  /** A gradient stop handle on the canvas (one selected node). */
  const beginStop = (pointer: number, start: { x: number; y: number }, active: { list: PaintList; paint: number }, index: number) => {
    const item = selected[0], board = item && geometry.find(row => row.name === item.board), world = m.world.current;
    const box = board && world ? measureNode(world, board, item.id) : undefined;
    const root = item && m.savedRoot(item.board);
    if (!item || !box || !root) return;
    transform.current = { pointer, kind: "gradient", start, roots: new Map([[item.board, root]]),
      ids: new Map([[item.board, [item.id]]]), boxes: new Map(), rotations: new Map(), positions: new Map(), angle: 0,
      stop: { board: item.board, id: item.id, ...active, index, box: boxOf(box) } };
  };

  /** Alt+drag: swap the moving nodes for copies made where the originals are. */
  const copyOnDrag = (restore: Selection[]) => {
    const started = transform.current;
    if (!started) return;
    const copies: Selection[] = [];
    started.origins = new Map(started.roots);
    for (const [name, root] of started.roots) {
      const made = duplicate(root, started.ids.get(name) ?? [], 0, 0);
      started.roots.set(name, made.root);
      started.ids.set(name, made.ids);
      copies.push(...made.ids.map(id => ({ board: name, id })));
    }
    started.positions.clear();
    started.restore = restore;
    m.setSelected(copies);
  };

  const update = (event: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const drag = transform.current;
    if (!drag) return;
    const point = m.worldPoint(event.clientX, event.clientY);
    let dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    // Snap unless Ctrl/Cmd is held: the moved box (or the dragged edges of a resized one).
    const snapping = drag.snap && !event.ctrlKey && !event.metaKey;
    if (drag.snap && snapping && drag.kind === "move") {
      const result = snapBox({ ...drag.snap.box, x: drag.snap.box.x + dx, y: drag.snap.box.y + dy }, drag.snap.targets, snapThreshold());
      dx += result.dx; dy += result.dy;
      previews.setMarks({ guides: result.guides, gaps: result.gaps });
    } else if (drag.snap && snapping && drag.kind === "resize" && !event.altKey && !event.shiftKey) {
      const sized = resizeBox(drag.snap.world, drag.handle!, dx, dy, { keepRatio: false, fromCenter: false });
      const box = { x: sized.cx - sized.width / 2, y: sized.cy - sized.height / 2, width: sized.width, height: sized.height };
      const result = snapBox(box, drag.snap.targets, snapThreshold(), handleEdges(box, drag.handle!));
      dx += result.dx; dy += result.dy;
      previews.setMarks({ guides: result.guides, gaps: [] });
    } else previews.setMarks(undefined);
    const next = new Map<string, DesignNode>();
    if (drag.kind === "gradient" && drag.stop) {
      const { board, id, list, paint, index, box } = drag.stop, root = drag.roots.get(board)!;
      const node = geometry.find(item => item.name === board)?.index.get(id)?.node;
      const paints = node && (indexBoard(root).get(id)?.node[list] ?? []);
      const target = paints?.[paint];
      if (!paints || !isGradient(target)) return;
      const local = rotate(point.x - box.cx, point.y - box.cy, -box.rotation);
      const position = positionAt(target, box.width, box.height, local);
      if (position === undefined) return;
      const updated = paints.map((item, i) => i === paint ? { ...item, stops: (item as Gradient).stops.map((stop, n) => n === index ? { ...stop, position } : stop) } : item);
      next.set(board, updateNodes(root, new Map([[id, { [list]: updated } as Partial<DesignNode>]])));
      drag.next = next;
      previews.setPreview(next);
      return;
    }
    const centre = drag.frame ?? [...drag.boxes.values()].flatMap(map => [...map.values()])[0]!;
    const delta = angleOf(centre.cx, centre.cy, point.x, point.y) - drag.angle;
    if (drag.kind === "move" && drag.positions.size) {
      const moved = new Map([...drag.positions].map(([name, position]) =>
        [name, { x: Math.round((position.x + dx) * 100) / 100, y: Math.round((position.y + dy) * 100) / 100 }] as const));
      drag.nextPositions = moved;
      previews.setPreviewPositions(moved);
    }
    for (const [name, root] of drag.roots) {
      const ids = drag.ids.get(name) ?? [];
      const after = drag.kind === "move" ? moveNodes(root, ids, dx, dy)
        : drag.kind === "resize" ? resizeNodes(root, drag.boxes.get(name)!, drag.handle!, dx, dy,
          { keepRatio: event.shiftKey, fromCenter: event.altKey }, drag.frame)
        : rotateNodes(root, ids, delta, event.shiftKey, drag.rotations.get(name)!);
      if (after !== root) next.set(name, after);
    }
    drag.next = next;
    previews.setPreview(next);
  };

  const end = (commit: boolean) => {
    const drag = transform.current;
    transform.current = undefined;
    if (!drag) return false;
    const changes: DesignChange[] = [
      ...[...drag.next ?? []].map(([targetName, after]) => ({ targetName, before: drag.origins?.get(targetName) ?? drag.roots.get(targetName)!, after })),
      ...[...drag.nextPositions ?? []].filter(([name, after]) => after.x !== drag.positions.get(name)!.x || after.y !== drag.positions.get(name)!.y)
        .map(([targetName, after]) => ({ targetName, field: "position" as const, before: drag.positions.get(targetName)!, after }))
    ];
    if (commit && changes.length) store.apply({ changes });
    else if (drag.restore) m.setSelected(drag.restore);
    previews.setPreview(undefined);
    previews.setPreviewPositions(undefined);
    previews.setMarks(undefined);
    return true;
  };

  const nudge = (dx: number, dy: number) => {
    const changes = [...byBoard(selected)].flatMap(([name, ids]): DesignChange[] => {
      const before = m.savedRoot(name), board = saved.find(row => row.name === name);
      const after = before && moveNodes(before, ids, dx, dy);
      const out: DesignChange[] = before && after && after !== before ? [{ targetName: name, before, after }] : [];
      if (board && ids.includes(board.spec.root.id)) {
        const at = store.position(name) ?? { x: board.spec.x, y: board.spec.y };
        out.push({ targetName: name, field: "position", before: at, after: { x: at.x + dx, y: at.y + dy } });
      }
      return out;
    });
    // Held or repeated arrows within the history's merge window become one undo step.
    if (changes.length) store.apply({ changes, mergeKey: `nudge:${selected.map(item => `${item.board}/${item.id}`).sort().join(",")}` });
  };

  return { transform, handles, rotatable, begin, beginStop, copyOnDrag, update, end, nudge };
}
