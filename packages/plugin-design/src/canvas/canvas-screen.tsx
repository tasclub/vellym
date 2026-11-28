import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { BoardView, canvasResolution, type CanvasRendererData } from "../render/board-view.js";
import { fontFaceCss } from "../render/fonts.js";
// @ts-expect-error esbuild imports stylesheets as text.
import canvasCss from "../design.css";
import { Pages } from "./pages.js";
import { Notes } from "./notes.js";
import { useViewport, type Bounds } from "./viewport.js";
import { useDesignEdit } from "../edit/use-edit.js";
import { children, indexBoard, parents, selectable, type Selection } from "../edit/selection.js";
import { Overlay } from "./overlay.js";
import { Presentation } from "./presentation.js";
import { Toolbar } from "../tools/toolbar.js";
import { TOOL_KEYS, type Tool } from "../tools/shape-tools.js";
import { Inspector } from "../panels/inspector.js";
import { LeftPanel } from "../panels/left-panel.js";
import { Layers } from "../panels/layers.js";
import type { PaintList } from "../panels/sections.js";
import { isGradient } from "../panels/gradient-axis.js";
import { type Handle } from "../edit/transform.js";
import { createModel, editableTarget } from "./model.js";
import { usePreviews, useTransform } from "./use-transform.js";
import { useSelection } from "./use-selection.js";
import { useDrawing } from "./use-drawing.js";
import { useClipboard } from "./use-clipboard.js";
import { inspectorContext } from "./inspector-context.js";
import { Rulers } from "./rulers.js";
import { distances, type Distance } from "../edit/snap.js";
import { enclosing, measureNode } from "./overlay.js";

export function CanvasScreen({ context }: PluginViewProps) {
  const data = context.rendererData as unknown as CanvasRendererData;
  // Reset navigation and mode choices when the host opens another canvas.
  return <CanvasContent key={data.canvas?.name ?? ""} context={context} data={data} />;
}

const ARROWS: Readonly<Record<string, [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Assembles the canvas: state shared through the model, and the parts that act on it (see use-*.ts). */
function CanvasContent({ context, data: incoming }: PluginViewProps & { data: CanvasRendererData }) {
  const { store, data, reloaded } = useDesignEdit(incoming, context);
  const locale = context.locale === "ja" ? "ja" : "en";
  const [page, setPage] = useState(data.canvas?.spec.pages?.[0]?.id ?? "");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [selectionBounds, setSelectionBounds] = useState<Bounds>();
  const [hover, setHover] = useState<Selection>();
  const [marquee, setMarquee] = useState<Bounds>();
  const [tool, setTool] = useState<Tool>("select");
  const [modes, setModes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [presenting, setPresenting] = useState<string>();
  const [activeGradient, setActiveGradient] = useState<{ list: PaintList; paint: number }>();
  const [rulers, setRulers] = useState(false);
  /** Alt+hover: distances from the selection to the node under the pointer. */
  const [measures, setMeasures] = useState<Distance[]>([]);
  useLayoutEffect(() => setActiveGradient(undefined), [selected]);
  const space = useRef(false);
  const presentButton = useRef<HTMLButtonElement>(null);
  const screen = useRef<HTMLElement>(null);
  const hand = tool === "hand", drawing = tool !== "select" && tool !== "hand";
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

  const previews = usePreviews();
  const { preview, previewPositions } = previews;
  const pages = data.canvas?.spec.pages ?? [];
  const active = pages.some(item => item.id === page) ? page : pages[0]?.id ?? "";
  const onPageContent = (item: { page?: string }) => (item.page ?? pages[0]?.id ?? "") === active;
  const saved = data.boards.filter(board => board.spec?.root && onPageContent(board.spec));
  // While dragging, the touched boards draw the previewed root (no hash, so they re-render).
  const boards = preview || previewPositions ? saved.map(board => {
    const root = preview?.get(board.name), position = previewPositions?.get(board.name);
    return root || position ? { ...board, hash: undefined, spec: { ...board.spec, ...(root ? { root } : {}), ...position } } : board;
  }) : saved;
  const notes = (data.canvas?.spec.notes ?? []).filter(onPageContent);
  const identity = (row: { name?: string; relativePath: string; hash?: string }) => [row.name ?? row.relativePath, row.hash ?? row];
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
  const navigation = useViewport({ hand, onHand: value => setTool(value ? "hand" : "select"), selected: selectionBounds, pageKey: active,
    bounds: [...boards.map(board => ({ x: board.spec.x, y: board.spec.y, width: board.spec.root.width ?? 0, height: board.spec.root.height ?? 0 })),
      ...notes.map(note => ({ x: note.x, y: note.y, width: 280, height: note.kind === "title" ? 40 : 100 }))] });

  const m = createModel({ context, store, data, locale, active, saved, boards, geometry, selected, setSelected,
    setHover, setMarquee, setStatus, world: navigation.world, viewport: navigation.viewport });
  const { t } = m;
  const transform = useTransform(m, previews);
  const selection = useSelection(m, (event, items, start) => {
    transform.begin(event.pointerId, "move", items, start);
    // Alt+drag moves copies; the originals stay. Copy and move are one undo step.
    if (event.altKey) transform.copyOnDrag(items);
    transform.update(event);
  });
  const drawn = useDrawing(m, tool, setTool);
  const clip = useClipboard(m);
  const onPage = (id: string) => { setPage(id); setSelected([]); setHover(undefined); selection.cancel(); };
  const gradientItem = activeGradient && selected.length === 1 ? selected[0] : undefined;
  const gradientPaint = gradientItem && geometry.find(row => row.name === gradientItem.board)?.index.get(gradientItem.id)?.node[activeGradient!.list]?.[activeGradient!.paint];
  const inspector = inspectorContext(m, { tokens: resolution.context.tokens ?? {}, editable: store.editable && !transform.transform.current,
    activeGradient, setActiveGradient, textRange: drawn.textRange, clearTextRange: () => drawn.setTextRange(undefined),
    arrange: clip.arrange, beforeChange: drawn.finishEditing });
  const measureTo = (event: { clientX: number; clientY: number }) => {
    const world = navigation.world.current, hit = m.hitAt(event.clientX, event.clientY), item = hit && m.choose(hit, "normal");
    if (!world || !item || !selected.length || m.isSelected(item)) { setMeasures([]); return; }
    const box = (target: Selection) => {
      const board = geometry.find(row => row.name === target.board), measured = board && measureNode(world, board, target.id);
      return measured && enclosing(measured);
    };
    const own = selected.map(box).filter(value => value !== undefined), other = box(item);
    if (!own.length || !other) { setMeasures([]); return; }
    const x = Math.min(...own.map(b => b.x)), y = Math.min(...own.map(b => b.y));
    setMeasures(distances({ x, y, width: Math.max(...own.map(b => b.x + b.width)) - x, height: Math.max(...own.map(b => b.y + b.height)) - y }, other));
  };
  const boardRoot = (name: string) => saved.find(board => board.name === name)?.spec.root.id;
  const onlyNodes = selected.length > 0 && selected.every(item => geometry.find(board => board.name === item.board)?.index.get(item.id)?.parentId !== undefined);
  const onlyBoards = selected.length > 0 && selected.every(item => boardRoot(item.board) === item.id);

  return <section ref={screen} className="design-canvas-screen" data-testid="design-canvas" aria-label={t("canvas")}>
    <style>{canvasCss}</style>
    {reloaded && <p role="alert" data-testid="design-reloaded">{t("externalReload")}</p>}
    {data.notices?.length > 0 && <div role="alert"><ul>{data.notices.map((notice, i) =>
      <li key={i}>{locale === "ja" ? notice.ja : notice.en}</li>)}</ul></div>}
    <div className="design-canvas-tools" role="group" aria-label={t("navigation")}>
      {/* Drawing needs a saved canvas: an unsaved draft cannot hold boards yet (no createResourceNow). */}
      <Toolbar tool={tool} onTool={next => { setTool(next); setHover(undefined); }} locale={locale}
        editable={store.editable && !!context.createResourceNow} onImage={context.uploadAsset ? files => { void drawn.placeImages(files); } : undefined} />
      <button type="button" data-testid="design-zoom-reset" onClick={navigation.reset}>{t("actualSize")}</button>
      <button type="button" data-testid="design-zoom-fit" onClick={() => navigation.fit()}>{t("fitAll")}</button>
      <button type="button" data-testid="design-zoom-selection" disabled={!selected.length} onClick={() => navigation.fit(true)}>{t("fitSelection")}</button>
      <output ref={navigation.zoomLabel} aria-label={t("zoom")} data-testid="design-zoom">100%</output>
      <button type="button" data-testid="design-rulers-toggle" aria-pressed={rulers} onClick={() => setRulers(value => !value)}>{t("rulers")}</button>
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
        disabled={drawn.busy} onClick={() => { void drawn.addBoard(); }}>{t("createBoard")}</button>}
      {drawn.confirmDelete && <div className="design-confirm" role="alertdialog" aria-modal="false"
        aria-labelledby="design-confirm-text" data-testid="design-confirm-delete"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); drawn.setConfirmDelete(undefined); navigation.viewport.current?.focus(); } }}>
        <p id="design-confirm-text">{drawn.confirmDelete.length === 1
          ? t("deleteBoardConfirm").replace("{name}", saved.find(board => board.name === drawn.confirmDelete![0])?.title ?? drawn.confirmDelete[0]!)
          : t("deleteBoardsConfirm").replace("{count}", String(drawn.confirmDelete.length))}</p>
        <div>
          <button ref={drawn.cancelDelete} type="button" data-testid="design-confirm-cancel"
            onClick={() => { drawn.setConfirmDelete(undefined); navigation.viewport.current?.focus(); }}>{t("cancel")}</button>
          <button type="button" data-testid="design-confirm-ok" onClick={() => { void drawn.deleteBoards(drawn.confirmDelete!); }}>{t("deleteConfirm")}</button>
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
        layers={<Layers locale={locale} editable={store.editable && !transform.transform.current}
          boards={boards.map(board => ({ name: board.name, title: board.title ?? board.name, root: board.spec.root }))}
          selected={selected}
          onSelect={(items, mode) => {
            const usable = items.filter(item => {
              const board = geometry.find(row => row.name === item.board);
              return board && selectable(board.index, item.id);
            });
            if (mode === "replace") setSelected(usable);
            else if (mode === "add") m.merge(usable, true);
            else setSelected(previous => usable.reduce((list, item) => list.some(other => other.board === item.board && other.id === item.id)
              ? list.filter(other => other.board !== item.board || other.id !== item.id) : [...list, item], previous));
          }}
          apply={(board, before, after) => store.apply({ changes: [{ targetName: board, before: store.root(board) ?? before, after }] })} />} />
      <div id="design-page-panel" role={pages.length ? "tabpanel" : undefined}
        aria-labelledby={pages.length ? `design-page-${pages.findIndex(item => item.id === active)}` : undefined}
        style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
        {rulers && <Rulers world={navigation.world} />}
        {!boards.length && <p data-testid="design-empty" style={{ position: "absolute", zIndex: 1, top: 12, left: 12, pointerEvents: "none" }}>
          {t(context.isStatic ? "emptyCanvasStatic" : "emptyCanvas")}
        </p>}
        <div ref={navigation.viewport} data-testid="design-viewport" role="region" aria-label={t("canvasNavigation")}
          tabIndex={0} aria-keyshortcuts="H V F R O L T Shift+R Delete Control+C Control+X Control+V Control+D Shift+0 Shift+1 Shift+2 Enter Shift+Enter Escape ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
          onPointerDown={event => {
            // Portal events can reach React before the viewport's native pan listener.
            if (event.defaultPrevented || hand || space.current || event.button !== 0 || event.pointerType === "touch" || editableTarget(event)) return;
            event.currentTarget.focus({ preventScroll: true });
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = m.worldPoint(event.clientX, event.clientY);
            drawn.keys.current = { shift: event.shiftKey, alt: event.altKey };
            if (drawing && store.editable) { drawn.beginDraw(event.pointerId, start, { x: event.clientX, y: event.clientY }); return; }
            const stop = (event.target as Element).closest?.("[data-gradient-stop]")?.getAttribute("data-gradient-stop");
            if (stop !== null && stop !== undefined && store.editable && activeGradient && selected.length === 1) {
              transform.beginStop(event.pointerId, start, activeGradient, Number(stop));
              return;
            }
            const handle = (event.target as Element).closest?.("[data-handle]")?.getAttribute("data-handle");
            if (handle && store.editable) {
              transform.begin(event.pointerId, handle.startsWith("rotate-") ? "rotate" : "resize", selected, start,
                handle.startsWith("rotate-") ? undefined : handle as Handle);
              return;
            }
            selection.press(event, start);
          }}
          onPointerMove={event => {
            drawn.keys.current = { shift: event.shiftKey, alt: event.altKey };
            if (drawn.draw.current) { drawn.moveDraw(event); return; }
            if (drawing) return;
            if (transform.transform.current) {
              if (transform.transform.current.pointer === event.pointerId) transform.update(event);
              return;
            }
            if (selection.move(event)) return;
            if (!event.buttons && !hand && !space.current && event.pointerType !== "touch") {
              selection.hover(event);
              if (event.altKey) measureTo(event); else if (measures.length) setMeasures([]);
            } else setHover(undefined);
          }}
          onPointerUp={event => {
            if (drawn.draw.current?.pointer === event.pointerId) { drawn.finishDraw(m.worldPoint(event.clientX, event.clientY)); return; }
            if (transform.transform.current?.pointer === event.pointerId) { transform.end(true); return; }
            selection.release(event);
          }}
          onPointerCancel={() => { drawn.cancelDraw(); selection.cancel(); transform.end(false); }}
          onLostPointerCapture={() => { if (drawn.draw.current) return; selection.cancel(); transform.end(false); }}
          onPointerLeave={() => { setHover(undefined); setMeasures([]); }}
          {...clip.events}
          onDragOver={event => { if (store.editable && context.uploadAsset && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDrop={event => {
            if (!store.editable || !context.uploadAsset || !event.dataTransfer.files.length) return;
            event.preventDefault();
            void drawn.placeImages(event.dataTransfer.files, { x: event.clientX, y: event.clientY });
          }}
          onDoubleClick={event => {
            if (drawing || hand || space.current || editableTarget(event)) return;
            const hit = m.hitAt(event.clientX, event.clientY);
            if (hit && drawn.startEditing(hit.board, hit.chain[0]!)) return;
            const item = hit && m.choose(hit, "enter");
            if (item) m.merge([item], event.shiftKey);
          }}
          onKeyDown={event => {
            if (!editableTarget(event) && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "d" && store.editable) {
              event.preventDefault();
              clip.duplicateSelection();
              return;
            }
            if (event.key === "Alt" && !editableTarget(event)) event.preventDefault();
            if (editableTarget(event) || event.ctrlKey || event.metaKey || event.altKey) return;
            if ((event.key === "Delete" || event.key === "Backspace") && store.editable && onlyNodes) {
              event.preventDefault();
              clip.deleteNodes();
              return;
            }
            if (event.shiftKey && event.key.toLowerCase() === "r") { event.preventDefault(); setRulers(value => !value); return; }
            const next = TOOL_KEYS[event.key.toLowerCase()];
            // H and V are the viewport's own keys (they switch the hand); F, R, O, L and T pick a drawing tool.
            if (next && next !== "hand" && next !== "select" && store.editable && context.createResourceNow && !event.shiftKey) { setTool(next); setHover(undefined); return; }
            if ((event.key === "Delete" || event.key === "Backspace") && store.editable && context.deleteResource && onlyBoards) {
              event.preventDefault();
              drawn.setConfirmDelete([...new Set(selected.map(item => item.board))]);
              return;
            }
            if (event.key === "Escape" && drawing) { drawn.cancelDraw(); setTool("select"); return; }
            const arrow = ARROWS[event.key];
            if (arrow && store.editable && selected.length && !transform.transform.current) {
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              transform.nudge(arrow[0] * step, arrow[1] * step);
              return;
            }
            if (event.code === "Space") { space.current = true; setHover(undefined); }
            if (event.key.toLowerCase() === "h") setHover(undefined);
            if (event.key === "Escape" && transform.end(false)) return;
            if (event.key === "Escape") { setSelected([]); setHover(undefined); selection.cancel(); }
            if (event.key === "Enter" && !event.shiftKey && selected.length === 1 && drawn.startEditing(selected[0]!.board, selected[0]!.id)) {
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
          onKeyUp={event => { if (event.code === "Space") space.current = false; if (event.key === "Alt") setMeasures([]); }}
          onBlur={() => { space.current = false; }}
          style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", background: "#e5e7eb",
            color: "#1f2937", cursor: hand ? "grab" : drawing ? "crosshair" : "default" }}>
          <div ref={navigation.world} data-testid="design-board-stage" style={{
            position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0", willChange: "transform"
          }}>
            {boards.map(board => <BoardView key={board.name} board={board} context={resolution.context} fontsCss={fonts} locale={context.locale}
              editing={drawn.textEditing && drawn.editingText?.board === board.name ? drawn.textEditing : undefined} />)}
            {boards.map(board => {
              const root = { board: board.name, id: board.spec.root.id };
              return <button key={board.name} type="button" data-testid={`design-board-label-${board.name}`}
                aria-pressed={m.isSelected(root)} style={{
                  position: "absolute", left: board.spec.x, top: board.spec.y - 28, height: 24, minHeight: 24,
                  padding: "0 4px", fontSize: 12, whiteSpace: "nowrap", color: "#1f2937", background: "#fff",
                  border: m.isSelected(root) ? "2px solid #1d4ed8" : "1px solid #64748b"
                }} onPointerDown={event => {
                  // Dragging a board's label moves the board.
                  if (!store.editable || hand || space.current || event.button !== 0 || event.pointerType === "touch") return;
                  if (!selection.pressLabel(event, board)) return;
                  // Keys (Shift+2, Delete, arrows) go to the canvas, as after a click.
                  event.preventDefault();
                  navigation.viewport.current?.focus({ preventScroll: true });
                  navigation.viewport.current?.setPointerCapture(event.pointerId);
                }} onClick={() => {
                  if (selectable(geometry.find(item => item.name === board.name)!.index, board.spec.root.id)) setSelected([root]);
                  navigation.viewport.current?.focus({ preventScroll: true });
                }}>{board.title ?? board.name}</button>;
            })}
            <Notes notes={notes} />
            <Overlay world={navigation.world} boards={geometry} selection={selected} hover={hover} marquee={marquee}
              revision={preview ?? store.getSnapshot()} onBounds={setSelectionBounds} handles={transform.handles} rotatable={transform.rotatable}
              gradient={gradientItem && isGradient(gradientPaint) ? { item: gradientItem, paint: gradientPaint } : undefined}
              guides={previews.marks?.guides} gaps={previews.marks?.gaps} measures={measures} />
          </div>
        </div>
      </div>
      <Inspector context={inspector} />
    </div>
    {presenting && <Presentation data={data} start={presenting} context={resolution.context} fontsCss={fonts}
      locale={context.locale} onClose={() => { setPresenting(undefined); presentButton.current?.focus(); }} />}
  </section>;
}
