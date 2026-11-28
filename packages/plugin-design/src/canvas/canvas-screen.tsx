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
import { angleOf, HANDLES, moveNodes, movable, resizable, resizeNodes, rotateNodes,
  type Handle, type WorldBox } from "../edit/transform.js";

/** A drag of the selection: the model changes only on release (one undo step). */
interface TransformGesture {
  pointer: number; kind: "move" | "resize" | "rotate"; handle?: Handle;
  start: { x: number; y: number }; roots: Map<string, DesignNode>; ids: Map<string, string[]>;
  boxes: Map<string, Map<string, WorldBox>>; frame?: WorldBox; angle: number;
  rotations: Map<string, Map<string, number>>; next?: Map<string, DesignNode>;
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
  const [hand, setHand] = useState(false);
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
  const boards = preview ? saved.map(board => preview.has(board.name)
    ? { ...board, hash: undefined, spec: { ...board.spec, root: preview.get(board.name)! } } : board) : saved;
  const notes = (data.canvas?.spec.notes ?? []).filter(onPageContent);
  const identity = (row: { name?: string; relativePath: string; hash?: string }) =>
    [row.name ?? row.relativePath, row.hash ?? row];
  const dependencyKey = JSON.stringify([data.canvas && identity(data.canvas),
    data.components.map(identity), data.styles.map(identity), data.tokenFiles.map(identity), modes]);
  const resolution = useMemo(() => canvasResolution(data, modes), [dependencyKey, store.getSnapshot()]);
  const geometry = useMemo(() => boards.map(board => ({ name: board.name, x: board.spec.x, y: board.spec.y,
    index: indexBoard(board.spec.root) })), [incoming.boards, active, store.getSnapshot(), preview]);
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
    transform.current = { pointer, kind, handle, start, roots, ids, boxes, frame, rotations,
      angle: angleOf(centre.cx, centre.cy, start.x, start.y) };
    setHover(undefined);
  };
  const updateTransform = (event: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) => {
    const drag = transform.current;
    if (!drag) return;
    const point = worldPoint(event.clientX, event.clientY), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    const centre = drag.frame ?? [...drag.boxes.values()].flatMap(map => [...map.values()])[0]!;
    const delta = angleOf(centre.cx, centre.cy, point.x, point.y) - drag.angle;
    const next = new Map<string, DesignNode>();
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
    if (commit && drag.next?.size) {
      store.apply({ changes: [...drag.next].map(([targetName, after]) =>
        ({ targetName, before: drag.roots.get(targetName)!, after })) });
    }
    setPreview(undefined);
    return true;
  };
  const nudge = (dx: number, dy: number) => {
    const changes = [...byBoard(selected)].flatMap(([name, ids]) => {
      const before = savedRoot(name);
      const after = before && moveNodes(before, ids, dx, dy);
      return before && after && after !== before ? [{ targetName: name, before, after }] : [];
    });
    // Held or repeated arrows within the history's merge window become one undo step.
    if (changes.length) store.apply({ changes, mergeKey: `nudge:${selected.map(item => `${item.board}/${item.id}`).sort().join(",")}` });
  };
  const finishGesture = (event: React.PointerEvent<HTMLDivElement>) => {
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
  const addBoard = async () => {
    if (busy || !context.createResourceNow || !data.canvas) return;
    setBusy(true);
    setStatus("");
    try {
      const x = Math.max(0, ...boards.map(board => board.spec.x + (board.spec.root.width ?? 0) + 80));
      const result = await context.createResourceNow({
        kind: DESIGN_BOARD_KIND, name: boardResourceName(data.canvas.name),
        title: t("boardName").replace("{number}", String(data.boards.length + 1)),
        folder: [folderOf(data.canvas.relativePath), "+boards"].filter(Boolean).join("/"),
        spec: { canvas: data.canvas.name, ...(active ? { page: active } : {}), x, y: 0,
          root: { id: "root", type: "frame", width: 390, height: 844, children: [] } }
      });
      if (!result.ok) setStatus(result.message);
    } catch {
      setStatus(t("createBoardFailed"));
    } finally {
      setBusy(false);
    }
  };
  return <section ref={screen} className="design-canvas-screen" data-testid="design-canvas" aria-label={t("canvas")}>
    <style>{canvasCss}</style>
    {reloaded && <p role="alert" data-testid="design-reloaded">{t("externalReload")}</p>}
    {data.notices?.length > 0 && <ul role="alert">{data.notices.map((notice, i) =>
      <li key={i}>{locale === "ja" ? notice.ja : notice.en}</li>)}</ul>}
    <div className="design-canvas-tools" role="group" aria-label={t("navigation")}>
      <button type="button" data-testid="design-hand" aria-pressed={hand} onClick={() => setHand(!hand)}>{t("hand")}</button>
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
      <span role="status">{status}</span>
      <span role="status" data-testid="design-selection-status">{selected.length ? t("selectedCount").replace("{count}", String(selected.length)) : ""}</span>
      {store.editable && <span role="status" data-testid="design-save-status" data-state={store.status}>
        {store.status ? t(store.status) : ""}{store.error ? `: ${store.error}` : ""}
      </span>}
    </div>
    <div className="design-canvas-frame">
      {pages.length > 0 && <Pages pages={pages} active={active} onChange={onPage} locale={locale} />}
      <div id="design-page-panel" role={pages.length ? "tabpanel" : undefined}
        aria-labelledby={pages.length ? `design-page-${pages.findIndex(item => item.id === active)}` : undefined}
        style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
        {!boards.length && <p data-testid="design-empty" style={{ position: "absolute", zIndex: 1, top: 12, left: 12, pointerEvents: "none" }}>
          {t(context.isStatic ? "emptyCanvasStatic" : "emptyCanvas")}
        </p>}
        <div ref={navigation.viewport} data-testid="design-viewport" role="region" aria-label={t("canvasNavigation")}
          tabIndex={0} aria-keyshortcuts="H V Shift+0 Shift+1 Shift+2 Enter Shift+Enter Escape ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
          onPointerDown={event => {
            // Portal events can reach React before the viewport's native pan listener.
            if (event.defaultPrevented || hand || space.current || event.button !== 0 || event.pointerType === "touch" || editable(event)) return;
            event.currentTarget.focus({ preventScroll: true });
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = worldPoint(event.clientX, event.clientY);
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
          onPointerCancel={() => { gesture.current = undefined; setMarquee(undefined); endTransform(false); }}
          onLostPointerCapture={() => { gesture.current = undefined; setMarquee(undefined); endTransform(false); }}
          onPointerLeave={() => setHover(undefined)}
          onDoubleClick={event => {
            if (hand || space.current || editable(event)) return;
            const hit = hitAt(event.clientX, event.clientY), item = hit && choose(hit, "enter");
            if (item) merge([item], event.shiftKey);
          }}
          onKeyDown={event => {
            if (editable(event) || event.ctrlKey || event.metaKey || event.altKey) return;
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
            color: "#1f2937", cursor: hand ? "grab" : "default" }}>
          <div ref={navigation.world} data-testid="design-board-stage" style={{
            position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0", willChange: "transform"
          }}>
            {boards.map(board => <BoardView key={board.name} board={board} context={resolution.context} fontsCss={fonts} locale={context.locale} />)}
            {boards.map(board => <button key={board.name} type="button" data-testid={`design-board-label-${board.name}`}
              aria-pressed={isSelected({ board: board.name, id: board.spec.root.id })} style={{
                position: "absolute", left: board.spec.x, top: board.spec.y - 28, height: 24, minHeight: 24,
                padding: "0 4px", fontSize: 12, whiteSpace: "nowrap", color: "#1f2937", background: "#fff",
                border: isSelected({ board: board.name, id: board.spec.root.id }) ? "2px solid #1d4ed8" : "1px solid #64748b"
              }} onClick={() => {
                if (selectable(geometry.find(item => item.name === board.name)!.index, board.spec.root.id))
                  setSelected([{ board: board.name, id: board.spec.root.id }]);
                navigation.viewport.current?.focus({ preventScroll: true });
              }}>{board.title ?? board.name}</button>)}
            <Notes notes={notes} />
            <Overlay world={navigation.world} boards={geometry} selection={selected} hover={hover} marquee={marquee}
              revision={preview ?? store.getSnapshot()} onBounds={setSelectionBounds} handles={handles} rotatable={rotatable} />
          </div>
        </div>
      </div>
    </div>
    {presenting && <Presentation data={data} start={presenting} context={resolution.context} fontsCss={fonts}
      locale={context.locale} onClose={() => { setPresenting(undefined); presentButton.current?.focus(); }} />}
  </section>;
}
