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
    hit?: { board: string; chain: string[] }; moved: boolean; shift: boolean; deep: boolean } | undefined>(undefined);
  const [hand, setHand] = useState(false);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
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
  const boards = data.boards.filter(board => board.spec?.root && onPageContent(board.spec));
  const notes = (data.canvas?.spec.notes ?? []).filter(onPageContent);
  const identity = (row: { name?: string; relativePath: string; hash?: string }) =>
    [row.name ?? row.relativePath, row.hash ?? row];
  const dependencyKey = JSON.stringify([data.canvas && identity(data.canvas),
    data.components.map(identity), data.styles.map(identity), data.tokenFiles.map(identity), modes]);
  const resolution = useMemo(() => canvasResolution(data, modes), [dependencyKey, store.getSnapshot()]);
  const geometry = useMemo(() => boards.map(board => ({ name: board.name, x: board.spec.x, y: board.spec.y,
    index: indexBoard(board.spec.root) })), [incoming.boards, active, store.getSnapshot()]);
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
  const finishGesture = (event: React.PointerEvent<HTMLDivElement>) => {
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
          tabIndex={0} aria-keyshortcuts="H V Shift+0 Shift+1 Shift+2 Enter Shift+Enter Escape"
          onPointerDown={event => {
            // Portal events can reach React before the viewport's native pan listener.
            if (event.defaultPrevented || hand || space.current || event.button !== 0 || event.pointerType === "touch" || editable(event)) return;
            event.currentTarget.focus({ preventScroll: true });
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
              start: worldPoint(event.clientX, event.clientY), hit: hitAt(event.clientX, event.clientY),
              shift: event.shiftKey, deep: event.ctrlKey || event.metaKey, moved: false };
            setHover(undefined);
          }}
          onPointerMove={event => {
            const drag = gesture.current;
            if (drag) {
              if (drag.pointer !== event.pointerId) return;
              if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 3) drag.moved = true;
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
          onPointerCancel={() => { gesture.current = undefined; setMarquee(undefined); }}
          onLostPointerCapture={() => { gesture.current = undefined; setMarquee(undefined); }}
          onPointerLeave={() => setHover(undefined)}
          onDoubleClick={event => {
            if (hand || space.current || editable(event)) return;
            const hit = hitAt(event.clientX, event.clientY), item = hit && choose(hit, "enter");
            if (item) merge([item], event.shiftKey);
          }}
          onKeyDown={event => {
            if (editable(event) || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.code === "Space") { space.current = true; setHover(undefined); }
            if (event.key.toLowerCase() === "h") setHover(undefined);
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
              revision={store.getSnapshot()} onBounds={setSelectionBounds} />
          </div>
        </div>
      </div>
    </div>
  </section>;
}
