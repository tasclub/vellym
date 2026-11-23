import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { resolveLocalizedText, summarizeRows, type PluginIndexRow, type PluginRenderContext } from "@vellym/plugin-api";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { Button, ChoiceControl, InputControl } from "@vellym/plugin-api/ui";
import { buildTicketHierarchy, fieldKey } from "@vellym-internal/ticket-engine";
import { excludedParents, rankForAppend, rankForInsert, flattenRows, rowWindow, type WBSRow } from "./model.js";
import { buildTimeline, parseDate, timelineBar, DAY_MS, mondayOnOrBefore, presetRange, TIMELINE_PRESETS, timelineCells,
  timelinePreset, type Timeline, type TimelineMode, type TimelinePreset } from "./timeline.js";
import type { WBSRendererData } from "./view.js";

const label = (ja: string, en: string, locale: string) => resolveLocalizedText({ ja, en }, locale);
const date = (value: unknown): string | undefined =>
  parseDate(value) !== undefined ? value as string : undefined;

type Panes = { title: boolean; details: boolean; schedule: boolean };
function readPanes(value: unknown): Panes {
  const defaults = { title: true, details: true, schedule: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const panes = value as Record<string, unknown>;
  if (typeof panes.title !== "boolean" || typeof panes.details !== "boolean" ||
      typeof panes.schedule !== "boolean" || !(panes.title || panes.details || panes.schedule)) return defaults;
  return { title: panes.title, details: panes.details, schedule: panes.schedule };
}

function TimelineTrack({ timeline, start, end, locale, closed, onReveal }: {
  timeline?: Timeline;
  start: unknown;
  end: unknown;
  locale: string;
  closed?: boolean;
  onReveal(timestamp: number): void;
}) {
  const s = parseDate(start), e = parseDate(end);
  const short = (value: unknown) => String(value).slice(5);
  if (s !== undefined && e !== undefined && e < s) return <strong className="wbs-date-error" data-schedule="invalid">{label(
    `△ 終了日が開始日より前です（開始 ${short(start)} ／ 終了 ${short(end)}）`,
    `△ End date precedes start date (start ${short(start)} / end ${short(end)})`, locale)}</strong>;
  if (!timeline || (s === undefined && e === undefined)) return <span data-schedule="none">{label("— 日程なし", "— No dates", locale)}</span>;
  const bar = timelineBar(timeline, start, end);
  const kind = s === undefined ? "end-only" : e === undefined ? "start-only" : "period";
  const text = s === undefined ? label(`開始日なし・終了 ${short(end)}`, `No start date · End ${short(end)}`, locale)
    : e === undefined ? label(`開始 ${short(start)}・終了日なし`, `Start ${short(start)} · No end date`, locale)
    : `${closed ? "✓ " : ""}${short(start)}–${short(end)}`;
  if (bar?.outside) return <div className={`wbs-track wbs-outside-${bar.outside}`} data-schedule={`outside-${bar.outside}`}>
    <Button onClick={() => onReveal(bar.outside === "before" ? e ?? s! : s ?? e!)}>{bar.outside === "before"
      ? label(`◀ 表示期間より前 ${text}`, `◀ Before range ${text}`, locale)
      : label(`表示期間より後 ${text} ▶`, `After range ${text} ▶`, locale)}</Button></div>;
  return <div className="wbs-track" aria-label={bar ? `${String(start ?? "")} – ${String(end ?? "")}` : label("日程未設定", "No dates", locale)}>
    {bar ? <>
      <span aria-hidden="true" className="wbs-bar" data-schedule={kind} data-closed={closed || undefined}
        data-before={bar.before || undefined} data-after={bar.after || undefined}
        style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
      <span className="wbs-bar-label" style={bar.left + bar.width < 65
        ? { left: `${bar.left + bar.width}%` } : bar.left > 35 ? { right: `${100 - bar.left}%` } : { left: `${bar.left}%` }}>
        {bar.before ? `◀ ${short(start ?? end)} ` : ""}{text}{bar.after ? ` ${short(end ?? start)} ▶` : ""}</span>
    </> : null}
  </div>;
}

function statusSymbol(data: WBSRendererData, id: unknown, category?: string): string {
  const symbol = typeof id === "string" && Object.hasOwn(data.statusSymbols ?? {}, id) ? data.statusSymbols?.[id] : undefined;
  return symbol?.trim() ? symbol : category === "closed" ? "✓" : "□";
}

/** Indent steps belong to nested structure, never a calculated per-row padding. */
function Indent({ depth, children }: { depth: number; children: ReactNode }) {
  let content = children;
  for (let level = depth; level > 0; level--) {
    content = <span className="wbs-indent" data-indent-level={level}>{content}</span>;
  }
  return content;
}

function WBSRows({ items, data, context, all, review, timeline, panes, busy, movedName, collapsed, onToggle, onParent, onOrder, onDropOrder, onRenumber, onCreate, onReveal }: {
  items: readonly WBSRow[];
  data: WBSRendererData;
  context: PluginRenderContext;
  all: readonly PluginIndexRow[];
  review: ReadonlySet<string>;
  movedName?: string;
  timeline?: Timeline;
  panes: Panes;
  busy: boolean;
  collapsed: ReadonlySet<string>;
  onToggle(name: string): void;
  onParent(row: PluginIndexRow, parent: string): void;
  onOrder(rows: readonly PluginIndexRow[], index: number, delta: -1 | 1): void;
  onDropOrder(rows: readonly PluginIndexRow[], dragged: string, target: number, after: boolean): void;
  onRenumber(rows: readonly PluginIndexRow[]): void;
  onCreate(parent?: string): void;
  onReveal(timestamp: number): void;
}) {
  const [editingParent, setEditingParent] = useState<string>();
  const [menu, setMenu] = useState<string>();
  const [menuPosition, setMenuPosition] = useState({ left: "8px", top: "8px" });
  const [dropPosition, setDropPosition] = useState<{ name: string; after: boolean }>();
  const editable = !context.isStatic && !context.target?.readOnly;
  const byName = new Map(all.map((row) => [row.name, row]));
  function reviewNote(row: PluginIndexRow): string {
    const seen = new Set<string>();
    const chain: string[] = [];
    let current: PluginIndexRow | undefined = row;
    while (current && !seen.has(current.name)) {
      seen.add(current.name);
      chain.push(String(current.values.number ?? current.name));
      const parent = data.parentField ? current.values[fieldKey(data.parentField)] : undefined;
      if (typeof parent !== "string" || !parent) break;
      if (!byName.has(parent)) return label(`親 ${parent} が見つかりません`, `Parent ${parent} not found`, context.locale);
      current = byName.get(parent);
    }
    return `△ ${chain.join(" → ")}${current ? ` → ${String(current.values.number ?? current.name)}` : ""}`;
  }
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".wbs-row-menu, .wbs-actions")) {
        setMenu(undefined); setEditingParent(undefined);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  return <>{items.map(({ node, depth, siblings: rows, index }) => {
        const row = node.row;
        const start = data.startField ? date(row.values[fieldKey(data.startField)]) : undefined;
        const end = data.endField ? date(row.values[fieldKey(data.endField)]) : undefined;
        const parent = data.parentField ? row.values[fieldKey(data.parentField)] : undefined;
        const status = data.tracker?.statuses.find((item) => item.id === row.values.status);
         const needsReview = review.has(row.name);
         const descendants = editingParent === row.name && data.parentField
           ? excludedParents(all, row.name, data.parentField) : new Set<string>();
         const dropTarget = editable && !needsReview && data.orderField ? {
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            setDropPosition((current) => current?.name === row.name && current.after === after
              ? current : { name: row.name, after });
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setDropPosition(undefined);
            const rect = event.currentTarget.getBoundingClientRect();
            onDropOrder(rows, event.dataTransfer.getData("text/plain"), index,
              event.clientY > rect.top + rect.height / 2);
          }
        } : {};
        return <div key={row.name} role="row" aria-level={depth + 1}
          aria-expanded={node.children.length ? !collapsed.has(row.name) : undefined}
           data-ticket-name={row.name} data-wbs-level={depth} className="wbs-row"
           data-moved={movedName === row.name || undefined} data-review={needsReview || undefined}
          data-drop={dropPosition?.name === row.name ? (dropPosition.after ? "after" : "before") : undefined}>
          {panes.title ? <div role="gridcell" className="wbs-left" {...dropTarget}>
          <Indent depth={depth}><span className="wbs-cell-content">
          <span className="wbs-toggle">{node.children.length ? <Button icon
            aria-label={`${row.title}: ${label("展開・折りたたみ", "Toggle children", context.locale)}`}
            aria-expanded={!collapsed.has(row.name)} onClick={() => onToggle(row.name)}>
            {collapsed.has(row.name) ? "▸" : "▾"}</Button> : null}</span>
          {depth >= 4 ? <span className="wbs-level-badge">L{depth + 1}</span> : null}
          <span className="wbs-number">{String(row.values.number ?? "")}</span>
           <Button className="wbs-title" onClick={() => void context.openResource(row.name)}>{row.title || row.name}</Button>
           {needsReview && !context.isStatic ? <span className="wbs-review-note" title={reviewNote(row)}>{reviewNote(row)}</span> : null}
          <span className="wbs-actions">
           {editable && !needsReview && data.orderField && rows.length > 1 ? <Button icon draggable={!busy} disabled={busy}
            aria-label={`${row.title}: ${label("ドラッグして順序を変更", "Drag to reorder", context.locale)}`}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onKeyDown={(event) => {
              if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                event.preventDefault();
                onOrder(rows, index, event.key === "ArrowUp" ? -1 : 1);
              }
            }}
            onDragStart={(event) => event.dataTransfer.setData("text/plain", row.name)}>⠿</Button> : null}
           <Button icon aria-label={`${row.title}: ${label("行の操作", "Row actions", context.locale)}`}
             aria-expanded={menu === row.name}
             onClick={(event) => {
               const rect = event.currentTarget.getBoundingClientRect();
               setMenuPosition({ left: `clamp(8px, ${rect.left}px, max(8px, calc(100vw - 368px)))`,
                 top: `clamp(8px, ${rect.bottom}px, max(8px, calc(100dvh - 370px)))` });
               setMenu(menu === row.name ? undefined : row.name); setEditingParent(undefined);
             }}>⋯</Button>
          </span>
           </span></Indent>
            {menu === row.name ? <div role="group" aria-label={label("行の操作", "Row actions", context.locale)}
              className="wbs-row-menu" style={menuPosition} onKeyDown={(event) => { if (event.key === "Escape") { setMenu(undefined); setEditingParent(undefined); } }}>
              <Button onClick={() => void context.openResource(row.name)}>{label("詳細", "Details", context.locale)}</Button>
              {editable ? <>
                {!needsReview && data.orderField ? <>
                  <Button disabled={busy || index === 0} onClick={() => { onOrder(rows, index, -1); setMenu(undefined); }}>{label("上へ", "Move up", context.locale)}</Button>
                  <Button disabled={busy || index === rows.length - 1} onClick={() => { onOrder(rows, index, 1); setMenu(undefined); }}>{label("下へ", "Move down", context.locale)}</Button>
                </> : null}
                {data.parentField ? <>
                  <Button disabled={busy} onClick={() => setEditingParent(row.name)}>{label("親を変更…", "Change parent…", context.locale)}</Button>
                  {needsReview ? <Button disabled={busy} onClick={() => { onParent(row, ""); setMenu(undefined); }}>{label("親を空にして最上位へ", "Clear parent and move to top level", context.locale)}</Button> : null}
                  {!needsReview && context.runCommand ? <Button disabled={busy} onClick={() => { onCreate(row.name); setMenu(undefined); }}>{label("子チケットを追加", "Add child task", context.locale)}</Button> : null}
                </> : null}
              </> : null}
               {needsReview && !context.isStatic ? <small>{label("親の参照を確認してください。並び替えと子の追加はできません。", "Check the parent reference. Reordering and adding children are unavailable.", context.locale)}</small> : null}
            {editable && editingParent === row.name && data.parentField ? <div role="group" className="wbs-parent-editor">
            <label>{label("親を変更", "Change parent", context.locale)}{" "}<ChoiceControl mode="select"
              aria-label={`${row.title}: ${label("親", "Parent", context.locale)}`}
              value={typeof parent === "string" ? parent : ""} disabled={busy}
              options={[{ value: "", label: label("未設定", "Unset", context.locale) },
                 ...all.filter((option) => !descendants.has(option.name) && !review.has(option.name))
                  .map((option) => ({ value: option.name, label: option.title }))]}
               onChange={(value) => { onParent(row, value); setEditingParent(undefined); setMenu(undefined); }} /></label>
            <Button onClick={() => setEditingParent(undefined)}>{label("閉じる", "Close", context.locale)}</Button>
             {!needsReview && data.orderField && rows.length > 0 ? <Button disabled={busy} onClick={() => onRenumber(rows)}>
              {label("並び順を付け直す", "Renumber order", context.locale)} ({rows.length})</Button> : null}
           </div> : null}
            </div> : null}
          </div> : null}
          {panes.details ? <div role="gridcell" className="wbs-status">{status ? `${statusSymbol(data, row.values.status, status.category)} ${status.label}`
            : String(row.values.status || label("未設定", "Unset", context.locale))}</div> : null}
          {panes.schedule ? <div role="gridcell" className="wbs-timeline-cell" title={`${start || label("未設定", "Unset", context.locale)} – ${end || label("未設定", "Unset", context.locale)}`}
            {...dropTarget}>
            <TimelineTrack timeline={timeline} start={start} end={end} locale={context.locale} closed={status?.category === "closed"} onReveal={onReveal} />
          </div> : null}
        </div>;
      })}</>;
}

export function WBSScreen({ context }: PluginViewProps) {
  const base = context.rendererData as WBSRendererData | undefined;
  const [configuration, setConfiguration] = useState<Record<string, string>>({});
  const data: WBSRendererData | undefined = base ? { ...base, ...configuration } : undefined;
  const [parents, setParents] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [panes, setPanes] = useState(() => readPanes(settings(context).panes));
  const [movedName, setMovedName] = useState<string>();
  const editable = !context.isStatic && !context.target?.readOnly;
  useEffect(() => {
    if (!movedName) return;
    const timer = window.setTimeout(() => setMovedName(undefined), 1400);
    return () => window.clearTimeout(timer);
  }, [movedName]);
  const tracker = data?.tracker;
  const parentField = data?.parentField;
  const orderField = data?.orderField;
  useEffect(() => {
    setParents((current) => Object.fromEntries(Object.entries(current).filter(([name, value]) => {
      const row = context.rows.find((item) => item.name === name);
      return row && (!parentField || row.values[fieldKey(parentField)] !== value);
    })));
    setOrders((current) => Object.fromEntries(Object.entries(current).filter(([name, value]) => {
      const row = context.rows.find((item) => item.name === name);
      return row && (!orderField || row.values[fieldKey(orderField)] !== value);
    })));
  }, [context.rows, parentField, orderField]);
  const rows: PluginIndexRow[] = context.rows.map((row) => ({ ...row, values: {
    ...row.values,
    ...(parentField && parents[row.name] !== undefined ? { [fieldKey(parentField)]: parents[row.name]! } : {}),
    ...(orderField && orders[row.name] !== undefined ? { [fieldKey(orderField)]: orders[row.name]! } : {})
  } }));
  const available = buildTimeline(rows, data?.startField, data?.endField);
  const [mode, setMode] = useState<TimelineMode>(() => available &&
    (available.end - available.start) / DAY_MS > 35 ? "week" : "day");
  const initialPreset = timelinePreset(settings(context).timelinePreset) ??
    (available && (available.end - available.start) / DAY_MS > 31 ? "3m" : "1m");
  const iso = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
  const [preset, setPreset] = useState<TimelinePreset | "custom">(initialPreset);
  const [range, setRange] = useState(() => {
    const initial = presetRange(available?.start ?? Date.now(), initialPreset);
    return { from: iso(initial.start), to: iso(initial.end - DAY_MS) };
  });
  const [draftRange, setDraftRange] = useState(range);
  const timeline = buildTimeline(rows, data?.startField, data?.endField, {
    mode, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {})
  });
  function changeRange(from: string, to: string, nextMode = mode) {
    const start = parseDate(from);
    const finish = parseDate(to);
    if (start === undefined || finish === undefined) return;
    const limit = nextMode === "week" ? 186 : 182;
    const bounded = Math.min(Math.max(start, finish), start + (limit - 1) * DAY_MS);
    setMode(nextMode);
    const next = { from: iso(start), to: iso(bounded) };
    setRange(next);
    setDraftRange(next);
    setMessage(finish > bounded ? label(
      `表示範囲は最大${limit}日です。終了日を調整しました。`,
      `The visible range is limited to ${limit} days. End date adjusted.`, context.locale
    ) : "");
  }
  function reveal(timestamp: number) {
    const days = timeline ? (timeline.end - timeline.start) / DAY_MS : 35;
    const start = mondayOnOrBefore(timestamp);
    changeRange(iso(start), iso(start + (days - 1) * DAY_MS));
  }
  const hierarchy = tracker
    ? buildTicketHierarchy({ ...tracker, ...(parentField ? { parentField } : { parentField: undefined }) }, rows)
    : { roots: [], diagnostics: [] };
  const review = new Set<string>();
  for (const diagnostic of hierarchy.diagnostics) {
    if (diagnostic.file && parentField) {
      for (const name of excludedParents(rows, diagnostic.file, parentField)) review.add(name);
    }
  }
  const renumberMessage = label("先に移動先の並び順を付け直してください", "Renumber the destination before moving", context.locale);
  const saveMessage = (result: Awaited<ReturnType<PluginRenderContext["save"]>>) => {
    setMessage(result.ok ? label("✓ 保存済み", "✓ Saved", context.locale) : result.reason === "conflict"
      ? label("他で変更されました。表示は操作前のままです。再読み込みしてください。", "Changed elsewhere. The previous display is preserved; reload.", context.locale)
      : result.message);
  };
  async function changeParent(row: PluginIndexRow, parent: string) {
    if (!parentField || busy || !editable ||
      (parent && (excludedParents(rows, row.name, parentField).has(parent) || review.has(parent)))) return;
    const currentParent = row.values[fieldKey(parentField)];
    if ((typeof currentParent === "string" ? currentParent : "") === parent) return;
    const destination = rows.filter((item) => item.name !== row.name && !review.has(item.name) &&
      (item.values[fieldKey(parentField)] || "") === parent);
    const rank = orderField ? rankForAppend(destination, orderField) : undefined;
    // A finite rank cannot follow missing ranks. Never silently rewrite siblings.
    if ((orderField && rank === undefined) || (!orderField && destination.length)) {
      setMessage(renumberMessage); return;
    }
    setBusy(true);
    setMovedName(undefined);
    const result = await context.save([{ path: ["fields", parentField], value: parent || null },
      ...(orderField && rank !== undefined ? [{ path: ["fields", orderField], value: rank }] : [])], { targetName: row.name });
    setBusy(false);
    saveMessage(result);
    if (!result.ok) return;
    setParents((current) => ({ ...current, [row.name]: parent }));
    if (orderField && rank !== undefined) setOrders((current) => ({ ...current, [row.name]: rank }));
    setMovedName(row.name);
  }
  async function configure(setting: "parentField" | "startField" | "endField" | "orderField", value: string) {
    if (busy || !editable) return;
    setBusy(true);
    const result = await context.save([{ path: ["wbs", setting], value: value || null }]);
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage("");
    setConfiguration((current) => ({ ...current, [setting]: value }));
  }
  async function createTask(parent: string) {
    if (!context.runCommand || busy || !parentField || !editable || review.has(parent)) return;
    setBusy(true);
    const result = await context.runCommand("ticket.create", {
      parent, parentField
    });
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage("");
  }
  async function moveOrder(siblings: readonly PluginIndexRow[], index: number, delta: -1 | 1) {
    if (!orderField || busy || !editable || review.has(siblings[index]?.name ?? "") || index + delta < 0 || index + delta >= siblings.length) return;
    const rank = rankForInsert(siblings, index, index + delta, orderField);
    if (rank === undefined) {
      setMessage(label("この位置へ動かすには、先に並び順を付け直してください", "Renumber before moving here", context.locale));
      return;
    }
    const row = siblings[index]!;
    setBusy(true);
    setMovedName(undefined);
    const result = await context.save([{ path: ["fields", orderField], value: rank }], { targetName: row.name });
    setBusy(false);
    saveMessage(result);
    if (!result.ok) return;
    setMessage(label(`✓ 保存済み。同じ階層の${index + delta + 1}番目 / ${siblings.length}件`,
      `✓ Saved. Position ${index + delta + 1} of ${siblings.length} siblings`, context.locale));
    setOrders((current) => ({ ...current, [row.name]: rank }));
    setMovedName(row.name);
  }
  async function dropOrder(siblings: readonly PluginIndexRow[], dragged: string, target: number, after: boolean) {
    if (!orderField || busy || !editable || review.has(dragged)) return;
    const source = siblings.findIndex((row) => row.name === dragged);
    if (source === -1) return;
    const index = target + (after ? 1 : 0) - (source < target + (after ? 1 : 0) ? 1 : 0);
    if (index === source) return;
    const rank = rankForInsert(siblings, source, index, orderField);
    if (rank === undefined) {
      setMessage(label("この位置へ動かすには、先に並び順を付け直してください", "Renumber before moving here", context.locale));
      return;
    }
    const row = siblings[source]!;
    setBusy(true);
    setMovedName(undefined);
    const result = await context.save([{ path: ["fields", orderField], value: rank }], { targetName: row.name });
    setBusy(false);
    saveMessage(result);
    if (!result.ok) return;
    setMessage(label(`✓ 保存済み。同じ階層の${index + 1}番目 / ${siblings.length}件`,
      `✓ Saved. Position ${index + 1} of ${siblings.length} siblings`, context.locale));
    setOrders((current) => ({ ...current, [row.name]: rank }));
    setMovedName(row.name);
  }
  async function renumber(siblings: readonly PluginIndexRow[]) {
    if (!orderField || busy || !editable || !window.confirm(label(
      `${siblings.length}件のチケットの並び順を付け直します。実行しますか？`,
      `Renumber ${siblings.length} tickets one by one?`, context.locale))) return;
    setBusy(true);
    for (const [index, row] of siblings.entries()) {
      if (row.values[fieldKey(orderField)] === index + 1) continue;
      const result = await context.save([{ path: ["fields", orderField], value: index + 1 }], { targetName: row.name });
      if (!result.ok) {
        setMessage(`${row.title}: ${result.message}`);
        setBusy(false);
        return;
      }
      setOrders((current) => ({ ...current, [row.name]: index + 1 }));
    }
    setBusy(false);
    setMessage(label("並び順を付け直しました", "Order renumbered", context.locale));
  }
  return <section aria-label={label("WBSの階層", "WBS hierarchy", context.locale)}
    style={{ width: "100%", minWidth: 0 }}>
    {editable && tracker ? <details>
      <summary>{label("WBSの設定", "WBS settings", context.locale)}</summary>
      {([ ["parentField", "reference", "親" , "Parent"],
        ["startField", "date", "開始", "Start"],
        ["endField", "date", "終了", "End"],
        ["orderField", "number", "順序", "Order"] ] as const).map(([setting, type, ja, en]) =>
        <label key={setting}> {label(ja, en, context.locale)} <ChoiceControl mode="select"
          aria-label={label(ja, en, context.locale)} value={data?.[setting] ?? ""} disabled={busy}
          options={[{ value: "", label: label("指定しない", "None", context.locale) },
            ...tracker.fields.filter((field) => field.type === type)
              .map((field) => ({ value: field.id, label: field.label }))]}
          onChange={(value) => void configure(setting, value)} /></label>
      )}
    </details> : null}
    {!context.isStatic && [...(data?.diagnostics ?? []), ...hierarchy.diagnostics].length > 0 ? (
      <div role="alert"><h2>{label("WBSの設定に問題があります", "Check WBS definition", context.locale)}</h2>
        <ul>{[...(data?.diagnostics ?? []), ...hierarchy.diagnostics].map((diagnostic, index) =>
          <li key={`${diagnostic.code}:${index}`}>
            {resolveLocalizedText(diagnostic.message, context.locale)}
          </li>
        )}</ul></div>
    ) : null}
    {busy || message ? <p role="status">{busy ? label("○ 保存中…", "○ Saving…", context.locale) : message}</p> : null}
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      {([["title", "題名", "Title"], ["details", "詳細", "Details"], ["schedule", "スケジュール", "Schedule"]] as const).map(([key, ja, en]) =>
        <Button key={key} aria-pressed={panes[key]} disabled={panes[key] && Object.values(panes).filter(Boolean).length === 1}
          onClick={() => {
            const next = { ...panes, [key]: !panes[key] };
            setPanes(next);
            context.setViewSettings({ ...settings(context), panes: next });
          }}>{label(ja, en, context.locale)}</Button>)}
      {panes.schedule ? <>
      <label>{label("範囲", "Range", context.locale)} <ChoiceControl mode="select" aria-label={label("範囲", "Range", context.locale)} value={preset}
        options={[...TIMELINE_PRESETS.map((item) => ({ value: item, label: label(
          item === "2w" ? "2週間" : item === "1m" ? "1か月" : item === "3m" ? "3か月" : "6か月",
          item === "2w" ? "2 weeks" : item === "1m" ? "1 month" : item === "3m" ? "3 months" : "6 months",
          context.locale) })),
          { value: "custom", label: label("期間を指定…", "Custom range…", context.locale) }]}
        onChange={(value) => {
          if (value === "custom") { setPreset("custom"); setDraftRange(range); return; }
          const nextPreset = timelinePreset(value);
          if (!nextPreset) return;
          setPreset(nextPreset);
          context.setViewSettings({ ...settings(context), timelinePreset: nextPreset });
          const next = presetRange(parseDate(range.from) ?? Date.now(), nextPreset);
          changeRange(iso(next.start), iso(next.end - DAY_MS), next.mode);
        }} /></label>
      <Button onClick={() => reveal(Date.now() - 7 * DAY_MS)}>{label("今日", "Today", context.locale)}</Button>
      {preset === "custom" ? <>
       <label>{label("表示開始", "Range start", context.locale)}{" "}<InputControl type="date" aria-label={label("表示開始", "Range start", context.locale)}
         value={draftRange.from} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))}
         onBlur={(event) => changeRange(event.currentTarget.value, draftRange.to || event.currentTarget.value)}
         onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Tab") changeRange(event.currentTarget.value, draftRange.to || event.currentTarget.value); }} /></label>
       <label>{label("表示終了", "Range end", context.locale)}{" "}<InputControl type="date" aria-label={label("表示終了", "Range end", context.locale)}
         value={draftRange.to} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))}
         onBlur={(event) => changeRange(draftRange.from || event.currentTarget.value, event.currentTarget.value)}
         onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Tab") changeRange(draftRange.from || event.currentTarget.value, event.currentTarget.value); }} /></label>
      </> : null}
      <label>{label("目盛り", "Scale", context.locale)}{" "}<ChoiceControl mode="select" aria-label={label("目盛り", "Scale", context.locale)}
        value={mode} onChange={(value) => changeRange(range.from, range.to, value as TimelineMode)} options={[
          { value: "day", label: label("日ごと", "Daily", context.locale) },
          { value: "week", label: label("週ごと", "Weekly", context.locale) }
        ]} /></label>
      </> : null}
    </div>
    {tracker ? <WBSGrid key={context.target?.name} context={context} data={data!} roots={hierarchy.roots}
      rows={rows} review={review} timeline={timeline} busy={busy} movedName={movedName}
      mode={mode} panes={panes} onReveal={reveal}
      onParent={(row, parent) => void changeParent(row, parent)}
      onOrder={(siblings, index, delta) => void moveOrder(siblings, index, delta)}
      onDropOrder={(siblings, dragged, target, after) => void dropOrder(siblings, dragged, target, after)}
      onRenumber={(siblings) => void renumber(siblings)}
      onCreate={(parent) => { if (parent) void createTask(parent); }} />
      : <p>{label("チケット管理の定義が見つかりません", "Tracker definition unavailable", context.locale)}</p>}
  </section>;
}

function settings(context: PluginRenderContext): Record<string, unknown> {
  const value = context.getViewSettings();
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function WBSGrid({ context, data, roots, rows, review, timeline, mode, panes, busy, movedName, ...actions }: {
  context: PluginRenderContext;
  data: WBSRendererData;
  roots: Parameters<typeof flattenRows>[0];
  rows: readonly PluginIndexRow[];
  review: ReadonlySet<string>;
  timeline?: Timeline;
  mode: TimelineMode;
  panes: Panes;
  busy: boolean;
  movedName?: string;
} & Pick<Parameters<typeof WBSRows>[0], "onParent" | "onOrder" | "onDropOrder" | "onRenumber" | "onCreate" | "onReveal">) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = settings(context).collapsed;
    return new Set(Array.isArray(stored) ? stored.filter((name): name is string =>
      typeof name === "string" && rows.some((row) => row.name === name)) : []);
  });
  const [width, setWidth] = useState(() => {
    const value = settings(context).leftWidth;
    return typeof value === "number" && Number.isFinite(value) ? Math.max(240, Math.min(560, value)) : 400;
  });
  const [measuredDayWidth, setMeasuredDayWidth] = useState<number>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ x: number; width: number } | undefined>(undefined);
  const [viewport, setViewport] = useState({ top: 0, height: 600, rowHeight: 36 });
  const names = new Set(rows.map((row) => row.name));
  const missingRoots = roots.filter((node) => review.has(node.row.name) && data.parentField &&
    !names.has(String(node.row.values[fieldKey(data.parentField)])));
  const missing = new Set(flattenRows(missingRoots, data.orderField, context.locale, new Set()).map((item) => item.node.row.name));
  const groups = [
    { id: "tasks", roots: roots.filter((node) => !review.has(node.row.name)), count: rows.length - review.size,
      title: label("タスク", "Tasks", context.locale) },
    { id: "missing", roots: missingRoots, count: missing.size,
      title: label("△ 親が見つからないチケット", "△ Parent not found", context.locale) },
    { id: "cycle", roots: roots.filter((node) => review.has(node.row.name) && !missing.has(node.row.name)), count: review.size - missing.size,
      title: label("△ 親子が循環しているチケット", "△ Cyclic parent relationships", context.locale) }
  ];
  const groupItems = groups.map((group) => flattenRows(group.roots, data.orderField, context.locale, collapsed));
  // Headings are rows too: window them together so review groups stay at the end.
  const entries: Array<{ group: number; item?: WBSRow }> = [];
  groups.forEach((group, index) => {
    if (group.id !== "tasks" && group.count) entries.push({ group: index });
    for (const item of groupItems[index]!) entries.push({ group: index, item });
  });
  const days = timeline ? (timeline.end - timeline.start) / DAY_MS : 35;
  const dayWidth = measuredDayWidth ?? (mode === "day" ? 24 : 9);
  const tiers = timeline ? timelineCells(timeline, mode, dayWidth) : undefined;
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  function persist(update: Record<string, unknown>) {
    context.setViewSettings({ ...settings(context), ...update });
  }
  useEffect(() => {
    const header = headerRef.current?.querySelector(".wbs-date-header");
    if (!header || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = header.getBoundingClientRect().width;
      if (width > 0) setMeasuredDayWidth(width / days);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [days, mode, panes.schedule]);
  useEffect(() => {
    const valid = new Set(rows.map((row) => row.name));
    const next = new Set([...collapsed].filter((name) => valid.has(name)));
    if (next.size !== collapsed.size) setCollapsed(next);
    persist({ collapsed: [...next] });
  }, [rows.map((row) => row.name).join("\n")]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewport({
      top: element.scrollTop,
      height: Math.max(0, element.clientHeight - (headerRef.current?.offsetHeight ?? 48)),
      rowHeight: probeRef.current?.getBoundingClientRect().height || 36
    });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (probeRef.current) observer.observe(probeRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!movedName) return;
    // Reveal a moved ticket even if its destination was folded or not loaded yet.
    const full = flattenRows(roots, data.orderField, context.locale, new Set());
    const index = full.findIndex((item) => item.node.row.name === movedName);
    if (index < 0) return;
    const ancestors: string[] = [];
    let depth = full[index]!.depth;
    for (let i = index - 1; i >= 0 && depth > 0; i--) {
      if (full[i]!.depth < depth) { ancestors.push(full[i]!.node.row.name); depth = full[i]!.depth; }
    }
    setCollapsed((current) => {
      const next = new Set([...current].filter((name) => !ancestors.includes(name)));
      persist({ collapsed: [...next] });
      return next;
    });
  }, [movedName]);
  const strategy = entries.length > 300 ? "virtual" : "all";
  const window = rowWindow(entries.length, strategy, viewport.top, viewport.height, viewport.rowHeight, 0);
  const visible = entries.slice(window.start, window.end);
  return <>
    <div className="wbs-toolbar">
      <span>{label("チケット", "Tickets", context.locale)}: {rows.length}</span>
      {review.size ? <Button onClick={() => {
        const index = entries.findIndex((entry) => !entry.item);
        if (index < 0 || !scrollRef.current) return;
        const top = index * viewport.rowHeight;
        scrollRef.current.scrollTop = top;
        setViewport((current) => ({ ...current, top: scrollRef.current?.scrollTop ?? top }));
      }}>{label(`△ 要確認 ${review.size}件`, `△ Needs attention: ${review.size}`, context.locale)}</Button> : null}
    </div>
    {data.tracker?.summary?.length ? <section className="wbs-summary" aria-live="polite"
      aria-label={label("表示中のチケットの集計", "Visible tickets summary", context.locale)}>
      <ul>{data.tracker.summary.map(({ field, method, groupBy }, index) => {
        const result = summarizeRows(rows, fieldKey(field.id), field.type, method, context.locale, {
          ...(field.options ? { valueLabels: field.options } : {}),
          ...(groupBy ? { groupBy: { key: fieldKey(groupBy.id), type: groupBy.type, order: groupBy.type === "select" ? groupBy.options?.map((option) => option.value) : undefined, labels: groupBy.options, labelOf: groupBy.type === "reference" ? (value: string) => context.rows.find((row) => row.name === value)?.title ?? value : undefined } } : {})
        });
        return <li key={`${field.id}-${method}-${index}`}>
          {field.label} {result.text}{result.excluded ? ` (${label("値の形式が合わないため集計から除外", "Invalid values excluded", context.locale)}: ${result.excluded})` : ""}
          {result.multiCounted ? <span> {label("複数の値を持つチケットは、それぞれの値で数えています", "Counted in multiple groups", context.locale)}</span> : null}
          {result.groups ? <ul>{result.groups.map((group) => <li key={group.value ?? "__unset"}>{group.label}: {group.text}{group.excluded ? ` (${label("値の形式が合わないため集計から除外", "Invalid values excluded", context.locale)}: ${group.excluded})` : ""}</li>)}</ul> : null}
        </li>;
      })}</ul>
    </section> : null}
    <div ref={scrollRef} className="wbs-scroll" style={{ "--wbs-left-width": `${width}px` } as CSSProperties}
      onScroll={(event) => { const top = event.currentTarget.scrollTop;
        setViewport((current) => ({ ...current, top })); }}>
      <div ref={probeRef} className="wbs-row wbs-probe" aria-hidden="true" />
       <div role="treegrid" aria-label={label("WBSの階層", "WBS hierarchy", context.locale)} aria-rowcount={entries.length + 1}
         className="wbs-grid" data-mode={mode} data-schedule={panes.schedule || undefined} style={{ "--wbs-days": days,
           "--wbs-title-width": "clamp(168px, calc((100vw - 767px) * 1000), var(--wbs-left-width))",
           "--wbs-details-width": "clamp(100px, calc((100vw - 767px) * 1000), 120px)",
           "--wbs-columns": [panes.title && (panes.schedule ? "var(--wbs-title-width)" : "minmax(0, 1fr)"),
             panes.details && (panes.schedule ? "var(--wbs-details-width)" : "minmax(0, 1fr)"),
             panes.schedule && "minmax(0, 1fr)"].filter(Boolean).join(" "),
           "--wbs-fixed-width": `calc(${panes.title ? "var(--wbs-title-width)" : "0px"} + ${panes.details ? "var(--wbs-details-width)" : "0px"})`,
           "--wbs-day-width": `${dayWidth}px`, "--wbs-today-offset": timeline ? (today - timeline.start) / DAY_MS : 0 } as CSSProperties}>
       {panes.schedule && timeline && today >= timeline.start && today < timeline.end ? <span aria-hidden="true" className="wbs-today-line"
         /> : null}
      <div role="row" className="wbs-header wbs-row" ref={headerRef}>
        {panes.title ? <strong role="columnheader" className="wbs-left">{label("チケット", "Task", context.locale)}
          <span role="separator" aria-label={label("チケット列の幅", "Task column width", context.locale)}
            aria-orientation="vertical" aria-valuemin={240} aria-valuemax={560} aria-valuenow={width}
            tabIndex={0} className="wbs-resizer"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = Math.max(240, Math.min(560, width + (event.key === "ArrowLeft" ? -16 : 16)));
              setWidth(next); persist({ leftWidth: next });
            }}
            onPointerDown={(event) => { resizeStart.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { if (resizeStart.current) setWidth(Math.max(240, Math.min(560,
              resizeStart.current.width + event.clientX - resizeStart.current.x))); }}
            onPointerUp={() => { resizeStart.current = undefined; persist({ leftWidth: width }); }}
            onPointerCancel={() => { resizeStart.current = undefined; }} />
        </strong> : null}
        {panes.details ? <strong role="columnheader" className="wbs-status">{label("状態", "Status", context.locale)}</strong> : null}
        {panes.schedule ? <div role="columnheader" aria-label={label("日程表", "Date timeline", context.locale)} className="wbs-date-header">
          {tiers ? <>
            <div className="wbs-month-tier">{tiers.months.map((cell) => <span key={cell.timestamp}
              style={{ left: `${cell.left / (days * dayWidth) * 100}%`, width: `${cell.width / (days * dayWidth) * 100}%` }}>
              {cell.labelSize === "none" ? "" : new Intl.DateTimeFormat(context.locale, { month: "short",
                ...(cell.labelSize === "long" ? { year: "numeric" as const } : {}), timeZone: "UTC" }).format(cell.timestamp)}</span>)}</div>
            <div className="wbs-tick-tier">{tiers.cells.map((cell) => <span key={cell.timestamp} title={new Date(cell.timestamp).toISOString().slice(0, 10)}
              data-weekend={mode === "day" && [0, 6].includes(new Date(cell.timestamp).getUTCDay()) || undefined}
              data-monday={new Date(cell.timestamp).getUTCDay() === 1 || undefined}
              data-current={mode === "day" ? cell.timestamp === today || undefined : cell.timestamp === mondayOnOrBefore(today) || undefined}
              style={{ left: `${cell.left / (days * dayWidth) * 100}%`, width: `${cell.width / (days * dayWidth) * 100}%` }}>
              {cell.showLabel ? mode === "day" ? new Date(cell.timestamp).getUTCDate() : `${new Date(cell.timestamp).getUTCMonth() + 1}/${new Date(cell.timestamp).getUTCDate()}` : ""}</span>)}</div>
          </>
            : <span>{label("開始日か終了日を入れると、日程表に表示されます", "Add dates to show the timeline", context.locale)}</span>}
        </div> : null}
      </div>
      {window.start > 0 ? <div aria-hidden="true" style={{ height: window.start * viewport.rowHeight }} /> : null}
       {groups.map((group, index) => visible.some((entry) => entry.group === index) ? <div key={group.id} role="rowgroup" aria-label={group.title}>
       {visible.some((entry) => entry.group === index && !entry.item) ? <div role="row" className="wbs-review-heading"><span role="gridcell" title={`${group.title}（${group.count}）`}><span className="wbs-review-title">{group.title}</span><span>（{group.count}）</span></span><span role="gridcell" className="wbs-review-description">
         {!context.isStatic ? group.id === "missing"
           ? label("親に指定されたチケットが存在しません。親を変更するか、親を空にしてください。", "The parent ticket does not exist. Change or clear the parent.", context.locale)
           : label("親をたどると自分に戻ります。どちらかの親を変更してください。", "Following parents returns to the same ticket. Change one of the parents.", context.locale) : null}
       </span></div> : null}
        <WBSRows items={visible.flatMap((entry) => entry.group === index && entry.item ? [entry.item] : [])} data={data} context={context} all={rows} review={review} movedName={movedName} panes={panes}
        timeline={timeline} busy={busy} collapsed={collapsed} onToggle={(name) => {
          const next = new Set(collapsed);
          if (next.has(name)) next.delete(name); else next.add(name);
          setCollapsed(next); persist({ collapsed: [...next] });
         }} {...actions} />
       </div> : null)}
      {strategy === "virtual" && window.end < entries.length ? <div aria-hidden="true"
        style={{ height: (entries.length - window.end) * viewport.rowHeight }} /> : null}
      </div>
    </div>
  </>;
}
