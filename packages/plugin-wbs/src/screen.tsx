import { useEffect, useState, type DragEvent } from "react";
import { resolveLocalizedText, type PluginIndexRow, type PluginRenderContext } from "@vellym/plugin-api";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { Button, ChoiceControl, InputControl } from "@vellym/plugin-api/ui";
import { buildTicketHierarchy, fieldKey, type TicketTreeNode, type Tracker } from "@vellym-internal/ticket-engine";
import { rankForInsert, sortedSiblings } from "./model.js";
import { buildTimeline, parseDate, timelineBar, MAX_TIMELINE_DAYS, DAY_MS,
  type Timeline, type TimelineMode } from "./timeline.js";
import type { WBSRendererData } from "./view.js";

const label = (ja: string, en: string, locale: string) => resolveLocalizedText({ ja, en }, locale);
const date = (value: unknown): string | undefined =>
  parseDate(value) !== undefined ? value as string : undefined;

function TimelineTrack({ timeline, start, end, locale }: {
  timeline?: Timeline;
  start: unknown;
  end: unknown;
  locale: string;
}) {
  if (!timeline) return <span>{label("日程未設定", "No dates", locale)}</span>;
  const bar = timelineBar(timeline, start, end);
  return <div aria-label={bar ? `${String(start ?? "")} – ${String(end ?? "")}` : label("日程未設定", "No dates", locale)}
    style={{ position: "relative", minHeight: "2rem", background: "var(--surface-sunken)" }}>
    {timeline.ticks.map((tick) => <span key={tick.label} aria-hidden="true"
      style={{ position: "absolute", left: `${tick.position}%`, top: 0, bottom: 0,
        borderInlineStart: "1px solid var(--border-subtle)" }} />)}
    {bar && !bar.outside ? <span aria-hidden="true" style={{ position: "absolute", top: "0.55rem", height: "0.9rem",
      left: `${bar.left}%`, width: `${bar.width}%`, minWidth: "0.25rem",
      background: "var(--accent-default)", borderRadius: "var(--space-1)" }} /> : null}
    {bar?.before ? <span style={{ position: "absolute", insetInlineStart: "var(--space-1)", top: "var(--space-1)",
      background: "var(--surface-sunken)" }}>← {label("範囲外", "Outside range", locale)}</span> : null}
    {bar?.after ? <span style={{ position: "absolute", insetInlineEnd: "var(--space-1)", top: "var(--space-1)",
      background: "var(--surface-sunken)" }}>{label("範囲外", "Outside range", locale)} →</span> : null}
  </div>;
}

function WBSGroup({ nodes, data, context, all, timeline, depth, busy, movedName, onParent, onOrder, onDropOrder, onRenumber, onCreate }: {
  nodes: readonly TicketTreeNode[];
  data: WBSRendererData;
  context: PluginRenderContext;
  all: readonly PluginIndexRow[];
  timeline?: Timeline;
  depth: number;
  busy: boolean;
  movedName?: string;
  onParent(row: PluginIndexRow, parent: string): void;
  onOrder(rows: readonly PluginIndexRow[], index: number, delta: -1 | 1): void;
  onDropOrder(rows: readonly PluginIndexRow[], dragged: string, target: number, after: boolean): void;
  onRenumber(rows: readonly PluginIndexRow[]): void;
  onCreate(parent?: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingParent, setEditingParent] = useState<string>();
  const [dropPosition, setDropPosition] = useState<{ name: string; after: boolean }>();
  const sorted = sortedSiblings(nodes, data.orderField, context.locale);
  const visible = expanded ? sorted : sorted.slice(0, 20);
  const moved = sorted.find((item) => item.row.name === movedName);
  if (!expanded && moved && !visible.includes(moved)) visible[visible.length - 1] = moved;
  const rows = sorted.map((node) => node.row);
  return <div data-wbs-level={depth} style={{ gridColumn: "1 / -1" }}>
    <p style={{ marginBlock: "var(--space-2)" }}>{depth === 0 ? label("チケット", "Tickets", context.locale) : label("子", "Children", context.locale)}: {sorted.length}</p>
    {!context.isStatic && data.orderField && sorted.length > 1 ? (
      <Button disabled={busy} onClick={() => onRenumber(rows)}>
        {label("順序を振り直す", "Renumber order", context.locale)} ({sorted.length})
      </Button>
    ) : null}
    <ul style={{ padding: 0, margin: 0, listStyle: "none" }}>
      {visible.map((node) => {
        const row = node.row;
        const start = data.startField ? date(row.values[fieldKey(data.startField)]) : undefined;
        const end = data.endField ? date(row.values[fieldKey(data.endField)]) : undefined;
        const parent = data.parentField ? row.values[fieldKey(data.parentField)] : undefined;
        const status = data.tracker?.statuses.find((item) => item.id === row.values.status);
        const descendants = new Set<string>([row.name]);
        const pending = [...node.children];
        while (pending.length) {
          const child = pending.pop()!;
          descendants.add(child.row.name);
          pending.push(...child.children);
        }
        const dropTarget = !context.isStatic && data.orderField ? {
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
            onDropOrder(rows, event.dataTransfer.getData("text/plain"), sorted.indexOf(node),
              event.clientY > rect.top + rect.height / 2);
          }
        } : {};
        return <li key={row.name} data-ticket-name={row.name} className="wbs-row" style={{
          borderBlockStart: dropPosition?.name === row.name && !dropPosition.after
            ? "2px solid var(--accent-default)" : "2px solid transparent",
          borderBlockEnd: dropPosition?.name === row.name && dropPosition.after
            ? "2px solid var(--accent-default)" : "1px solid var(--border-subtle)" }}>
          <div style={{ paddingInlineStart: `calc(${depth} * var(--space-5))`,
            paddingBlock: "var(--space-2)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}
            {...dropTarget}>
          {!context.isStatic && data.orderField && sorted.length > 1 ? <Button icon draggable disabled={busy}
            aria-label={`${row.title}: ${label("ドラッグして順序を変更", "Drag to reorder", context.locale)}`}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onKeyDown={(event) => {
              if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                event.preventDefault();
                onOrder(rows, sorted.indexOf(node), event.key === "ArrowUp" ? -1 : 1);
              }
            }}
            onDragStart={(event) => event.dataTransfer.setData("text/plain", row.name)}>⠿</Button> : null}
          <Button onClick={() => void context.openResource(row.name)}>{row.title}</Button>
          <span>{status ? `${status.category === "closed" ? "✓" : "□"} ${status.label}`
            : String(row.values.status || label("未設定", "Unset", context.locale))}</span>
          {!context.isStatic && data.parentField ? <Button icon
            aria-label={`${row.title}: ${label("親を変更", "Change parent", context.locale)}`}
            aria-expanded={editingParent === row.name}
            onClick={() => setEditingParent((current) => current === row.name ? undefined : row.name)}>⋯</Button> : null}
          {!context.isStatic && context.runCommand && data.parentField ? <Button icon
            aria-label={`${row.title}: ${label("子タスクを追加", "Add child task", context.locale)}`}
            onClick={() => onCreate(row.name)}>＋</Button> : null}
          </div>
          <div title={`${start || label("未設定", "Unset", context.locale)} – ${end || label("未設定", "Unset", context.locale)}`}
            {...dropTarget}>
            <TimelineTrack timeline={timeline} start={start} end={end} locale={context.locale} />
            <small>{start || label("なし", "None", context.locale)} – {end || label("なし", "None", context.locale)}</small>
          </div>
          {editingParent === row.name && data.parentField ? <div role="group" style={{ gridColumn: "1 / -1",
            background: "var(--surface-sunken)", padding: "var(--space-3)" }}>
            <label>{label("親を変更", "Change parent", context.locale)}{" "}<ChoiceControl mode="select"
              aria-label={`${row.title}: ${label("親", "Parent", context.locale)}`}
              value={typeof parent === "string" ? parent : ""} disabled={busy}
              options={[{ value: "", label: label("未設定", "Unset", context.locale) },
                ...all.filter((option) => !descendants.has(option.name))
                  .map((option) => ({ value: option.name, label: option.title }))]}
              onChange={(value) => { onParent(row, value); setEditingParent(undefined); }} /></label>
            <Button onClick={() => setEditingParent(undefined)}>{label("閉じる", "Close", context.locale)}</Button>
          </div> : null}
          {node.children.length ? <WBSGroup nodes={node.children} data={data} context={context}
            all={all} timeline={timeline} depth={depth + 1} busy={busy} movedName={movedName}
            onParent={onParent} onOrder={onOrder} onDropOrder={onDropOrder}
            onRenumber={onRenumber} onCreate={onCreate} /> : null}
        </li>;
      })}
    </ul>
    {sorted.length > 20 ? <Button onClick={() => setExpanded(!expanded)}>
      {expanded ? label("20件に戻す", "Show first 20", context.locale)
        : label(`残り${sorted.length - 20}件を表示`, `Show ${sorted.length - 20} more`, context.locale)}
    </Button> : null}
  </div>;
}

export function WBSScreen({ context }: PluginViewProps) {
  const base = context.rendererData as WBSRendererData | undefined;
  const [configuration, setConfiguration] = useState<Record<string, string>>({});
  const data: WBSRendererData | undefined = base ? { ...base, ...configuration } : undefined;
  const [parents, setParents] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [movedName, setMovedName] = useState<string>();
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
    (available.end - available.start) / DAY_MS <= MAX_TIMELINE_DAYS.day ? "day" : "week");
  const [range, setRange] = useState(() => ({
    from: available ? new Date(available.start).toISOString().slice(0, 10) : "",
    to: available ? new Date(Math.min(available.end - DAY_MS,
      available.start + (MAX_TIMELINE_DAYS[mode] - 1) * DAY_MS)).toISOString().slice(0, 10) : ""
  }));
  useEffect(() => {
    if (!available) return;
    setRange((current) => current.from || current.to ? current : {
      from: new Date(available.start).toISOString().slice(0, 10),
      to: new Date(Math.min(available.end - DAY_MS,
        available.start + (MAX_TIMELINE_DAYS[mode] - 1) * DAY_MS)).toISOString().slice(0, 10)
    });
  }, [available?.start, available?.end, mode]);
  const timeline = buildTimeline(rows, data?.startField, data?.endField, {
    mode, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {})
  });
  function changeRange(from: string, to: string, nextMode = mode) {
    const start = parseDate(from);
    const finish = parseDate(to);
    if (start === undefined || finish === undefined) return;
    const limit = MAX_TIMELINE_DAYS[nextMode];
    const bounded = Math.min(Math.max(start, finish), start + (limit - 1) * DAY_MS);
    setMode(nextMode);
    setRange({ from, to: new Date(bounded).toISOString().slice(0, 10) });
    setMessage(finish > bounded ? label(
      `表示範囲は最大${limit}日です。終了日を調整しました。`,
      `The visible range is limited to ${limit} days. End date adjusted.`, context.locale
    ) : "");
  }
  const hierarchy = tracker
    ? buildTicketHierarchy({ ...tracker, ...(parentField ? { parentField } : { parentField: undefined }) }, rows)
    : { roots: [], diagnostics: [] };
  async function changeParent(row: PluginIndexRow, parent: string) {
    if (!parentField || busy) return;
    setBusy(true);
    const result = await context.save([{ path: ["fields", parentField], value: parent || null }], { targetName: row.name });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.reason === "conflict"
        ? label("他で変更されました。親は元のままです。再読み込みしてください。", "Changed elsewhere. Parent unchanged; reload.", context.locale)
        : result.message);
      return;
    }
    setMessage("");
    setParents((current) => ({ ...current, [row.name]: parent }));
    setMovedName(row.name);
  }
  async function configure(setting: "parentField" | "startField" | "endField" | "orderField", value: string) {
    if (busy) return;
    setBusy(true);
    const result = await context.save([{ path: ["wbs", setting], value: value || null }]);
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage("");
    setConfiguration((current) => ({ ...current, [setting]: value }));
  }
  async function createTask(parent: string) {
    if (!context.runCommand || busy || !parentField) return;
    setBusy(true);
    const result = await context.runCommand("ticket.create", {
      parent, parentField
    });
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage("");
  }
  async function moveOrder(siblings: readonly PluginIndexRow[], index: number, delta: -1 | 1) {
    if (!orderField || busy) return;
    const rank = rankForInsert(siblings, index, index + delta, orderField);
    if (rank === undefined) {
      setMessage(label("この位置へ動かすには順序の振り直しが必要です", "Renumber before moving here", context.locale));
      return;
    }
    const row = siblings[index]!;
    setBusy(true);
    const result = await context.save([{ path: ["fields", orderField], value: rank }], { targetName: row.name });
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage("");
    setOrders((current) => ({ ...current, [row.name]: rank }));
    setMovedName(row.name);
  }
  async function dropOrder(siblings: readonly PluginIndexRow[], dragged: string, target: number, after: boolean) {
    if (!orderField || busy || context.isStatic) return;
    const source = siblings.findIndex((row) => row.name === dragged);
    if (source === -1) return;
    const index = target + (after ? 1 : 0) - (source < target + (after ? 1 : 0) ? 1 : 0);
    if (index === source) return;
    const rank = rankForInsert(siblings, source, index, orderField);
    if (rank === undefined) {
      setMessage(label("この位置へ動かすには順序の振り直しが必要です", "Renumber before moving here", context.locale));
      return;
    }
    const row = siblings[source]!;
    setBusy(true);
    const result = await context.save([{ path: ["fields", orderField], value: rank }], { targetName: row.name });
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage("");
    setOrders((current) => ({ ...current, [row.name]: rank }));
    setMovedName(row.name);
  }
  async function renumber(siblings: readonly PluginIndexRow[]) {
    if (!orderField || busy || !window.confirm(label(
      `${siblings.length}件を1件ずつ振り直します。実行しますか？`,
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
    setMessage(label("順序を振り直しました", "Order renumbered", context.locale));
  }
  return <section aria-label={label("WBSの階層", "WBS hierarchy", context.locale)}
    style={{ width: "100%", minWidth: 0 }}>
    {!context.isStatic && tracker ? <details>
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
      <div role="alert"><h2>{label("WBS定義を確認してください", "Check WBS definition", context.locale)}</h2>
        <ul>{[...(data?.diagnostics ?? []), ...hierarchy.diagnostics].map((diagnostic, index) =>
          <li key={`${diagnostic.code}:${index}`}>
            {resolveLocalizedText(diagnostic.message, context.locale)}
          </li>
        )}</ul></div>
    ) : null}
    {message ? <p role="status">{message}</p> : null}
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <label>{label("表示開始", "Range start", context.locale)}{" "}<InputControl type="date" aria-label={label("表示開始", "Range start", context.locale)}
        value={range.from} onChange={(event) => changeRange(event.target.value, range.to || event.target.value)} /></label>
      <label>{label("表示終了", "Range end", context.locale)}{" "}<InputControl type="date" aria-label={label("表示終了", "Range end", context.locale)}
        value={range.to} onChange={(event) => changeRange(range.from || event.target.value, event.target.value)} /></label>
      <label>{label("目盛り", "Scale", context.locale)}{" "}<ChoiceControl mode="select" aria-label={label("目盛り", "Scale", context.locale)}
        value={mode} onChange={(value) => changeRange(range.from, range.to, value as TimelineMode)} options={[
          { value: "day", label: label("日ごと", "Daily", context.locale) },
          { value: "week", label: label("週ごと", "Weekly", context.locale) }
        ]} /></label>
    </div>
    {tracker ? <div style={{ overflowX: "auto", marginBlockStart: "var(--space-4)" }}>
      <div style={{ minWidth: `${Math.max(58, 19 + (timeline?.ticks.length ?? 1) * 5)}rem` }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(19rem, 36%) minmax(36rem, 1fr)", gap: "var(--space-3)" }}>
        <strong>{label("作業", "Task", context.locale)}</strong>
        <div aria-label={label("日付タイムライン", "Date timeline", context.locale)} style={{ position: "relative", minHeight: "3rem" }}>
          {timeline ? timeline.ticks.map((tick) => <span key={tick.label} title={tick.label}
            style={{ position: "absolute", left: `min(${tick.position}%, calc(100% - 4.5rem))`,
              whiteSpace: "nowrap", fontSize: "var(--size-caption)", color: "var(--text-secondary)" }}>
            {tick.label.slice(5)}</span>)
            : <span>{label("日程を設定するとタイムラインが表示されます", "Add dates to show the timeline", context.locale)}</span>}
        </div>
      </div>
      <WBSGroup nodes={hierarchy.roots} data={data!} context={context}
      all={rows} timeline={timeline} depth={0} busy={busy} movedName={movedName}
      onParent={(row, parent) => void changeParent(row, parent)}
      onOrder={(siblings, index, delta) => void moveOrder(siblings, index, delta)}
      onDropOrder={(siblings, dragged, target, after) => void dropOrder(siblings, dragged, target, after)}
      onRenumber={(siblings) => void renumber(siblings)}
      onCreate={(parent) => { if (parent) void createTask(parent); }} />
      </div>
    </div>
      : <p>{label("チケット管理の定義が見つかりません", "Tracker definition unavailable", context.locale)}</p>}
  </section>;
}
