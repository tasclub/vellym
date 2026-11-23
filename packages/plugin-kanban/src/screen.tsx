import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { resolveLocalizedText, type PluginIndexRow } from "@vellym/plugin-api";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { Button, ChoiceControl, InputControl, KindIcon } from "@vellym/plugin-api/ui";
import type { KanbanRendererData } from "./board.js";
import { buildKanbanColumns } from "./model.js";
import { cardFieldValue } from "./card-fields.js";
import { filterKanbanRows } from "./filters.js";
import { summarizeColumn } from "./summary.js";
import { fieldKey } from "@vellym-internal/ticket-engine";
import { DEFAULT_SORT, neighboringRank, sortKanbanRows } from "./order.js";
import {
  columnKey,
  readColumnSettings,
  selectableColumns,
  selectedColumnKeys,
  toggleColumn
} from "./column-settings.js";

const boardStyle: CSSProperties = {
  display: "grid",
  gridAutoFlow: "column",
  gridAutoColumns: "minmax(16rem, 1fr)",
  gap: "var(--space-4)",
  overflowX: "auto",
  alignItems: "start",
  paddingBlock: "0.5rem"
};
const columnStyle: CSSProperties = {
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-sunken)",
  padding: "var(--space-3)",
  minHeight: "8rem",
  color: "var(--text-primary)"
};
const cardStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  alignItems: "flex-start",
  background: "var(--surface-page)",
  border: "1px solid var(--border-subtle)",
  padding: "var(--space-3)",
  color: "var(--text-primary)"
};
function isRendererData(value: unknown): value is KanbanRendererData {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as KanbanRendererData).statuses) &&
    Array.isArray((value as KanbanRendererData).fields) &&
    Array.isArray((value as KanbanRendererData).cardFields) &&
    Array.isArray((value as KanbanRendererData).summaries) &&
    Array.isArray((value as KanbanRendererData).diagnostics);
}

export function KanbanScreen({ context }: PluginViewProps) {
  const [settings, setSettings] = useState(() => readColumnSettings(context.getViewSettings()));
  const [message, setMessage] = useState("");
  const [draggingName, setDraggingName] = useState<string>();
  const [dragOverColumn, setDragOverColumn] = useState<string>();
  const [movingNames, setMovingNames] = useState<string[]>([]);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [orderOverrides, setOrderOverrides] = useState<Record<string, number>>({});
  const [savingOrder, setSavingOrder] = useState(false);
  const [expandedColumns, setExpandedColumns] = useState<string[]>([]);
  const [recentlyMovedName, setRecentlyMovedName] = useState<string>();
  const focusAfterMove = useRef<string | undefined>(undefined);
  const data = isRendererData(context.rendererData)
    ? context.rendererData
    : { statuses: [], fields: [], cardFields: [], summaries: [], diagnostics: [] };
  const rows: PluginIndexRow[] = context.rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      ...(statusOverrides[row.name] !== undefined ? { status: statusOverrides[row.name]! } : {}),
      ...(data.orderField && orderOverrides[row.name] !== undefined
        ? { [fieldKey(data.orderField.id)]: orderOverrides[row.name]! } : {})
    }
  }));
  const trackerName = context.target?.kind === "TicketTracker" ? context.target.name : undefined;
  const trackerSettings = trackerName ? settings[trackerName] : undefined;
  // 絞り込みの対象は実効の`filter`。列に出さない項目も、`filter: true`
  // ならカンバンの絞り込みに出る。
  const filterFields = data.fields.filter((field) => field.filter);
  const filterFieldIds = new Set(filterFields.map((field) => field.id));
  const filterValues = Object.fromEntries(Object.entries(trackerSettings?.filters ?? {})
    .filter(([id, value]) => filterFieldIds.has(id) && typeof value === "string"));
  const filtersExpanded = trackerSettings?.filtersExpanded === true;
  const activeFilterCount = filterFields.filter((field) => Boolean(filterValues[field.id])).length;
  const filteredRows = filterKanbanRows(rows, filterFields, filterValues);
  const filteredNames = new Set(filteredRows.map((row) => row.name));
  // Filter cards within columns rather than deriving columns from filtered rows:
  // a status with no matches must remain visible as an empty column.
  const columns = buildKanbanColumns(data, rows, context.locale).map((column) => ({
    ...column,
    rows: column.rows.filter((row) => filteredNames.has(row.name))
  }));
  const manualField = data.orderField ? fieldKey(data.orderField.id) : undefined;
  const sortOptions = [
    ...(manualField ? [{ id: manualField, label: resolveLocalizedText({ ja: "手で並べた順", en: "Manual order" }, context.locale) }] : []),
    { id: "title", label: resolveLocalizedText({ ja: "題名", en: "Title" }, context.locale) },
    ...data.fields.filter((field) => field.id !== data.orderField?.id)
      .map((field) => ({ id: fieldKey(field.id), label: field.label }))
  ];
  const savedSort = trackerSettings?.sort ?? (manualField
    ? { field: manualField, direction: "asc" as const } : DEFAULT_SORT);
  const sort = sortOptions.some((option) => option.id === savedSort.field) ? savedSort : DEFAULT_SORT;
  const options = selectableColumns(columns, trackerSettings);
  const selected = selectedColumnKeys(options, trackerSettings);
  const selectedCount = options.filter((column) => selected.has(columnKey(column))).length;
  const excluded = options.filter((column) => !selected.has(columnKey(column)));

  useEffect(() => {
    setStatusOverrides((current) => {
      const next = { ...current };
      for (const row of context.rows) {
        if (next[row.name] !== undefined && String(row.values.status ?? "") === next[row.name]) {
          delete next[row.name];
        }
      }
      return next;
    });
    setOrderOverrides((current) => {
      const next = { ...current };
      for (const row of context.rows) {
        if (next[row.name] !== undefined && data.orderField &&
          row.values[fieldKey(data.orderField.id)] === next[row.name]) delete next[row.name];
      }
      return next;
    });
  }, [context.rows, data.orderField?.id]);

  useEffect(() => {
    const name = focusAfterMove.current;
    if (!name) return;
    const card = [...document.querySelectorAll<HTMLElement>("[data-ticket-name]")]
      .find((item) => item.dataset.ticketName === name);
    card?.querySelector<HTMLButtonElement>("button[aria-keyshortcuts]")?.focus();
    focusAfterMove.current = undefined;
  }, [statusOverrides]);

  function updateSelection(key: string) {
    if (!trackerName) return;
    const next = {
      ...settings,
      [trackerName]: toggleColumn(options, trackerSettings, key)
    };
    setSettings(next);
    context.setViewSettings(next);
  }

  function updateSort(field: string, direction: "asc" | "desc") {
    if (!trackerName) return;
    const next = {
      ...settings,
      [trackerName]: {
        columns: [...selected],
        knownColumns: [...new Set([...(trackerSettings?.knownColumns ?? []), ...options.map(columnKey)])],
        sort: { field, direction },
        ...(Object.keys(filterValues).length ? { filters: filterValues } : {}),
        ...(trackerSettings?.filtersExpanded !== undefined
          ? { filtersExpanded: trackerSettings.filtersExpanded } : {})
      }
    };
    setSettings(next);
    context.setViewSettings(next);
  }

  function updateFilterSettings(
    patch: { filters?: Record<string, string>; filtersExpanded?: boolean }
  ) {
    if (!trackerName) return;
    const next = {
      ...settings,
      [trackerName]: {
        columns: [...selected],
        knownColumns: [...new Set([...(trackerSettings?.knownColumns ?? []), ...options.map(columnKey)])],
        ...(sort ? { sort } : {}),
        ...(Object.keys(filterValues).length ? { filters: filterValues } : {}),
        ...(trackerSettings?.filtersExpanded !== undefined
          ? { filtersExpanded: trackerSettings.filtersExpanded } : {}),
        ...patch
      }
    };
    setSettings(next);
    context.setViewSettings(next);
  }

  async function moveWithinColumn(sorted: readonly (typeof rows)[number][], index: number, delta: -1 | 1) {
    if (savingOrder || context.isStatic || !data.orderField) return;
    const row = sorted[index];
    if (!row) return;
    const rank = neighboringRank(sorted, index, delta, fieldKey(data.orderField.id));
    if (rank === undefined) {
      setMessage(resolveLocalizedText({
        ja: "この位置へ動かすには、先に列の並び順を付け直してください。",
        en: "This position needs renumbering before a single-card move."
      }, context.locale));
      return;
    }
    setSavingOrder(true);
    const result = await context.save([{ path: ["fields", data.orderField.id], value: rank }], { targetName: row.name });
    setSavingOrder(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("");
    setOrderOverrides((current) => ({ ...current, [row.name]: rank }));
    setRecentlyMovedName(row.name);
  }

  async function renumberColumn(sorted: readonly (typeof rows)[number][]) {
    if (savingOrder || context.isStatic || sorted.length === 0 || !data.orderField) return;
    const message = resolveLocalizedText({
      ja: `${sorted.length}件のチケットの並び順を付け直します。実行しますか？`,
      en: `Renumber ${sorted.length} tickets one by one?`
    }, context.locale);
    if (!window.confirm(message)) return;
    setSavingOrder(true);
    for (const [index, row] of sorted.entries()) {
      if (row.values[fieldKey(data.orderField.id)] === index + 1) continue;
      const result = await context.save([{ path: ["fields", data.orderField.id], value: index + 1 }], { targetName: row.name });
      if (!result.ok) {
        setMessage(`${row.title}: ${result.message}`);
        setSavingOrder(false);
        return;
      }
      setOrderOverrides((current) => ({ ...current, [row.name]: index + 1 }));
    }
    setMessage(resolveLocalizedText({ ja: "並び順を付け直しました", en: "Order renumbered" }, context.locale));
    setSavingOrder(false);
  }

  async function moveTicket(row: (typeof context.rows)[number], status: string) {
    if (context.isStatic || movingNames.includes(row.name) ||
      !data.statuses.some((item) => item.id === status)) return;
    setMessage("");
    setMovingNames((current) => current.includes(row.name) ? current : [...current, row.name]);
    const result = await context.save([{ path: ["status"], value: status }], {
      targetName: row.name
    });
    setMovingNames((current) => current.filter((name) => name !== row.name));
    if (!result.ok) {
      focusAfterMove.current = undefined;
      setMessage(result.reason === "conflict"
        ? resolveLocalizedText({
            ja: "他でチケットが変更されました。カードは元の列に残しています。再読み込みして確認してください。",
            en: "This ticket changed elsewhere. The card was not moved; reload to review the latest value."
          }, context.locale)
        : result.message);
      return;
    }
    setStatusOverrides((current) => ({ ...current, [row.name]: status }));
    setRecentlyMovedName(row.name);
  }

  function dropOnColumn(event: DragEvent<HTMLElement>, status: string) {
    if (context.isStatic) return;
    event.preventDefault();
    const name = event.dataTransfer.getData("text/plain") || draggingName;
    const row = rows.find((item) => item.name === name);
    if (row) void moveTicket(row, status);
    setDragOverColumn(undefined);
    setDraggingName(undefined);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>, row: (typeof context.rows)[number]) {
    if (context.isStatic || !event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const current = data.statuses.findIndex((status) => status.id === String(row.values.status ?? ""));
    const targetIndex = current < 0
      ? (step < 0 ? data.statuses.length - 1 : 0)
      : current + step;
    const target = data.statuses[targetIndex];
    if (!target) return;
    event.preventDefault();
    focusAfterMove.current = row.name;
    void moveTicket(row, target.id);
  }

  return (
    <section aria-label={resolveLocalizedText({ ja: "チケットのカンバン", en: "Ticket Kanban" }, context.locale)}>
      {!context.isStatic && data.diagnostics.length > 0 ? (
        <div role="alert">
          <strong>{resolveLocalizedText({ ja: "カンバンの設定に問題があります", en: "Check the Kanban definition" }, context.locale)}</strong>
          <ul>
            {data.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.path ?? ""}`}>
                {resolveLocalizedText(diagnostic.message, context.locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!context.isStatic && data.statuses.length > 0 ? (
        <span id="kanban-keyboard-instructions" className="visually-hidden">
          {resolveLocalizedText({
            ja: "カードを移動するには、題名にフォーカスして Alt + ← / → を押します。",
            en: "To move this card, focus its title and press Alt + Left/Right."
          }, context.locale)}
        </span>
      ) : null}
      {filterFields.length > 0 ? (
        <div className="kanban-filters">
          <span className="kanban-filters-label" aria-hidden="true">FILTER</span>
          <Button
            aria-expanded={filtersExpanded}
            aria-controls="kanban-filter-controls"
            onClick={() => updateFilterSettings({ filtersExpanded: !filtersExpanded })}
          >
            {resolveLocalizedText({
              ja: `絞り込み（有効 ${activeFilterCount}件）`,
              en: `Filters (${activeFilterCount} active)`
            }, context.locale)}
          </Button>
          {activeFilterCount > 0 ? (
            <span role="status">
              {resolveLocalizedText({
                ja: `表示 ${filteredRows.length} / ${rows.length}件`,
                en: `Showing ${filteredRows.length} of ${rows.length}`
              }, context.locale)}
            </span>
          ) : null}
          <div
            id="kanban-filter-controls"
            className="kanban-filter-controls"
            hidden={!filtersExpanded}
          >
            {filterFields.map((field) => {
              const label = resolveLocalizedText(field.label, context.locale);
              const options = field.type === "boolean"
                ? [
                    { value: "true", label: resolveLocalizedText({ ja: "はい", en: "Yes" }, context.locale) },
                    { value: "false", label: resolveLocalizedText({ ja: "いいえ", en: "No" }, context.locale) }
                  ]
                : (field.options ?? []).map((option) => ({
                    value: option.value,
                    label: resolveLocalizedText(option.label, context.locale)
                  }));
              return (
                <label key={field.id}>
                  <span>{label}</span>
                  {field.type === "select" || field.type === "multiselect" || field.type === "boolean" ? (
                    <ChoiceControl
                      mode="select"
                      aria-label={label}
                      value={filterValues[field.id] ?? ""}
                      options={[
                        { value: "", label: resolveLocalizedText({ ja: "すべて", en: "Any" }, context.locale) },
                        ...options
                      ]}
                      onChange={(value) => updateFilterSettings({
                        filters: { ...filterValues, [field.id]: value }
                      })}
                    />
                  ) : (
                    <InputControl
                      type="text"
                      aria-label={label}
                      placeholder={resolveLocalizedText({ ja: "含む文字", en: "Contains" }, context.locale)}
                      value={filterValues[field.id] ?? ""}
                      onChange={(event) => updateFilterSettings({
                        filters: { ...filterValues, [field.id]: event.target.value }
                      })}
                    />
                  )}
                </label>
              );
            })}
            {activeFilterCount > 0 ? (
              <Button onClick={() => updateFilterSettings({ filters: {} })}>
                {resolveLocalizedText({ ja: "絞り込みを解除", en: "Clear filters" }, context.locale)}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <details style={{ marginBlock: "var(--space-3)" }}>
        <summary style={{ cursor: "pointer", color: "var(--text-primary)" }}>
          {resolveLocalizedText({ ja: "表示する列", en: "Visible columns" }, context.locale)} ({selectedCount}/{options.length})
        </summary>
        <fieldset style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          marginBlock: "var(--space-2)",
            padding: "var(--space-3)",
            minWidth: 0,
            border: "1px solid var(--border-subtle)"
        }}>
          <legend>{resolveLocalizedText({ ja: "表示する列を選択", en: "Select visible columns" }, context.locale)}</legend>
          {options.map((column) => (
            <label key={columnKey(column)} style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center", overflowWrap: "anywhere" }}>
              <InputControl
                type="checkbox"
                checked={selected.has(columnKey(column))}
                onChange={() => updateSelection(columnKey(column))}
              />
              {resolveLocalizedText(column.label, context.locale)} ({column.rows.length})
            </label>
          ))}
        </fieldset>
      </details>
      {excluded.length > 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--size-ui)" }}>
          {resolveLocalizedText({ ja: "表示していない列", en: "Columns not shown" }, context.locale)}: {excluded.map((column) =>
            `${resolveLocalizedText(column.label, context.locale)} (${column.rows.length})`
          ).join("、")}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          {resolveLocalizedText({ ja: "列内の並び順", en: "Sort within columns" }, context.locale)}{" "}
          <ChoiceControl mode="select" aria-label={resolveLocalizedText({ ja: "並び替え項目", en: "Sort field" }, context.locale)}
            value={sort.field} options={sortOptions.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => updateSort(value, sort.direction)} />
        </label>
        <label>
          {resolveLocalizedText({ ja: "方向", en: "Direction" }, context.locale)}{" "}
          <ChoiceControl mode="select" aria-label={resolveLocalizedText({ ja: "並び順", en: "Sort direction" }, context.locale)}
            value={sort.direction} options={[
              { value: "asc", label: resolveLocalizedText({ ja: "昇順", en: "Ascending" }, context.locale) },
              { value: "desc", label: resolveLocalizedText({ ja: "降順", en: "Descending" }, context.locale) }
            ]} onChange={(value) => updateSort(sort.field, value as "asc" | "desc")} />
        </label>
      </div>
      {data.summaries.length > 0 ? <section aria-label={resolveLocalizedText({
        ja: "ボード全体の集計", en: "Whole board summary"
      }, context.locale)}>
        <h2>{resolveLocalizedText({ ja: "ボード全体", en: "Whole board" }, context.locale)}</h2>
        <p
          title={resolveLocalizedText({
            ja: "非表示の列と20件以降も含む",
            en: "Including hidden columns and cards past the first 20"
          }, context.locale)}
        >
          {resolveLocalizedText({
            ja: activeFilterCount > 0
              ? `${filteredRows.length} / ${rows.length}件`
              : `全${rows.length}件`,
            en: activeFilterCount > 0
              ? `${filteredRows.length} of ${rows.length} tickets`
              : `All ${rows.length} tickets`
          }, context.locale)}
        </p>
        <ul>{data.summaries.map((definition, index) => {
          const result = summarizeColumn(filteredRows, definition, context.locale, rows);
          return <li key={`${definition.field.id}:${definition.method}:${index}`}>
            {result.text}{!context.isStatic && result.excluded > 0 ? ` (${resolveLocalizedText({
              ja: "値の形式が合わないため集計から除外", en: "Invalid values excluded"
            }, context.locale)}: ${result.excluded})` : ""}
            {result.multiCounted ? <span> {resolveLocalizedText({ ja: "複数の値を持つチケットは、それぞれの値で数えています", en: "Counted in multiple groups" }, context.locale)}</span> : null}
            {result.groups ? <ul>{result.groups.map((group) => <li key={group.value ?? "__unset"}>{group.label}: {group.text}{group.excluded ? ` (${resolveLocalizedText({ ja: "値の形式が合わないため集計から除外", en: "Invalid values excluded" }, context.locale)}: ${group.excluded})` : ""}</li>)}</ul> : null}
          </li>;
        })}</ul>
      </section> : null}
      <div className="kanban-board" style={boardStyle}>
        {columns.filter((column) => selected.has(columnKey(column))).map((column) => {
          const id = columnKey(column);
          const sorted = sortKanbanRows(column.rows, sort, context.locale);
          const expanded = expandedColumns.includes(id);
          const visibleRows = expanded ? sorted : sorted.slice(0, 20);
          // A card just moved here must remain visible even if it sorts past the 20th slot.
          const moved = sorted.find((row) => row.name === recentlyMovedName);
          if (!expanded && moved && !visibleRows.includes(moved)) {
            visibleRows[visibleRows.length - 1] = moved;
          }
          return (
          <section
            key={id}
            style={{
              ...columnStyle,
              ...(dragOverColumn === id ? { outline: "2px solid currentColor" } : {})
            }}
            aria-labelledby={`kanban-${column.kind}-${column.id || "unset"}`}
            {...(!context.isStatic && column.kind === "defined" ? {
              onDragOver: (event) => {
                event.preventDefault();
                setDragOverColumn(id);
              },
              onDragLeave: () => setDragOverColumn(undefined),
              onDrop: (event) => dropOnColumn(event, column.id)
            } : {})}
          >
            <h2 id={`kanban-${column.kind}-${column.id || "unset"}`}>
              {resolveLocalizedText(column.label, context.locale)} <small>({column.rows.length})</small>
            </h2>
            {data.summaries.length > 0 ? (
              <ul style={{ paddingInlineStart: "var(--space-5)", fontSize: "var(--size-ui)" }}>
                {data.summaries.map((definition, index) => {
                  const result = summarizeColumn(column.rows, definition, context.locale);
                  return <li key={`${definition.field.id}:${definition.method}:${index}`}>
                    {result.text}{!context.isStatic && result.excluded > 0 ? ` (${resolveLocalizedText({ ja: "値の形式が合わないため集計から除外", en: "Invalid values excluded" }, context.locale)}: ${result.excluded})` : ""}
                  </li>;
                })}
              </ul>
            ) : null}
            {!context.isStatic && sort.field === manualField && sorted.length > 1 ? (
              <Button disabled={savingOrder} onClick={() => void renumberColumn(sorted)}>
                {resolveLocalizedText({ ja: `並び順を付け直す (${sorted.length}件)`, en: `Renumber order (${sorted.length})` }, context.locale)}
              </Button>
            ) : null}
            {column.rows.length ? (
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
                {visibleRows.map((row) => (
                  <li key={row.name}>
                     <article
                       className={`kanban-card${draggingName === row.name ? " kanban-card--dragging" : ""}`}
                       style={cardStyle}
                       data-ticket-name={row.name}
                       aria-busy={movingNames.includes(row.name)}
                      {...(!context.isStatic ? {
                        draggable: true,
                        onDragStart: (event) => {
                          event.dataTransfer.setData("text/plain", row.name);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingName(row.name);
                        },
                        onDragEnd: () => {
                          setDraggingName(undefined);
                          setDragOverColumn(undefined);
                        }
                      } : {})}
                    >
                      <KindIcon resourceKind="Ticket" aria-hidden="true" />
                      <div style={{ minWidth: 0, width: "100%" }}>
                        <Button
                          className="kanban-card-title"
                          aria-describedby={!context.isStatic && data.statuses.length > 0
                            ? "kanban-keyboard-instructions" : undefined}
                          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                          onKeyDown={(event) => handleCardKeyDown(event, row)}
                          onClick={() => {
                            void context.openResource(row.name).then((result) => {
                              setMessage(result.ok ? "" : result.message);
                            });
                          }}
                        >
                          {row.title}
                        </Button>
                        {data.cardFields.length > 0 ? (
                          <dl style={{ margin: "var(--space-1) 0 0", fontSize: "var(--size-ui)" }}>
                            {data.cardFields.map((field) => {
                              const value = cardFieldValue(field, row.values[fieldKey(field.id)], context.locale);
                              return value === undefined ? null : (
                                <div key={field.id} style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                                  <dt>{field.label}:</dt><dd style={{ margin: 0 }}>{value}</dd>
                                </div>
                              );
                            })}
                          </dl>
                        ) : null}
                      </div>
                      {!context.isStatic && sort.field === manualField ? (
                        <span style={{ display: "flex", flexDirection: "column" }}>
                          <Button icon disabled={savingOrder || sorted.indexOf(row) === 0}
                            aria-label={`${row.title}: ${resolveLocalizedText({ ja: "上へ移動", en: "Move up" }, context.locale)}`}
                            onClick={() => void moveWithinColumn(sorted, sorted.indexOf(row), -1)}>↑</Button>
                          <Button icon disabled={savingOrder || sorted.indexOf(row) === sorted.length - 1}
                            aria-label={`${row.title}: ${resolveLocalizedText({ ja: "下へ移動", en: "Move down" }, context.locale)}`}
                            onClick={() => void moveWithinColumn(sorted, sorted.indexOf(row), 1)}>↓</Button>
                        </span>
                      ) : null}
                    </article>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{resolveLocalizedText({ ja: "チケットはありません", en: "No tickets" }, context.locale)}</p>
            )}
            {sorted.length > 20 ? (
              <Button onClick={() => setExpandedColumns((current) =>
                current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
              )}>
                {expanded
                  ? resolveLocalizedText({ ja: "20件に戻す", en: "Show first 20" }, context.locale)
                  : resolveLocalizedText({ ja: `残り${sorted.length - 20}件を表示`, en: `Show ${sorted.length - 20} more` }, context.locale)}
              </Button>
            ) : null}
          </section>
        );})}
      </div>
    </section>
  );
}
