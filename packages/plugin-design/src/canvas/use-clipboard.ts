import { useRef, type ClipboardEvent } from "react";
import { indexBoard, type Selection } from "../edit/selection.js";
import { collect, duplicate, parseClipboard, paste, removeNodes, serialize, type Copied } from "../edit/clipboard.js";
import { alignMoves, applyMoves, distributeMoves, type AlignMode } from "../edit/align.js";
import { movable } from "../edit/transform.js";
import { enclosing, measureNode } from "./overlay.js";
import type { Bounds } from "./viewport.js";
import { byBoard, editableTarget, type CanvasModel } from "./model.js";

/** Copy, cut, paste, duplicate and delete nodes, and align or distribute them. */
export function useClipboard(m: CanvasModel) {
  const { store, selected, geometry } = m;
  const clipboard = useRef<Copied | undefined>(undefined);

  const copySelection = (): Copied | undefined => {
    const groups = [...byBoard(selected)];
    const nodes: Copied["nodes"] = [], parentIds: string[] = [];
    for (const [name, ids] of groups) {
      const root = m.currentRoot(name);
      if (!root) continue;
      const found = collect(indexBoard(root), ids);
      nodes.push(...found.nodes); parentIds.push(...found.parentIds);
    }
    return nodes.length ? { nodes, parentIds, board: groups[0]![0] } : undefined;
  };
  const deleteNodes = () => {
    const changes = [...byBoard(selected)].flatMap(([name, ids]) => {
      const before = m.currentRoot(name), after = before && removeNodes(before, ids);
      return before && after && after !== before ? [{ targetName: name, before, after }] : [];
    });
    if (changes.length && store.apply({ changes })) m.setSelected([]);
  };
  const pasteNodes = (copied: Copied) => {
    // Into the one selected frame, else into the board of the selection (or the first board on the page).
    const first = selected[0], board = geometry.find(row => row.name === (first?.board ?? m.boards[0]?.name));
    if (!board) { m.setStatus(m.t("drawOnBoard")); return; }
    const one = selected.length === 1 ? board.index.get(selected[0]!.id)?.node : undefined;
    const rootId = [...board.index.values()].find(item => item.depth === 0)!.node.id;
    const parentId = one?.type === "frame" && !copied.nodes.some(node => node.id === one.id) ? one.id : rootId;
    const before = m.currentRoot(board.name);
    if (!before) return;
    const made = paste(before, parentId, copied, copied.board === board.name);
    if (made.ids.length && store.apply({ changes: [{ targetName: board.name, before, after: made.root }] }))
      m.setSelected(made.ids.map(id => ({ board: board.name, id })));
  };
  const duplicateSelection = () => {
    const made: Selection[] = [];
    const changes = [...byBoard(selected)].flatMap(([name, ids]) => {
      const before = m.currentRoot(name);
      if (!before) return [];
      const copy = duplicate(before, ids, 10, 10);
      made.push(...copy.ids.map(id => ({ board: name, id })));
      return copy.root !== before ? [{ targetName: name, before, after: copy.root }] : [];
    });
    if (changes.length && store.apply({ changes })) m.setSelected(made);
  };

  /** The browser's copy, cut and paste events on the focused canvas. */
  const events = {
    onCopy(event: ClipboardEvent<HTMLDivElement>) {
      if (editableTarget(event)) return;
      const copied = copySelection();
      if (!copied) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", serialize(copied));
      clipboard.current = copied;
    },
    onCut(event: ClipboardEvent<HTMLDivElement>) {
      if (editableTarget(event) || !store.editable) return;
      const copied = copySelection();
      if (!copied) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", serialize(copied));
      clipboard.current = copied;
      deleteNodes();
    },
    onPaste(event: ClipboardEvent<HTMLDivElement>) {
      if (editableTarget(event) || !store.editable) return;
      const text = event.clipboardData.getData("text/plain");
      // Our nodes from the system clipboard, else (nothing readable there) this screen's own copy.
      const copied = text ? parseClipboard(text) : clipboard.current;
      if (!copied) return;
      event.preventDefault();
      pasteNodes(copied);
    }
  };

  const movableSelection = selected.filter(item => {
    const board = geometry.find(row => row.name === item.board);
    return board && movable(board.index, [item.id]).length > 0;
  });
  const arrangeBy = (moves: (boxes: Map<string, Bounds>) => Map<string, { dx: number; dy: number }>) => {
    const world = m.world.current;
    if (!world) return;
    const boxes = new Map<string, Bounds>();
    for (const item of movableSelection) {
      const board = geometry.find(row => row.name === item.board)!, box = measureNode(world, board, item.id);
      if (box) boxes.set(`${item.board}/${item.id}`, enclosing(box));
    }
    const all = moves(boxes);
    const changes = [...byBoard(movableSelection)].flatMap(([name, ids]) => {
      const before = m.currentRoot(name);
      if (!before) return [];
      const after = applyMoves(before, new Map(ids.flatMap(id => { const move = all.get(`${name}/${id}`); return move ? [[id, move] as const] : []; })));
      return after !== before ? [{ targetName: name, before, after }] : [];
    });
    if (changes.length) store.apply({ changes });
  };
  const arrange = movableSelection.length ? {
    canDistribute: movableSelection.length >= 3,
    align(mode: AlignMode) {
      arrangeBy(boxes => {
        let frame: Bounds | undefined;
        if (boxes.size === 1) {
          // One node aligns within its parent.
          const item = movableSelection[0]!, board = geometry.find(row => row.name === item.board)!;
          const parentId = board.index.get(item.id)?.parentId;
          const box = parentId !== undefined && m.world.current ? measureNode(m.world.current, board, parentId) : undefined;
          frame = box && enclosing(box);
        } else {
          const list = [...boxes.values()];
          const x = Math.min(...list.map(box => box.x)), y = Math.min(...list.map(box => box.y));
          frame = { x, y, width: Math.max(...list.map(box => box.x + box.width)) - x, height: Math.max(...list.map(box => box.y + box.height)) - y };
        }
        return frame ? alignMoves(boxes, mode, frame) : new Map();
      });
    },
    distribute(axis: "x" | "y") { arrangeBy(boxes => distributeMoves(boxes, axis)); }
  } : undefined;

  return { events, deleteNodes, duplicateSelection, arrange };
}
