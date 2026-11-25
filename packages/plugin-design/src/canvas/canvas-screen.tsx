import { useMemo, useState } from "react";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { BoardView, canvasResolution, type CanvasRendererData } from "../render/board-view.js";
import { fontFaceCss } from "../render/fonts.js";
import { CREATE_BOARD_COMMAND_ID } from "../model/index.js";
import { designText } from "../i18n.js";
import { Pages } from "./pages.js";
import { Notes } from "./notes.js";
import { useViewport } from "./viewport.js";

export function CanvasScreen({ context }: PluginViewProps) {
  const data = context.rendererData as unknown as CanvasRendererData;
  // Reset navigation and mode choices when the host opens another canvas.
  return <CanvasContent key={data.canvas?.name ?? ""} context={context} data={data} />;
}

function CanvasContent({ context, data }: PluginViewProps & { data: CanvasRendererData }) {
  const locale = context.locale === "ja" ? "ja" : "en";
  const t = (key: keyof typeof designText) => designText[key][locale];
  const [page, setPage] = useState(data.canvas?.spec.pages?.[0]?.id ?? "");
  const [selected, setSelected] = useState<string>();
  const [hand, setHand] = useState(false);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const pages = data.canvas?.spec.pages ?? [];
  const active = pages.some(item => item.id === page) ? page : pages[0]?.id ?? "";
  const onPage = (id: string) => { setPage(id); setSelected(undefined); };
  const onPageContent = (item: { page?: string }) => (item.page ?? pages[0]?.id ?? "") === active;
  const boards = data.boards.filter(board => board.spec?.root && onPageContent(board.spec));
  const notes = (data.canvas?.spec.notes ?? []).filter(onPageContent);
  const identity = (row: { name?: string; relativePath: string; hash?: string }) =>
    [row.name ?? row.relativePath, row.hash ?? row];
  const dependencyKey = JSON.stringify([data.canvas && identity(data.canvas),
    data.components.map(identity), data.styles.map(identity), data.tokenFiles.map(identity), modes]);
  const resolution = useMemo(() => canvasResolution(data, modes), [dependencyKey]);
  const fonts = fontFaceCss(data.canvas?.spec.fonts ?? []);
  const bounds = boards.map(board => ({ x: board.spec.x, y: board.spec.y,
    width: board.spec.root.width ?? 0, height: board.spec.root.height ?? 0 }));
  const navigation = useViewport({ hand, onHand: setHand, bounds: [...bounds,
    ...notes.map(note => ({ x: note.x, y: note.y, width: 280, height: note.kind === "title" ? 40 : 100 }))],
    selected: bounds[boards.findIndex(board => board.name === selected)], pageKey: active });
  return <section data-testid="design-canvas" aria-label={t("canvas")} style={{ padding: 12 }}>
    <h2>{data.canvas?.title ?? data.canvas?.name ?? t("canvas")}</h2>
    {data.notices?.length > 0 && <ul role="alert">{data.notices.map((notice, i) =>
      <li key={i}>{locale === "ja" ? notice.ja : notice.en}</li>)}</ul>}
    <div role="group" aria-label={t("navigation")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <button type="button" data-testid="design-hand" aria-pressed={hand} onClick={() => setHand(!hand)}>{t("hand")}</button>
      <button type="button" data-testid="design-zoom-reset" onClick={navigation.reset}>{t("actualSize")}</button>
      <button type="button" data-testid="design-zoom-fit" onClick={() => navigation.fit()}>{t("fitAll")}</button>
      <button type="button" data-testid="design-zoom-selection" disabled={!selected} onClick={() => navigation.fit(true)}>{t("fitSelection")}</button>
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
      {!context.isStatic && context.runCommand && <button type="button" data-testid="design-add-board" onClick={() => {
        void context.runCommand?.(CREATE_BOARD_COMMAND_ID, {}).then(result => setStatus(result?.ok === false ? result.message : ""));
      }}>{t("createBoard")}</button>}
      <span role="status">{status}</span>
    </div>
    <div style={{ display: "flex", height: "max(480px, 65vh)", border: "1px solid #cbd5e1" }}>
      {pages.length > 0 && <Pages pages={pages} active={active} onChange={onPage} locale={locale} />}
      <div id="design-page-panel" role={pages.length ? "tabpanel" : undefined}
        aria-labelledby={pages.length ? `design-page-${pages.findIndex(item => item.id === active)}` : undefined}
        style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
        {!boards.length && <p data-testid="design-empty" style={{ position: "absolute", zIndex: 1, top: 12, left: 12, pointerEvents: "none" }}>
          {t(context.isStatic ? "emptyCanvasStatic" : "emptyCanvas")}
        </p>}
        <div ref={navigation.viewport} data-testid="design-viewport" role="region" aria-label={t("canvasNavigation")}
          tabIndex={0} aria-keyshortcuts="H V Shift+0 Shift+1 Shift+2"
          style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", background: "#e5e7eb",
            color: "#1f2937", cursor: hand ? "grab" : "default" }}>
          <div ref={navigation.world} data-testid="design-board-stage" style={{
            position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0", willChange: "transform"
          }}>
            {boards.map(board => <BoardView key={board.name} board={board} context={resolution.context} fontsCss={fonts} locale={context.locale} />)}
            {boards.map(board => <button key={board.name} type="button" data-testid={`design-board-label-${board.name}`}
              aria-pressed={selected === board.name} style={{
                position: "absolute", left: board.spec.x, top: board.spec.y - 28, height: 24, minHeight: 24,
                padding: "0 4px", fontSize: 12, whiteSpace: "nowrap", color: "#1f2937", background: "#fff",
                border: selected === board.name ? "2px solid #1d4ed8" : "1px solid #64748b"
              }} onClick={() => {
                setSelected(board.name);
                navigation.viewport.current?.focus({ preventScroll: true });
              }}>{board.title ?? board.name}</button>)}
            <Notes notes={notes} />
          </div>
        </div>
      </div>
    </div>
  </section>;
}
