import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { BoardView, canvasResolution, type CanvasRendererData } from "../render/board-view.js";
import { fontFaceCss } from "../render/fonts.js";
import { DESIGN_BOARD_KIND } from "../model/index.js";
import { boardResourceName, folderOf } from "../model/names.js";
// @ts-expect-error esbuild imports stylesheets as text.
import canvasCss from "../design.css";
import { designText } from "../i18n.js";
import { Pages } from "./pages.js";
import { Notes } from "./notes.js";
import { useViewport } from "./viewport.js";
import { useDesignEdit } from "../edit/use-edit.js";
import { children, indexBoard, parents, pickAt, selectable, type Selection } from "../edit/selection.js";
import { boardElement, enclosing, measureNode, Overlay } from "./overlay.js";
import type { Bounds } from "./viewport.js";
import { Presentation } from "./presentation.js";
import type { DesignNode } from "../model/types.js";
import type { BoardPosition, DesignChange } from "../edit/operations.js";
import { Toolbar } from "../tools/toolbar.js";
import { createNode, DEFAULT_BOARD, DEFAULT_SIZE, drawBounds, flows, imageNode, insertChild, newNodeId,
  parentFrame, toParent, TOOL_KEYS, type DrawTool, type Point, type Rect, type Tool } from "../tools/shape-tools.js";
import { naturalSize } from "../tools/image-tool.js";
import { newText, textOf, withSpans } from "../tools/text-tool.js";
import type { TextEditing } from "../render/text-edit.js";
import type { TextNode, TextSpan } from "../model/types.js";
import { Inspector } from "../panels/inspector.js";
import { collect, duplicate, parseClipboard, paste, removeNodes, serialize, type Copied } from "../edit/clipboard.js";
import { alignMoves, applyMoves, distributeMoves } from "../edit/align.js";
import { LeftPanel } from "../panels/left-panel.js";
import { Layers } from "../panels/layers.js";
import type { InspectorContext, PaintList } from "../panels/sections.js";
import { isGradient, positionAt, type Gradient } from "../panels/gradient-axis.js";
import { rotate } from "../edit/transform.js";
import { angleOf, HANDLES, moveNodes, movable, removeNode, resizable, resizeNodes, rotateNodes, updateNodes,
  type Handle, type WorldBox } from "../edit/transform.js";

/** A drag of the selection: the model changes only on release (one undo step). */
interface TransformGesture {
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
}

export function CanvasScreen({ context }: PluginViewProps) {
  const data = context.rendererData as unknown as CanvasRendererData;
  // Reset navigation and mode choices when the host opens another canvas.
  return <CanvasContent key={data.canvas?.name ?? ""} context={context} data={data} />;
}

function CanvasContent({ context, data: incoming }: PluginViewProps & { data: CanvasRendererData }) {
  const { store, data, reloaded } = useDesignEdit(incoming, context);
  const locale = context.locale === "ja" ? "ja" : "en";
  const t = (key: keyof typeof designText) => designText[key][locale];
  const [page, setPage] = useState(data.canvas?.spec.pages?.[0]?.id ?? "");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [selectionBounds, setSelectionBounds] = useState<Bounds>();
  const [hover, setHover] = useState<Selection>();
  const [marquee, setMarquee] = useState<Bounds>();
  const space = useRef(false);
  const gesture = useRef<{ pointer: number; x: number; y: number; start: { x: number; y: number };
    hit?: { board: string; chain: string[] }; moved: boolean; shift: boolean; deep: boolean;
    moveItems?: Selection[] } | undefined>(undefined);
  const transform = useRef<TransformGesture | undefined>(undefined);
  const [preview, setPreview] = useState<ReadonlyMap<string, DesignNode>>();
  const [previewPositions, setPreviewPositions] = useState<ReadonlyMap<string, BoardPosition>>();
  const [activeGradient, setActiveGradient] = useState<{ list: PaintList; paint: number }>();
  useLayoutEffect(() => setActiveGradient(undefined), [selected]);
  useLayoutEffect(() => setTextRange(range => range && selected.length === 1 && selected[0]!.board === range.board &&
    selected[0]!.id === range.id ? range : undefined), [selected]);
  const [tool, setTool] = useState<Tool>("select");
  const hand = tool === "hand";
  const setHand = (value: boolean) => setTool(value ? "hand" : "select");
  const drawing = tool !== "select" && tool !== "hand";
  const draw = useRef<{ pointer: number; tool: DrawTool | "text"; start: Point; client: Point;
    hit?: { board: string; chain: string[] }; moved: boolean } | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string[]>();
  /** The text edited in place, and the characters last selected in it (for run formatting). */
  const [editingText, setEditingText] = useState<{ board: string; id: string; isNew: boolean }>();
  const [textRange, setTextRange] = useState<{ board: string; id: string; start: number; end: number }>();
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [presenting, setPresenting] = useState<string>();
  const presentButton = useRef<HTMLButtonElement>(null);
  const screen = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = screen.current;
    if (!element) return;
    const resize = () => element.style.setProperty("--design-top", `${element.getBoundingClientRect().top + 16}px`);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);
  const pages = data.canvas?.spec.pages ?? [];
  const active = pages.some(item => item.id === page) ? page : pages[0]?.id ?? "";
  const onPage = (id: string) => { setPage(id); setSelected([]); setHover(undefined); setMarquee(undefined); gesture.current = undefined; };
  const onPageContent = (item: { page?: string }) => (item.page ?? pages[0]?.id ?? "") === active;
  const saved = data.boards.filter(board => board.spec?.root && onPageContent(board.spec));
  // While dragging, the touched boards draw the previewed root (no hash, so they re-render).
  const boards = preview || previewPositions ? saved.map(board => {
    const root = preview?.get(board.name), position = previewPositions?.get(board.name);
    return root || position ? { ...board, hash: undefined, spec: { ...board.spec, ...(root ? { root } : {}), ...position } } : board;
  }) : saved;
  const notes = (data.canvas?.spec.notes ?? []).filter(onPageContent);
  const identity = (row: { name?: string; relativePath: string; hash?: string }) =>
    [row.name ?? row.relativePath, row.hash ?? row];
  const dependencyKey = JSON.stringify([data.canvas && identity(data.canvas),
    data.components.map(identity), data.styles.map(identity), data.tokenFiles.map(identity), modes]);
  const resolution = useMemo(() => canvasResolution(data, modes), [dependencyKey, store.getSnapshot()]);
  const geometry = useMemo(() => boards.map(board => ({ name: board.name, x: board.spec.x, y: board.spec.y,
    index: indexBoard(board.spec.root) })), [incoming.boards, active, store.getSnapshot(), preview, previewPositions]);
  useLayoutEffect(() => {
    setSelected(previous => {
      const next = previous.filter(item => {
        const board = geometry.find(board => board.name === item.board);
        return board && selectable(board.index, item.id);
      });
      return next.length === previous.length ? previous : next;
    });
    setHover(undefined);
  }, [geometry]);
  const fonts = fontFaceCss(data.canvas?.spec.fonts ?? []);
  const bounds = boards.map(board => ({ x: board.spec.x, y: board.spec.y,
    width: board.spec.root.width ?? 0, height: board.spec.root.height ?? 0 }));
  const navigation = useViewport({ hand, onHand: setHand, bounds: [...bounds,
    ...notes.map(note => ({ x: note.x, y: note.y, width: 280, height: note.kind === "title" ? 40 : 100 }))],
    selected: selectionBounds, pageKey: active });
  const isSelected = (item: Selection) => selected.some(other => other.board === item.board && other.id === item.id);
  const editable = (event: { nativeEvent: Event }) => event.nativeEvent.composedPath().some(target =>
    target instanceof HTMLElement && (target.matches("input, textarea, select, button, a") || target.isContentEditable));
  const worldPoint = (x: number, y: number) => {
    const world = navigation.world.current!;
    const rect = world.getBoundingClientRect();
    const scale = Number(world.style.getPropertyValue("--design-scale")) || 1;
    return { x: (x - rect.x) / scale, y: (y - rect.y) / scale };
  };
  const hitAt = (x: number, y: number) => {
    const world = navigation.world.current;
    if (!world) return;
    for (const board of [...geometry].reverse()) {
      const host = boardElement(world, board.name);
      for (const element of host?.shadowRoot?.elementsFromPoint(x, y) ?? []) {
        const chain: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const id = node.getAttribute("data-node-id");
          if (id && board.index.has(id)) chain.push(id);
        }
        if (chain.length && chain.every(id => selectable(board.index, id))) return { board: board.name, chain };
      }
    }
  };
  const choose = (hit: { board: string; chain: string[] }, mode: "normal" | "deep" | "enter") => {
    const index = geometry.find(board => board.name === hit.board)!.index;
    const id = pickAt(index, hit.chain, selected.filter(item => item.board === hit.board).map(item => item.id), mode);
    return id ? { board: hit.board, id } : undefined;
  };
  const merge = (items: Selection[], add: boolean) => setSelected(previous => add
    ? [...previous, ...items.filter(item => !previous.some(other => item.board === other.board && item.id === other.id))]
    : items);
  const byBoard = (items: readonly Selection[]) => {
    const groups = new Map<string, string[]>();
    for (const item of items) groups.set(item.board, [...groups.get(item.board) ?? [], item.id]);
    return groups;
  };
  const savedRoot = (name: string) => saved.find(board => board.name === name)?.spec.root;
  const handles: readonly Handle[] = !store.editable || !selected.length ? []
    : [...byBoard(selected)].some(([name, ids]) => {
        const board = geometry.find(item => item.name === name);
        return board && movable(board.index, ids).length;
      }) ? HANDLES
    : selected.length === 1 && geometry.some(board => board.name === selected[0]!.board &&
        resizable(board.index, [selected[0]!.id]).length) ? ["e", "s", "se"] : [];
  const rotatable = handles.length === HANDLES.length;
  const beginTransform = (pointer: number, kind: TransformGesture["kind"], items: readonly Selection[],
    start: { x: number; y: number }, handle?: Handle) => {
    const world = navigation.world.current;
    if (!world || !store.editable) return;
    const ids = byBoard(items), roots = new Map<string, DesignNode>();
    const boxes = new Map<string, Map<string, WorldBox>>(), rotations = new Map<string, Map<string, number>>();
    const all: WorldBox[] = [];
    for (const [name, list] of ids) {
      const board = geometry.find(item => item.name === name), root = savedRoot(name);
      if (!board || !root) continue;
      roots.set(name, root);
      const measured = new Map<string, WorldBox>(), angles = new Map<string, number>();
      for (const id of list) {
        const box = measureNode(world, board, id);
        if (box) {
          const value = { cx: box.x + box.width / 2, cy: box.y + box.height / 2, width: box.width, height: box.height, rotation: box.rotation };
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
      angle: angleOf(centre.cx, centre.cy, start.x, start.y) };
    setHover(undefined);
  };
  const updateTransform = (event: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) => {
    const drag = transform.current;
    if (!drag) return;
    const point = worldPoint(event.clientX, event.clientY), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
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
      const after = updateNodes(root, new Map([[id, { [list]: updated } as Partial<DesignNode>]]));
      next.set(board, after);
      drag.next = next;
      setPreview(next);
      return;
    }
    const centre = drag.frame ?? [...drag.boxes.values()].flatMap(map => [...map.values()])[0]!;
    const delta = angleOf(centre.cx, centre.cy, point.x, point.y) - drag.angle;
    if (drag.kind === "move" && drag.positions.size) {
      const moved = new Map([...drag.positions].map(([name, position]) =>
        [name, { x: Math.round((position.x + dx) * 100) / 100, y: Math.round((position.y + dy) * 100) / 100 }] as const));
      drag.nextPositions = moved;
      setPreviewPositions(moved);
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
    setPreview(next);
  };
  const endTransform = (commit: boolean) => {
    const drag = transform.current;
    transform.current = undefined;
    if (!drag) return false;
    const changes: DesignChange[] = [
      ...[...drag.next ?? []].map(([targetName, after]) => ({ targetName, before: drag.origins?.get(targetName) ?? drag.roots.get(targetName)!, after })),
      ...[...drag.nextPositions ?? []].filter(([name, after]) => after.x !== drag.positions.get(name)!.x || after.y !== drag.positions.get(name)!.y)
        .map(([targetName, after]) => ({ targetName, field: "position" as const, before: drag.positions.get(targetName)!, after }))
    ];
    if (commit && changes.length) store.apply({ changes });
    else if (drag.restore) setSelected(drag.restore);
    setPreview(undefined);
    setPreviewPositions(undefined);
    return true;
  };
  const nudge = (dx: number, dy: number) => {
    const changes = [...byBoard(selected)].flatMap(([name, ids]): DesignChange[] => {
      const before = savedRoot(name), board = saved.find(row => row.name === name);
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
  /** The frame under a point (the board root at least) and its world box. */
  const parentAt = (hit: { board: string; chain: string[] }) => {
    const board = geometry.find(item => item.name === hit.board), world = navigation.world.current;
    const parentId = board && parentFrame(board.index, hit.chain);
    const box = board && parentId !== undefined && world ? measureNode(world, board, parentId) : undefined;
    if (!board || parentId === undefined || !box) return;
    return { board, parentId, box: { cx: box.x + box.width / 2, cy: box.y + box.height / 2,
      width: box.width, height: box.height, rotation: box.rotation } };
  };
  const insert = (boardName: string, parentId: string, node: DesignNode) => {
    const before = savedRoot(boardName);
    if (!before) return;
    const after = insertChild(before, parentId, node);
    if (after !== before && store.apply({ changes: [{ targetName: boardName, before, after }] })) {
      setSelected([{ board: boardName, id: node.id }]);
      return true;
    }
    return false;
  };
  const startEditing = (board: string, id: string) => {
    const node = geometry.find(row => row.name === board)?.index.get(id)?.node;
    if (!store.editable || node?.type !== "text" || node.locked) return false;
    setSelected([{ board, id }]);
    setTextRange(undefined);
    setEditingText({ board, id, isNew: false });
    return true;
  };
  const commitText = (spans: TextSpan[]) => {
    const edit = editingText;
    setEditingText(undefined);
    navigation.viewport.current?.focus({ preventScroll: true });
    if (!edit) return;
    // Read the store's root at commit time: the editor's closure is from when the edit began.
    const before = store.root(edit.board) ?? savedRoot(edit.board), node = before && indexBoard(before).get(edit.id)?.node;
    if (!before || node?.type !== "text") return;
    const next = withSpans(node, spans);
    if (!textOf(next).trim()) {
      // An empty text goes away: a new one undoes its own insertion; an old one is removed.
      if (edit.isNew) store.undo();
      else store.apply({ changes: [{ targetName: edit.board, before, after: removeNode(before, edit.id) }] });
      setSelected([]);
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
  const finishDraw = (end: Point) => {
    const drag = draw.current;
    draw.current = undefined;
    setMarquee(undefined);
    if (!drag) return;
    setTool("select"); // Like Figma: back to the select tool after each shape.
    const size = drag.tool === "text" ? { width: 0, height: 0 } : DEFAULT_SIZE[drag.tool];
    const rect = drag.moved ? drawBounds(drag.tool === "text" ? "rectangle" : drag.tool, drag.start, end, { square: keys.current.shift, fromCenter: keys.current.alt })
      : { x: drag.start.x, y: drag.start.y, ...size };
    const parent = drag.hit && parentAt(drag.hit);
    if (!parent) {
      if (drag.tool === "frame") void addBoard(drag.moved ? rect : { x: drag.start.x, y: drag.start.y, ...DEFAULT_BOARD });
      else setStatus(t("drawOnBoard"));
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
    insert(parent.board.name, parent.parentId,
      createNode(drag.tool, newNodeId(parent.board.index, drag.tool), local, placed));
  };
  const keys = useRef({ shift: false, alt: false });
  const placeImages = async (files: FileList | File[], client?: Point) => {
    if (!context.uploadAsset || !store.editable) return;
    const world = navigation.world.current;
    for (const file of [...files].filter(item => item.type.startsWith("image/"))) {
      // Drop point → the frame under it; otherwise the centre of the selected (or first) board.
      const hit = client && hitAt(client.x, client.y);
      const fallback = selected[0]?.board ?? boards[0]?.name;
      const parent = hit ? parentAt(hit) : undefined;
      const board = parent?.board ?? geometry.find(item => item.name === fallback);
      if (!board || !world) { setStatus(t("drawOnBoard")); return; }
      const rootId = [...board.index.values()].find(item => item.depth === 0)!.node.id;
      const target = parent ?? parentAt({ board: board.name, chain: [rootId] });
      if (!target) return;
      const centre = client ? worldPoint(client.x, client.y) : { x: target.box.cx, y: target.box.cy };
      const local = toParent({ x: centre.x, y: centre.y, width: 0, height: 0 }, target.box);
      setStatus("");
      const [uploaded, natural] = await Promise.all([context.uploadAsset(file), naturalSize(file)]);
      if (!uploaded.ok) { setStatus(`${t("uploadFailed")}: ${uploaded.message}`); return; }
      const node = imageNode(newNodeId(target.board.index, "image"), uploaded.path, natural, local, file.name);
      insert(target.board.name, target.parentId, flows(target.board.index.get(target.parentId)?.node)
        ? { ...node, x: undefined, y: undefined } as DesignNode : node);
    }
  };
  const deleteBoards = async (names: string[]) => {
    setConfirmDelete(undefined);
    for (const name of names) {
      const row = saved.find(board => board.name === name);
      if (!row?.hash || !context.deleteResource) continue;
      const result = await context.deleteResource(name, { baseHash: row.hash });
      if (!result.ok) { setStatus(result.message); break; }
    }
    setSelected([]);
    navigation.viewport.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => { if (confirmDelete) cancelDelete.current?.focus(); }, [confirmDelete]);
  const clipboard = useRef<Copied | undefined>(undefined);
  const copySelection = (): Copied | undefined => {
    const groups = [...byBoard(selected)];
    const nodes: Copied["nodes"] = [], parentIds: string[] = [];
    for (const [name, ids] of groups) {
      const root = store.root(name) ?? savedRoot(name);
      if (!root) continue;
      const found = collect(indexBoard(root), ids);
      nodes.push(...found.nodes); parentIds.push(...found.parentIds);
    }
    return nodes.length ? { nodes, parentIds, board: groups[0]![0] } : undefined;
  };
  const deleteNodes = () => {
    const changes = [...byBoard(selected)].flatMap(([name, ids]) => {
      const before = store.root(name) ?? savedRoot(name), after = before && removeNodes(before, ids);
      return before && after && after !== before ? [{ targetName: name, before, after }] : [];
    });
    if (changes.length && store.apply({ changes })) setSelected([]);
  };
  const pasteNodes = (copied: Copied) => {
    // Into the one selected frame, else into the board of the selection (or the first board on the page).
    const first = selected[0], board = geometry.find(row => row.name === (first?.board ?? boards[0]?.name));
    if (!board) { setStatus(t("drawOnBoard")); return; }
    const one = selected.length === 1 ? board.index.get(selected[0]!.id)?.node : undefined;
    const rootId = [...board.index.values()].find(item => item.depth === 0)!.node.id;
    const parentId = one?.type === "frame" && !copied.nodes.some(node => node.id === one.id) ? one.id : rootId;
    const before = store.root(board.name) ?? savedRoot(board.name);
    if (!before) return;
    const made = paste(before, parentId, copied, copied.board === board.name);
    if (made.ids.length && store.apply({ changes: [{ targetName: board.name, before, after: made.root }] }))
      setSelected(made.ids.map(id => ({ board: board.name, id })));
  };
  const duplicateSelection = () => {
    const made: Selection[] = [];
    const changes = [...byBoard(selected)].flatMap(([name, ids]) => {
      const before = store.root(name) ?? savedRoot(name);
      if (!before) return [];
      const copy = duplicate(before, ids, 10, 10);
      made.push(...copy.ids.map(id => ({ board: name, id })));
      return copy.root !== before ? [{ targetName: name, before, after: copy.root }] : [];
    });
    if (changes.length && store.apply({ changes })) setSelected(made);
  };
  const movableSelection = selected.filter(item => {
    const board = geometry.find(row => row.name === item.board);
    return board && movable(board.index, [item.id]).length > 0;
  });
  const arrangeBy = (moves: (boxes: Map<string, Bounds>) => Map<string, { dx: number; dy: number }>) => {
    const world = navigation.world.current;
    if (!world) return;
    const boxes = new Map<string, Bounds>();
    for (const item of movableSelection) {
      const board = geometry.find(row => row.name === item.board)!, box = measureNode(world, board, item.id);
      if (box) boxes.set(`${item.board}/${item.id}`, enclosing(box));
    }
    const all = moves(boxes);
    const changes = [...byBoard(movableSelection)].flatMap(([name, ids]) => {
      const before = store.root(name) ?? savedRoot(name);
      if (!before) return [];
      const after = applyMoves(before, new Map(ids.flatMap(id => { const move = all.get(`${name}/${id}`); return move ? [[id, move] as const] : []; })));
      return after !== before ? [{ targetName: name, before, after }] : [];
    });
    if (changes.length) store.apply({ changes });
  };
  const arrange = movableSelection.length ? {
    canDistribute: movableSelection.length >= 3,
    align(mode: Parameters<typeof alignMoves>[1]) {
      arrangeBy(boxes => {
        let frame: Bounds | undefined;
        if (boxes.size === 1) {
          // One node aligns within its parent.
          const item = movableSelection[0]!, board = geometry.find(row => row.name === item.board)!;
          const parentId = board.index.get(item.id)?.parentId;
          const box = parentId !== undefined && navigation.world.current ? measureNode(navigation.world.current, board, parentId) : undefined;
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
  const lengthTokens = Object.entries(resolution.context.tokens ?? {})
    .filter(([, value]) => typeof value === "number" || /^-?\d*\.?\d+(?:px|rem|em)?$/.test(String(value)))
    .map(([path, value]) => ({ path, value })).sort((a, b) => a.path.localeCompare(b.path));
  const colorTokens = Object.entries(resolution.context.tokens ?? {})
    .filter(([, value]) => typeof value === "string" && /^(?:#|rgba?\(|hsla?\(|color\(|oklch\(|oklab\(|lab\(|lch\()/i.test(value))
    .map(([path, value]) => ({ path, value })).sort((a, b) => a.path.localeCompare(b.path));
  const gradientItem = activeGradient && selected.length === 1 ? selected[0] : undefined;
  const gradientPaint = gradientItem && geometry.find(row => row.name === gradientItem.board)?.index.get(gradientItem.id)?.node[activeGradient!.list]?.[activeGradient!.paint];
  const inspector: InspectorContext = {
    targets: selected.flatMap(item => {
      const board = geometry.find(row => row.name === item.board), node = board?.index.get(item.id)?.node;
      return board && node ? [{ board: item.board, node, index: board.index }] : [];
    }),
    boards: boards.map(board => ({ name: board.name, title: board.title ?? board.name,
      width: board.spec.root.width, height: board.spec.root.height })),
    locale, editable: store.editable && !transform.current, lengthTokens, colorTokens,
    resolveColor: value => {
      const token = /^\{(.+)\}$/.exec(value)?.[1];
      const resolved = token ? resolution.context.tokens?.[token] : value;
      return typeof resolved === "string" ? resolved : undefined;
    },
    ...(context.uploadAsset && store.editable ? { uploadImage: async (file: File) => {
      const result = await context.uploadAsset!(file);
      if (!result.ok) { setStatus(`${t("uploadFailed")}: ${result.message}`); return undefined; }
      return result.path;
    } } : {}),
    activeGradient, setActiveGradient, textRange, clearTextRange: () => setTextRange(undefined),
    ...(arrange ? { arrange } : {}),
    update(patch, mergeKey) {
      // A text being edited is finished first (its blur commits what was typed), so the change
      // below applies to the latest text and the editor cannot overwrite it later.
      if (editingText) {
        const host = navigation.world.current && boardElement(navigation.world.current, editingText.board);
        (host?.shadowRoot?.querySelector(".design-text-editor") as HTMLElement | null)?.blur();
      }
      const changes = [...byBoard(selected)].flatMap(([name]) => {
        const before = store.root(name) ?? savedRoot(name), board = geometry.find(row => row.name === name);
        if (!before || !board) return [];
        const fresh = indexBoard(before);
        const map = new Map(inspector.targets.filter(target => target.board === name).flatMap(target => {
          const node = fresh.get(target.node.id)?.node;
          const value = node && patch({ ...target, node, index: fresh });
          return value ? [[target.node.id, value] as const] : [];
        }));
        const after = map.size ? updateNodes(before, map) : before;
        return after !== before ? [{ targetName: name, before, after }] : [];
      });
      if (changes.length) store.apply({ changes, ...(mergeKey ? { mergeKey } : {}) });
    },
    selectBoard(name) {
      const board = geometry.find(row => row.name === name);
      const root = board && [...board.index.values()].find(item => item.depth === 0)?.node.id;
      if (root !== undefined) setSelected([{ board: name, id: root }]);
    }
  };
  const finishGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draw.current?.pointer === event.pointerId) { finishDraw(worldPoint(event.clientX, event.clientY)); return; }
    if (transform.current?.pointer === event.pointerId) { endTransform(true); return; }
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    gesture.current = undefined;
    setMarquee(undefined);
    if (drag.moved) {
      if (drag.hit) return;
      const end = worldPoint(event.clientX, event.clientY);
      const area = { x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y),
        width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) };
      const overlaps = (box: Bounds) => box.x <= area.x + area.width && box.x + box.width >= area.x &&
        box.y <= area.y + area.height && box.y + box.height >= area.y;
      const contains = (box: Bounds) => box.x >= area.x && box.y >= area.y &&
        box.x + box.width <= area.x + area.width && box.y + box.height <= area.y + area.height;
      const items = geometry.flatMap(board => {
        const root = [...board.index.values()].find(item => item.depth === 0)!;
        const box = measureNode(navigation.world.current!, board, root.node.id);
        const ids = box && contains(enclosing(box)) ? [root.node.id] :
          [...board.index.values()].filter(item => item.depth === 1).filter(item => {
            const box = measureNode(navigation.world.current!, board, item.node.id);
            return box && overlaps(enclosing(box));
          }).map(item => item.node.id);
        return ids.filter(id => selectable(board.index, id)).map(id => ({ board: board.name, id }));
      });
      merge(items, drag.shift);
    } else if (drag.hit) {
      const item = choose(drag.hit, drag.deep ? "deep" : "normal");
      if (item) {
        if (drag.shift && isSelected(item)) setSelected(selected.filter(other => other.board !== item.board || other.id !== item.id));
        else merge([item], drag.shift);
      }
    } else if (!drag.shift) setSelected([]);
  };
  const addBoard = async (place?: Rect) => {
    if (busy || !context.createResourceNow || !data.canvas) return;
    setBusy(true);
    setStatus("");
    try {
      const x = place ? Math.round(place.x) : Math.max(0, ...boards.map(board => board.spec.x + (board.spec.root.width ?? 0) + 80));
      const name = boardResourceName(data.canvas.name);
      const result = await context.createResourceNow({
        kind: DESIGN_BOARD_KIND, name,
        title: t("boardName").replace("{number}", String(data.boards.length + 1)),
        folder: [folderOf(data.canvas.relativePath), "+boards"].filter(Boolean).join("/"),
        spec: { canvas: data.canvas.name, ...(active ? { page: active } : {}), x, y: place ? Math.round(place.y) : 0,
          root: { id: "root", type: "frame", width: Math.max(1, Math.round(place?.width ?? DEFAULT_BOARD.width)),
            height: Math.max(1, Math.round(place?.height ?? DEFAULT_BOARD.height)), fills: [{ color: "#ffffff" }], children: [] } }
      });
      if (!result.ok) setStatus(result.message);
      else if (place) setSelected([{ board: result.name, id: "root" }]);
    } catch {
      setStatus(t("createBoardFailed"));
    } finally {
      setBusy(false);
    }
  };
  return <section ref={screen} className="design-canvas-screen" data-testid="design-canvas" aria-label={t("canvas")}>
    <style>{canvasCss}</style>
    {reloaded && <p role="alert" data-testid="design-reloaded">{t("externalReload")}</p>}
    {data.notices?.length > 0 && <div role="alert"><ul>{data.notices.map((notice, i) =>
      <li key={i}>{locale === "ja" ? notice.ja : notice.en}</li>)}</ul></div>}
    <div className="design-canvas-tools" role="group" aria-label={t("navigation")}>
      {/* Drawing needs a saved canvas: an unsaved draft cannot hold boards yet (no createResourceNow). */}
      <Toolbar tool={tool} onTool={next => { setTool(next); setHover(undefined); }} locale={locale}
        editable={store.editable && !!context.createResourceNow} onImage={context.uploadAsset ? files => { void placeImages(files); } : undefined} />
      <button type="button" data-testid="design-zoom-reset" onClick={navigation.reset}>{t("actualSize")}</button>
      <button type="button" data-testid="design-zoom-fit" onClick={() => navigation.fit()}>{t("fitAll")}</button>
      <button type="button" data-testid="design-zoom-selection" disabled={!selected.length} onClick={() => navigation.fit(true)}>{t("fitSelection")}</button>
      <output ref={navigation.zoomLabel} aria-label={t("zoom")} data-testid="design-zoom">100%</output>
      <button ref={presentButton} type="button" data-testid="design-present" onClick={() => {
        const start = boards.find(board => board.spec.startingPoint) ?? boards[0];
        if (start) setPresenting(start.name);
        else setStatus(t("noStartingBoard"));
      }}>{t("present")}</button>
      {Object.entries(resolution.modifiers).map(([modifier, options]) => <label key={modifier}>{modifier}
        <select data-testid={`design-mode-${modifier}`} value={modes[modifier] ?? ""} onChange={event =>
          setModes(previous => {
            const next = { ...previous };
            if (event.target.value) next[modifier] = event.target.value;
            else delete next[modifier];
            return next;
          })}>
          <option value="">{t("defaultMode")}</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>)}
      {store.editable && context.createResourceNow && <button type="button" data-testid="design-add-board"
        disabled={busy} onClick={() => { void addBoard(); }}>{t("createBoard")}</button>}
      {confirmDelete && <div className="design-confirm" role="alertdialog" aria-modal="false"
        aria-labelledby="design-confirm-text" data-testid="design-confirm-delete"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setConfirmDelete(undefined); navigation.viewport.current?.focus(); } }}>
        <p id="design-confirm-text">{confirmDelete.length === 1
          ? t("deleteBoardConfirm").replace("{name}", saved.find(board => board.name === confirmDelete[0])?.title ?? confirmDelete[0]!)
          : t("deleteBoardsConfirm").replace("{count}", String(confirmDelete.length))}</p>
        <div>
          <button ref={cancelDelete} type="button" data-testid="design-confirm-cancel"
            onClick={() => { setConfirmDelete(undefined); navigation.viewport.current?.focus(); }}>{t("cancel")}</button>
          <button type="button" data-testid="design-confirm-ok" onClick={() => { void deleteBoards(confirmDelete); }}>{t("deleteConfirm")}</button>
        </div>
      </div>}
      <span role="status">{status}</span>
      <span role="status" data-testid="design-selection-status">{selected.length ? t("selectedCount").replace("{count}", String(selected.length)) : ""}</span>
      {store.editable && <span role="status" data-testid="design-save-status" data-state={store.status}>
        {store.status ? t(store.status) : ""}{store.error ? `: ${store.error}` : ""}
      </span>}
    </div>
    <div className="design-canvas-frame">
      <LeftPanel locale={locale} initial={pages.length ? "pages" : "layers"}
        pages={pages.length ? <Pages pages={pages} active={active} onChange={onPage} locale={locale} />
          : <p className="design-inspector-empty">{t("noPages")}</p>}
        layers={<Layers locale={locale} editable={store.editable && !transform.current}
          boards={boards.map(board => ({ name: board.name, title: board.title ?? board.name, root: board.spec.root }))}
          selected={selected}
          onSelect={(items, mode) => {
            const usable = items.filter(item => {
              const board = geometry.find(row => row.name === item.board);
              return board && selectable(board.index, item.id);
            });
            if (mode === "replace") setSelected(usable);
            else if (mode === "add") merge(usable, true);
            else setSelected(previous => usable.reduce((list, item) => list.some(other => other.board === item.board && other.id === item.id)
              ? list.filter(other => other.board !== item.board || other.id !== item.id) : [...list, item], previous));
          }}
          apply={(board, before, after) => store.apply({ changes: [{ targetName: board, before: store.root(board) ?? before, after }] })} />} />
      <div id="design-page-panel" role={pages.length ? "tabpanel" : undefined}
        aria-labelledby={pages.length ? `design-page-${pages.findIndex(item => item.id === active)}` : undefined}
        style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
        {!boards.length && <p data-testid="design-empty" style={{ position: "absolute", zIndex: 1, top: 12, left: 12, pointerEvents: "none" }}>
          {t(context.isStatic ? "emptyCanvasStatic" : "emptyCanvas")}
        </p>}
        <div ref={navigation.viewport} data-testid="design-viewport" role="region" aria-label={t("canvasNavigation")}
          tabIndex={0} aria-keyshortcuts="H V F R O L T Delete Control+C Control+X Control+V Control+D Shift+0 Shift+1 Shift+2 Enter Shift+Enter Escape ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
          onPointerDown={event => {
            // Portal events can reach React before the viewport's native pan listener.
            if (event.defaultPrevented || hand || space.current || event.button !== 0 || event.pointerType === "touch" || editable(event)) return;
            event.currentTarget.focus({ preventScroll: true });
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = worldPoint(event.clientX, event.clientY);
            keys.current = { shift: event.shiftKey, alt: event.altKey };
            if (drawing && store.editable) {
              draw.current = { pointer: event.pointerId, tool: tool as DrawTool | "text", start, client: { x: event.clientX, y: event.clientY },
                hit: hitAt(event.clientX, event.clientY), moved: false };
              setHover(undefined);
              return;
            }
            const stopHandle = (event.target as Element).closest?.("[data-gradient-stop]")?.getAttribute("data-gradient-stop");
            if (stopHandle !== null && stopHandle !== undefined && store.editable && activeGradient && selected.length === 1) {
              const item = selected[0]!, board = geometry.find(row => row.name === item.board), world = navigation.world.current;
              const box = board && world ? measureNode(world, board, item.id) : undefined;
              const root = savedRoot(item.board);
              if (box && root) {
                transform.current = { pointer: event.pointerId, kind: "gradient", start, roots: new Map([[item.board, root]]),
                  ids: new Map([[item.board, [item.id]]]), boxes: new Map(), rotations: new Map(), positions: new Map(), angle: 0,
                  stop: { board: item.board, id: item.id, ...activeGradient, index: Number(stopHandle),
                    box: { cx: box.x + box.width / 2, cy: box.y + box.height / 2, width: box.width, height: box.height, rotation: box.rotation } } };
              }
              return;
            }
            const handle = (event.target as Element).closest?.("[data-handle]")?.getAttribute("data-handle");
            if (handle && store.editable) {
              beginTransform(event.pointerId, handle.startsWith("rotate-") ? "rotate" : "resize", selected, start,
                handle.startsWith("rotate-") ? undefined : handle as Handle);
              return;
            }
            const hit = hitAt(event.clientX, event.clientY), deep = event.ctrlKey || event.metaKey;
            // Pressing a node selects it at once so the same drag can move it.
            let moveItems: Selection[] | undefined;
            const item = hit && store.editable ? choose(hit, deep ? "deep" : "normal") : undefined;
            if (item && isSelected(item)) moveItems = selected;
            else if (item && !event.shiftKey) { moveItems = [item]; setSelected([item]); }
            gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
              start, hit, shift: event.shiftKey, deep, moved: false, moveItems };
            setHover(undefined);
          }}
          onPointerMove={event => {
            keys.current = { shift: event.shiftKey, alt: event.altKey };
            if (draw.current) {
              const drag = draw.current;
              if (drag.pointer !== event.pointerId) return;
              if (Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y) >= 3) drag.moved = true;
              if (drag.moved) {
                const box = drawBounds(drag.tool === "text" ? "rectangle" : drag.tool, drag.start, worldPoint(event.clientX, event.clientY),
                  { square: event.shiftKey, fromCenter: event.altKey });
                setMarquee({ x: Math.min(box.x, box.x + box.width), y: Math.min(box.y, box.y + box.height),
                  width: Math.abs(box.width), height: Math.abs(box.height) });
              }
              return;
            }
            if (drawing) return;
            if (transform.current) {
              if (transform.current.pointer === event.pointerId) updateTransform(event);
              return;
            }
            const drag = gesture.current;
            if (drag) {
              if (drag.pointer !== event.pointerId) return;
              if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 3) drag.moved = true;
              if (drag.moved && drag.hit && drag.moveItems?.length) {
                gesture.current = undefined;
                beginTransform(event.pointerId, "move", drag.moveItems, drag.start);
                // Alt+drag moves copies; the originals stay. Copy and move are one undo step.
                const started = transform.current as TransformGesture | undefined;
                if (event.altKey && started) {
                  const copies: Selection[] = [];
                  started.origins = new Map(started.roots);
                  for (const [name, root] of started.roots) {
                    const made = duplicate(root, started.ids.get(name) ?? [], 0, 0);
                    started.roots.set(name, made.root);
                    started.ids.set(name, made.ids);
                    copies.push(...made.ids.map(id => ({ board: name, id })));
                  }
                  started.positions.clear();
                  started.restore = drag.moveItems;
                  setSelected(copies);
                }
                updateTransform(event);
                return;
              }
              if (drag.moved && !drag.hit) {
                const end = worldPoint(event.clientX, event.clientY);
                setMarquee({ x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y),
                  width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) });
              }
            } else if (!event.buttons && !hand && !space.current && event.pointerType !== "touch") {
              const hit = hitAt(event.clientX, event.clientY), item = hit && choose(hit, "normal");
              setHover(item && !isSelected(item) ? item : undefined);
            } else setHover(undefined);
          }}
          onPointerUp={finishGesture}
          onPointerCancel={() => { draw.current = undefined; gesture.current = undefined; setMarquee(undefined); endTransform(false); }}
          onLostPointerCapture={() => { if (draw.current) return; gesture.current = undefined; setMarquee(undefined); endTransform(false); }}
          onPointerLeave={() => setHover(undefined)}
          onCopy={event => {
            if (editable(event)) return;
            const copied = copySelection();
            if (!copied) return;
            event.preventDefault();
            event.clipboardData.setData("text/plain", serialize(copied));
            clipboard.current = copied;
          }}
          onCut={event => {
            if (editable(event) || !store.editable) return;
            const copied = copySelection();
            if (!copied) return;
            event.preventDefault();
            event.clipboardData.setData("text/plain", serialize(copied));
            clipboard.current = copied;
            deleteNodes();
          }}
          onPaste={event => {
            if (editable(event) || !store.editable) return;
            const text = event.clipboardData.getData("text/plain");
            // Our nodes from the system clipboard, else (nothing readable there) this screen's own copy.
            const copied = text ? parseClipboard(text) : clipboard.current;
            if (!copied) return;
            event.preventDefault();
            pasteNodes(copied);
          }}
          onDragOver={event => { if (store.editable && context.uploadAsset && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDrop={event => {
            if (!store.editable || !context.uploadAsset || !event.dataTransfer.files.length) return;
            event.preventDefault();
            void placeImages(event.dataTransfer.files, { x: event.clientX, y: event.clientY });
          }}
          onDoubleClick={event => {
            if (!drawing && !hand && !space.current && !editable(event)) {
              const hit = hitAt(event.clientX, event.clientY);
              if (hit && startEditing(hit.board, hit.chain[0]!)) return;
            }
            if (drawing || hand || space.current || editable(event)) return;
            const hit = hitAt(event.clientX, event.clientY), item = hit && choose(hit, "enter");
            if (item) merge([item], event.shiftKey);
          }}
          onKeyDown={event => {
            if (!editable(event) && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "d" && store.editable) {
              event.preventDefault();
              duplicateSelection();
              return;
            }
            if (editable(event) || event.ctrlKey || event.metaKey || event.altKey) return;
            if ((event.key === "Delete" || event.key === "Backspace") && store.editable && selected.length &&
                selected.every(item => geometry.find(board => board.name === item.board)?.index.get(item.id)?.parentId !== undefined)) {
              event.preventDefault();
              deleteNodes();
              return;
            }
            const next = TOOL_KEYS[event.key.toLowerCase()];
            // H and V are the viewport's own keys (they switch the hand); F, R, O and L pick a drawing tool.
            if (next && next !== "hand" && next !== "select" && store.editable && context.createResourceNow && !event.shiftKey) { setTool(next); setHover(undefined); return; }
            if ((event.key === "Delete" || event.key === "Backspace") && store.editable && context.deleteResource && selected.length &&
                selected.every(item => geometry.find(board => board.name === item.board)?.index.get(item.id)?.parentId === undefined)) {
              event.preventDefault();
              setConfirmDelete([...new Set(selected.map(item => item.board))]);
              return;
            }
            if (event.key === "Escape" && drawing) { draw.current = undefined; setMarquee(undefined); setTool("select"); return; }
            const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key];
            if (arrow && store.editable && selected.length && !transform.current) {
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              nudge(arrow[0] * step, arrow[1] * step);
              return;
            }
            if (event.code === "Space") { space.current = true; setHover(undefined); }
            if (event.key.toLowerCase() === "h") setHover(undefined);
            if (event.key === "Escape" && endTransform(false)) return;
            if (event.key === "Escape") { setSelected([]); setHover(undefined); gesture.current = undefined; setMarquee(undefined); }
            if (event.key === "Enter" && !event.shiftKey && selected.length === 1 && startEditing(selected[0]!.board, selected[0]!.id)) {
              event.preventDefault();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              setSelected(geometry.flatMap(board => (event.shiftKey ? parents : children)(board.index,
                selected.filter(item => item.board === board.name).map(item => item.id)).map(id => ({ board: board.name, id }))));
              setHover(undefined);
            }
          }}
          onKeyUp={event => { if (event.code === "Space") space.current = false; }}
          onBlur={() => { space.current = false; }}
          style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", background: "#e5e7eb",
            color: "#1f2937", cursor: hand ? "grab" : drawing ? "crosshair" : "default" }}>
          <div ref={navigation.world} data-testid="design-board-stage" style={{
            position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0", willChange: "transform"
          }}>
            {boards.map(board => <BoardView key={board.name} board={board} context={resolution.context} fontsCss={fonts} locale={context.locale}
              editing={textEditing && editingText?.board === board.name ? textEditing : undefined} />)}
            {boards.map(board => <button key={board.name} type="button" data-testid={`design-board-label-${board.name}`}
              aria-pressed={isSelected({ board: board.name, id: board.spec.root.id })} style={{
                position: "absolute", left: board.spec.x, top: board.spec.y - 28, height: 24, minHeight: 24,
                padding: "0 4px", fontSize: 12, whiteSpace: "nowrap", color: "#1f2937", background: "#fff",
                border: isSelected({ board: board.name, id: board.spec.root.id }) ? "2px solid #1d4ed8" : "1px solid #64748b"
              }} onPointerDown={event => {
                // Dragging a board's label moves the board.
                if (!store.editable || hand || space.current || event.button !== 0 || event.pointerType === "touch") return;
                const index = geometry.find(item => item.name === board.name)!.index;
                if (!selectable(index, board.spec.root.id)) return;
                const item = { board: board.name, id: board.spec.root.id };
                const items = isSelected(item) ? selected : [item];
                if (!isSelected(item)) setSelected([item]);
                // Keys (Shift+2, Delete, arrows) go to the canvas, as after a click.
                event.preventDefault();
                navigation.viewport.current?.focus({ preventScroll: true });
                navigation.viewport.current?.setPointerCapture(event.pointerId);
                gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
                  start: worldPoint(event.clientX, event.clientY), hit: { board: board.name, chain: [board.spec.root.id] },
                  shift: false, deep: false, moved: false, moveItems: items };
              }} onClick={() => {
                if (selectable(geometry.find(item => item.name === board.name)!.index, board.spec.root.id))
                  setSelected([{ board: board.name, id: board.spec.root.id }]);
                navigation.viewport.current?.focus({ preventScroll: true });
              }}>{board.title ?? board.name}</button>)}
            <Notes notes={notes} />
            <Overlay world={navigation.world} boards={geometry} selection={selected} hover={hover} marquee={marquee}
              revision={preview ?? store.getSnapshot()} onBounds={setSelectionBounds} handles={handles} rotatable={rotatable}
              gradient={gradientItem && isGradient(gradientPaint) ? { item: gradientItem, paint: gradientPaint } : undefined} />
          </div>
        </div>
      </div>
      <Inspector context={inspector} />
    </div>
    {presenting && <Presentation data={data} start={presenting} context={resolution.context} fontsCss={fonts}
      locale={context.locale} onClose={() => { setPresenting(undefined); presentButton.current?.focus(); }} />}
  </section>;
}
