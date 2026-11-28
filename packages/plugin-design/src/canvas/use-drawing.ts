import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesignNode, TextNode, TextSpan } from "../model/types.js";
import { DESIGN_BOARD_KIND } from "../model/index.js";
import { boardResourceName, folderOf } from "../model/names.js";
import { indexBoard } from "../edit/selection.js";
import { removeNode, updateNodes } from "../edit/transform.js";
import { createNode, DEFAULT_BOARD, DEFAULT_SIZE, drawBounds, flows, imageNode, insertChild, newNodeId,
  parentFrame, toParent, type DrawTool, type Point, type Rect, type Tool } from "../tools/shape-tools.js";
import { naturalSize } from "../tools/image-tool.js";
import { newText, textOf, withSpans } from "../tools/text-tool.js";
import type { TextEditing } from "../render/text-edit.js";
import { boardElement, measureNode } from "./overlay.js";
import type { CanvasModel, Hit } from "./model.js";

interface DrawGesture { pointer: number; tool: DrawTool | "text"; start: Point; client: Point; hit?: Hit; moved: boolean }

/** Drawing tools, text placed and edited in place, images, and creating or deleting boards. */
export function useDrawing(m: CanvasModel, tool: Tool, setTool: (tool: Tool) => void) {
  const { store, context, geometry, selected, t } = m;
  const draw = useRef<DrawGesture | undefined>(undefined);
  const keys = useRef({ shift: false, alt: false });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string[]>();
  const cancelDelete = useRef<HTMLButtonElement>(null);
  /** The text edited in place, and the characters last selected in it (for run formatting). */
  const [editingText, setEditingText] = useState<{ board: string; id: string; isNew: boolean }>();
  const [textRange, setTextRange] = useState<{ board: string; id: string; start: number; end: number }>();
  useLayoutEffect(() => setTextRange(range => range && selected.length === 1 && selected[0]!.board === range.board &&
    selected[0]!.id === range.id ? range : undefined), [selected]);
  useLayoutEffect(() => { if (confirmDelete) cancelDelete.current?.focus(); }, [confirmDelete]);

  /** The frame under a point (the board root at least) and its world box. */
  const parentAt = (hit: Hit) => {
    const board = geometry.find(item => item.name === hit.board), world = m.world.current;
    const parentId = board && parentFrame(board.index, hit.chain);
    const box = board && parentId !== undefined && world ? measureNode(world, board, parentId) : undefined;
    if (!board || parentId === undefined || !box) return;
    return { board, parentId, box: { cx: box.x + box.width / 2, cy: box.y + box.height / 2,
      width: box.width, height: box.height, rotation: box.rotation } };
  };
  const insert = (boardName: string, parentId: string, node: DesignNode) => {
    const before = m.savedRoot(boardName);
    if (!before) return false;
    const after = insertChild(before, parentId, node);
    if (after !== before && store.apply({ changes: [{ targetName: boardName, before, after }] })) {
      m.setSelected([{ board: boardName, id: node.id }]);
      return true;
    }
    return false;
  };

  const startEditing = (board: string, id: string) => {
    const node = geometry.find(row => row.name === board)?.index.get(id)?.node;
    if (!store.editable || node?.type !== "text" || node.locked) return false;
    m.setSelected([{ board, id }]);
    setTextRange(undefined);
    setEditingText({ board, id, isNew: false });
    return true;
  };
  const commitText = (spans: TextSpan[]) => {
    const edit = editingText;
    setEditingText(undefined);
    m.viewport.current?.focus({ preventScroll: true });
    if (!edit) return;
    // Read the store's root at commit time: the editor's closure is from when the edit began.
    const before = m.currentRoot(edit.board), node = before && indexBoard(before).get(edit.id)?.node;
    if (!before || node?.type !== "text") return;
    const next = withSpans(node, spans);
    if (!textOf(next).trim()) {
      // An empty text goes away: a new one undoes its own insertion; an old one is removed.
      if (edit.isNew) store.undo();
      else store.apply({ changes: [{ targetName: edit.board, before, after: removeNode(before, edit.id) }] });
      m.setSelected([]);
      return;
    }
    const after = updateNodes(before, new Map([[edit.id, { text: next.text, spans: next.spans } as Partial<DesignNode>]]));
    if (after !== before) store.apply({ changes: [{ targetName: edit.board, before, after }] });
  };
  const textEditing = useMemo<TextEditing | undefined>(() => {
    if (!editingText) return;
    const node = geometry.find(row => row.name === editingText.board)?.index.get(editingText.id)?.node;
    if (node?.type !== "text") return;
    return { id: editingText.id, source: node as TextNode, label: t("editText"), onCommit: commitText,
      onRange: range => setTextRange(range && { board: editingText.board, id: editingText.id, ...range }) };
    // Fixed for one edit: re-creating it would rebuild the editor's DOM.
  }, [editingText]);
  /** Finish a running edit (its blur commits what was typed) before something else changes the text. */
  const finishEditing = () => {
    if (!editingText) return;
    const host = m.world.current && boardElement(m.world.current, editingText.board);
    (host?.shadowRoot?.querySelector(".design-text-editor") as HTMLElement | null)?.blur();
  };

  const addBoard = async (place?: Rect) => {
    const canvas = m.data.canvas;
    if (busy || !context.createResourceNow || !canvas) return;
    setBusy(true);
    m.setStatus("");
    try {
      const x = place ? Math.round(place.x) : Math.max(0, ...m.boards.map(board => board.spec.x + (board.spec.root.width ?? 0) + 80));
      const result = await context.createResourceNow({
        kind: DESIGN_BOARD_KIND, name: boardResourceName(canvas.name),
        title: t("boardName").replace("{number}", String(m.data.boards.length + 1)),
        folder: [folderOf(canvas.relativePath), "+boards"].filter(Boolean).join("/"),
        spec: { canvas: canvas.name, ...(m.active ? { page: m.active } : {}), x, y: place ? Math.round(place.y) : 0,
          root: { id: "root", type: "frame", width: Math.max(1, Math.round(place?.width ?? DEFAULT_BOARD.width)),
            height: Math.max(1, Math.round(place?.height ?? DEFAULT_BOARD.height)), fills: [{ color: "#ffffff" }], children: [] } }
      });
      if (!result.ok) m.setStatus(result.message);
      else if (place) m.setSelected([{ board: result.name, id: "root" }]);
    } catch {
      m.setStatus(t("createBoardFailed"));
    } finally {
      setBusy(false);
    }
  };
  const deleteBoards = async (names: string[]) => {
    setConfirmDelete(undefined);
    for (const name of names) {
      const row = m.saved.find(board => board.name === name);
      if (!row?.hash || !context.deleteResource) continue;
      store.forget(name);
      const result = await context.deleteResource(name, { baseHash: row.hash });
      if (!result.ok) { m.setStatus(result.message); break; }
    }
    m.setSelected([]);
    m.viewport.current?.focus({ preventScroll: true });
  };

  const beginDraw = (pointer: number, start: Point, client: Point) => {
    draw.current = { pointer, tool: tool as DrawTool | "text", start, client, hit: m.hitAt(client.x, client.y), moved: false };
    m.setHover(undefined);
  };
  const moveDraw = (event: { pointerId: number; clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) => {
    const drag = draw.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y) >= 3) drag.moved = true;
    if (!drag.moved) return;
    const box = drawBounds(drag.tool === "text" ? "rectangle" : drag.tool, drag.start, m.worldPoint(event.clientX, event.clientY),
      { square: event.shiftKey, fromCenter: event.altKey });
    m.setMarquee({ x: Math.min(box.x, box.x + box.width), y: Math.min(box.y, box.y + box.height),
      width: Math.abs(box.width), height: Math.abs(box.height) });
  };
  const finishDraw = (end: Point) => {
    const drag = draw.current;
    draw.current = undefined;
    m.setMarquee(undefined);
    if (!drag) return;
    setTool("select"); // Like Figma: back to the select tool after each shape.
    const size = drag.tool === "text" ? { width: 0, height: 0 } : DEFAULT_SIZE[drag.tool];
    const rect = drag.moved ? drawBounds(drag.tool === "text" ? "rectangle" : drag.tool, drag.start, end, { square: keys.current.shift, fromCenter: keys.current.alt })
      : { x: drag.start.x, y: drag.start.y, ...size };
    const parent = drag.hit && parentAt(drag.hit);
    if (!parent) {
      if (drag.tool === "frame") void addBoard(drag.moved ? rect : { x: drag.start.x, y: drag.start.y, ...DEFAULT_BOARD });
      else m.setStatus(t("drawOnBoard"));
      return;
    }
    const local = toParent(rect, parent.box);
    const placed = !flows(parent.board.index.get(parent.parentId)?.node);
    if (drag.tool === "text") {
      const id = newNodeId(parent.board.index, "text");
      if (insert(parent.board.name, parent.parentId, newText(id, local, drag.moved, placed))) {
        setTextRange(undefined);
        setEditingText({ board: parent.board.name, id, isNew: true });
      }
      return;
    }
    insert(parent.board.name, parent.parentId, createNode(drag.tool, newNodeId(parent.board.index, drag.tool), local, placed));
  };
  const cancelDraw = () => { draw.current = undefined; m.setMarquee(undefined); };

  const placeImages = async (files: FileList | File[], client?: Point) => {
    if (!context.uploadAsset || !store.editable) return;
    const world = m.world.current;
    for (const file of [...files].filter(item => item.type.startsWith("image/"))) {
      // Drop point → the frame under it; otherwise the centre of the selected (or first) board.
      const hit = client && m.hitAt(client.x, client.y);
      const fallback = selected[0]?.board ?? m.boards[0]?.name;
      const parent = hit ? parentAt(hit) : undefined;
      const board = parent?.board ?? geometry.find(item => item.name === fallback);
      if (!board || !world) { m.setStatus(t("drawOnBoard")); return; }
      const rootId = [...board.index.values()].find(item => item.depth === 0)!.node.id;
      const target = parent ?? parentAt({ board: board.name, chain: [rootId] });
      if (!target) return;
      const centre = client ? m.worldPoint(client.x, client.y) : { x: target.box.cx, y: target.box.cy };
      const local = toParent({ x: centre.x, y: centre.y, width: 0, height: 0 }, target.box);
      m.setStatus("");
      const [uploaded, natural] = await Promise.all([context.uploadAsset(file), naturalSize(file)]);
      if (!uploaded.ok) { m.setStatus(`${t("uploadFailed")}: ${uploaded.message}`); return; }
      const node = imageNode(newNodeId(target.board.index, "image"), uploaded.path, natural, local, file.name);
      insert(target.board.name, target.parentId, flows(target.board.index.get(target.parentId)?.node)
        ? { ...node, x: undefined, y: undefined } as DesignNode : node);
    }
  };

  return {
    draw, keys, busy, confirmDelete, setConfirmDelete, cancelDelete,
    editingText, textRange, setTextRange, textEditing, startEditing, finishEditing,
    addBoard, deleteBoards, beginDraw, moveDraw, finishDraw, cancelDraw, placeImages
  };
}
