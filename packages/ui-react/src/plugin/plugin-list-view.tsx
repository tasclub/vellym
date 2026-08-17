import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  resolveLocalizedText,
  type PluginColumnDescriptor,
  type PluginCommandInput,
  type PluginIndexValue,
  type PluginInputValue,
  type PluginLocalizedText,
  type PluginViewDescriptor
} from "@vellym/plugin-api";
import { PluginCommandDialog } from "./plugin-command-dialog.js";
import { DataTable, type SortDirection } from "../shared/table.js";
import { Button } from "../shared/button.js";
import styles from "./plugin.module.css";

export interface PluginViewRow {
  name: string;
  title: string;
  relativePath: string;
  values: Readonly<Record<string, PluginIndexValue>>;
  /** この行についての注意の件数。値は読めていて編集もできる */
  noticeCount?: number;
  /** この行についての読み込みの失敗の件数。注意と同じ見た目にしない */
  errorCount?: number;
}

export interface PluginViewPayload {
  pluginId: string;
  viewId: string;
  descriptor: PluginViewDescriptor;
  rows: PluginViewRow[];
  /** 既定の絞り込みを外した全件 */
  allRows: PluginViewRow[];
  /** このビューから起こせるコマンド */
  commands: Array<{
    id: string;
    title: PluginLocalizedText;
    inputs?: readonly PluginCommandInput[];
  }>;
  /** 詳細で編集する対象の現在値 */
  target?: PluginViewRow;
  /** 索引行では表せない現在値。繰り返し構造の編集に使う */
  targetSpec?: Readonly<Record<string, unknown>>;
  /** 開いているリソースについての注意 */
  targetDiagnostics?: Array<{ code: string; message: string; path?: string }>;
  /** 同じkindに登録された他のビュー */
  siblings?: Array<{ id: string; type: "list" | "detail"; label?: PluginLocalizedText }>;
}

/** 一括編集で書き込む1件ぶんの指示 */
export interface PluginBulkChange {
  names: string[];
  path: string[];
  value: string;
}

/** 行から列の値を取り出す。`title`だけはリソース自身の値を使う */
function cellValue(row: PluginViewRow, column: PluginColumnDescriptor): PluginIndexValue {
  if (column.id === "title") return row.title;
  return row.values[column.valueKey ?? column.id] ?? "";
}

/** 表示用の文字列。選択肢を持つ列は定義された表示名へ置き換える */
function cellText(
  value: PluginIndexValue,
  column: PluginColumnDescriptor,
  locale: string
): string {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      if (item === null) return "";
      const option = column.options?.find((candidate) => candidate.value === String(item));
      const text = option ? resolveLocalizedText(option.label, locale) : String(item);
      // 状態を色だけで伝えない。プラグインが宣言した記号を文言の前に置く。
      const marked = option?.symbol ? `${option.symbol} ${text}` : text;
      // 複数行の値は1行へ畳む。行の高さを値の中身に左右させない。
      return marked.replace(/\s*\n+\s*/g, " ").trim();
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * 並べ替えの比較。**列の型に従う。**
 *
 * すべてを文字列で比べると、数値の`9`が`10`の後ろへ、日付が桁の並びで
 * 前後する。利用者から見れば壊れている。
 */
function compareRows(
  left: PluginViewRow,
  right: PluginViewRow,
  column: PluginColumnDescriptor,
  locale: string
): number {
  const leftValue = cellValue(left, column);
  const rightValue = cellValue(right, column);
  if (column.type === "number") {
    const a = Number(leftValue);
    const b = Number(rightValue);
    const aOk = Number.isFinite(a);
    const bOk = Number.isFinite(b);
    // 数値として読めない値は末尾へ寄せる。並べ替えで消えてはならない。
    if (!aOk || !bOk) return aOk === bOk ? 0 : aOk ? -1 : 1;
    return a - b;
  }
  if (column.type === "boolean") {
    return Number(leftValue === true || leftValue === "true") -
      Number(rightValue === true || rightValue === "true");
  }
  // `date`は`YYYY-MM-DD`固定なので、文字列のままで日付順になる。
  // 空欄は末尾へ寄せる。未入力を先頭に並べても読む理由が無い。
  const a = cellText(leftValue, column, locale);
  const b = cellText(rightValue, column, locale);
  if (!a || !b) return a === b ? 0 : a ? -1 : 1;
  return a.localeCompare(b, locale);
}

/** 絞り込みの一致。選択肢のある列は完全一致、それ以外は部分一致 */
function matchesFilter(
  row: PluginViewRow,
  column: PluginColumnDescriptor,
  query: string
): boolean {
  if (!query) return true;
  const value = cellValue(row, column);
  const values = Array.isArray(value) ? value : [value];
  if (column.options) {
    return values.some((item) => String(item ?? "") === query);
  }
  const needle = query.toLowerCase();
  return values.some((item) => String(item ?? "").toLowerCase().includes(needle));
}

/** 絞り込みと並び順は個人設定。正本YAMLへ混ぜない */
interface ViewPreference {
  filters?: Record<string, string>;
  sort?: { columnId: string; direction: "asc" | "desc" };
  showAll?: boolean;
}

function preferenceKey(payload: PluginViewPayload): string {
  return `vellym.plugin-view.${payload.pluginId}.${payload.viewId}`;
}

function readPreference(key: string): ViewPreference {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ViewPreference) : {};
  } catch {
    return {};
  }
}

function writePreference(key: string, value: ViewPreference): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても一覧は使える。個人設定のために操作を止めない。
  }
}

/**
 * プラグインが宣言した一覧descriptorを描く汎用レンダラ。
 *
 * プラグイン固有のコンポーネントを持たない。宣言で表現できる範囲は、
 * ここが持つアクセシビリティと多言語表示をそのまま受け取る。
 */
export function PluginListView({
  payload,
  locale,
  allRows,
  showAll,
  onToggleShowAll,
  hideTitle,
  onOpen,
  onRunCommand,
  onOpenView,
  onBulkChange,
  onBulkArchive
}: {
  payload: PluginViewPayload;
  locale: string;
  /** 既定の絞り込みを外した全件。切替のために別で受け取る */
  allRows?: PluginViewRow[];
  showAll?: boolean;
  onToggleShowAll?(next: boolean): void;
  hideTitle?: boolean;
  onOpen?(name: string): void;
  onRunCommand?(commandId: string, input: Record<string, PluginInputValue>): void;
  onOpenView?(viewId: string): void;
  /** 選んだ行へまとめて書き込む。失敗した行の名前を返す */
  onBulkChange?(change: PluginBulkChange): Promise<string[]>;
  /** 選んだ行をアーカイブへ移す。失敗した行の名前を返す */
  onBulkArchive?(names: string[]): Promise<string[]>;
}) {
  const { t } = useTranslation();
  const key = preferenceKey(payload);
  const stored = useMemo(() => readPreference(key), [key]);

  const [command, setCommand] = useState<PluginViewPayload["commands"][number]>();
  const [filters, setFilters] = useState<Record<string, string>>(stored.filters ?? {});
  const [sort, setSort] = useState<{ columnId: string; direction: "asc" | "desc" } | undefined>(
    stored.sort ??
      (payload.descriptor.type === "list" ? payload.descriptor.defaultSort : undefined)
  );
  // 表示集合と選択集合を分けて持つ。絞り込みを変えても選択は消えない。
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkColumn, setBulkColumn] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: number }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    writePreference(key, { filters, ...(sort ? { sort } : {}), showAll });
  }, [key, filters, sort, showAll]);

  const descriptor = payload.descriptor.type === "list" ? payload.descriptor : undefined;
  const columns = useMemo(
    () => (descriptor?.columns ?? []).filter((column) => !column.secondary),
    [descriptor]
  );
  const secondary = useMemo(
    () => (descriptor?.columns ?? []).filter((column) => column.secondary),
    [descriptor]
  );
  const filterable = useMemo(
    () => (descriptor?.columns ?? []).filter((column) => column.filterable),
    [descriptor]
  );
  const editable = useMemo(
    () => (descriptor?.columns ?? []).filter((column) => column.editPath?.length),
    [descriptor]
  );

  const source = showAll && allRows ? allRows : payload.rows;
  const rows = useMemo(() => {
    const filtered = source.filter((row) =>
      (descriptor?.columns ?? []).every((column) =>
        matchesFilter(row, column, filters[column.id] ?? "")
      )
    );
    if (!sort) return filtered;
    const column = descriptor?.columns.find((item) => item.id === sort.columnId);
    if (!column) return filtered;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort(
      (left, right) => factor * compareRows(left, right, column, locale)
    );
  }, [source, sort, filters, descriptor, locale]);

  if (!descriptor) return null;

  const bulkTarget = editable.find((column) => column.id === bulkColumn);
  const runBulk = async (run: () => Promise<string[]>) => {
    setBusy(true);
    try {
      const failed = await run();
      // 途中で失敗しても成功した分は残す。全体を取り消さない。
      // 失敗した行は選択に残し、個別に開いて直せるようにする。
      setBulkResult({ ok: selected.length - failed.length, failed: failed.length });
      setSelected(failed);
    } finally {
      setBusy(false);
    }
  };

  // 「いま何件見えていて、全部で何件あるか」を出す。絞り込みで消えた分に
  // 気づけるようにする。
  const total = (allRows ?? payload.rows).length;
  const toolbar = (
    <div className={styles["plugin-list-toolbar"]}>
      <span className={styles["plugin-list-count"]}>
        {rows.length === total
          ? t("plugin.rowCount", { count: rows.length })
          : t("plugin.rowCountOf", { count: rows.length, total })}
      </span>
      {onOpenView
        ? (payload.siblings ?? [])
            .filter((sibling) => sibling.id !== payload.viewId && sibling.label)
            .map((sibling) => (
              <Button
                key={sibling.id}
                onClick={() => onOpenView(sibling.id)}
              >
                {resolveLocalizedText(sibling.label!, locale)}
              </Button>
            ))
        : null}
      {onRunCommand
        ? payload.commands.map((item) => (
            <Button
              key={item.id}
              onClick={() => {
                if (!item.inputs?.length) {
                  onRunCommand(item.id, {});
                  return;
                }
                setCommand(item);
              }}
            >
              {resolveLocalizedText(item.title, locale)}
            </Button>
          ))
        : null}
    </div>
  );

  const filterBar = filterable.length ? (
    <div className={styles["plugin-list-filters"]}>
      <span className={styles["plugin-band-label"]} aria-hidden="true">
        FILTER
      </span>
      {/*
        既定の絞り込みは、列ごとの絞り込みと同じ帯へ置く。別の場所に
        「完了を含める」のような切替を持つと、同じことを二か所で操作させる。
        文言はプラグインが宣言したものを使う。hostが種別の語を持たない。
      */}
      {onToggleShowAll
        ? (descriptor.defaultFilters ?? [])
            .filter((filter) => filter.toggleLabels)
            .map((filter) => (
              <Button
                key={filter.columnId}
                aria-pressed={showAll !== true}
                onClick={() => onToggleShowAll(!showAll)}
              >
                {/*
                  押した結果ではなく、**いま何が表示されているか**を出す。
                  押しても位置も形も変わらないため、文言が変わらないと
                  入と切のどちらなのかが読めない。
                */}
                {resolveLocalizedText(
                  showAll ? filter.toggleLabels!.cleared : filter.toggleLabels!.applied,
                  locale
                )}
              </Button>
            ))
        : null}
      {filterable.map((column) => {
        const id = `plugin-filter-${column.id}`;
        const label = resolveLocalizedText(column.label, locale);
        return (
          <label key={column.id} htmlFor={id}>
            <span>{label}</span>
            {column.options ? (
              <select
                id={id}
                value={filters[column.id] ?? ""}
                onChange={(event) =>
                  setFilters({ ...filters, [column.id]: event.target.value })
                }
              >
                <option value="">{t("plugin.filterAny")}</option>
                {column.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {resolveLocalizedText(option.label, locale)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                value={filters[column.id] ?? ""}
                placeholder={t("plugin.filterContains")}
                onChange={(event) =>
                  setFilters({ ...filters, [column.id]: event.target.value })
                }
              />
            )}
          </label>
        );
      })}
      {Object.values(filters).some(Boolean) ? (
        <Button onClick={() => setFilters({})}>
          {t("plugin.filterClear")}
        </Button>
      ) : null}
    </div>
  ) : null;

  const selectable = Boolean(onBulkChange || onBulkArchive);
  const bulkBar =
    selectable && selected.length ? (
      <div className={styles["plugin-list-bulk"]}>
        <p aria-live="polite">{t("plugin.selectedCount", { count: selected.length })}</p>
        {onBulkChange && editable.length ? (
          <>
            <label htmlFor="plugin-bulk-column">
              <span className="visually-hidden">{t("plugin.bulkColumn")}</span>
              <select
                id="plugin-bulk-column"
                value={bulkColumn}
                onChange={(event) => {
                  setBulkColumn(event.target.value);
                  setBulkValue("");
                }}
              >
                <option value="">{t("plugin.bulkColumn")}</option>
                {editable.map((column) => (
                  <option key={column.id} value={column.id}>
                    {resolveLocalizedText(column.label, locale)}
                  </option>
                ))}
              </select>
            </label>
            {bulkTarget ? (
              <label htmlFor="plugin-bulk-value">
                <span className="visually-hidden">{t("plugin.bulkValue")}</span>
                <select
                  id="plugin-bulk-value"
                  value={bulkValue}
                  onChange={(event) => setBulkValue(event.target.value)}
                >
                  <option value="">{t("plugin.bulkValue")}</option>
                  {(bulkTarget.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {resolveLocalizedText(option.label, locale)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              disabled={!bulkTarget || !bulkValue || busy}
              onClick={() =>
                runBulk(() =>
                  onBulkChange({
                    names: [...selected],
                    path: [...(bulkTarget?.editPath ?? [])],
                    value: bulkValue
                  })
                )
              }
            >
              {t("plugin.bulkApply")}
            </Button>
          </>
        ) : null}
        {onBulkArchive ? (
          <Button
            disabled={busy}
            onClick={() => runBulk(() => onBulkArchive([...selected]))}
          >
            {t("plugin.bulkArchive")}
          </Button>
        ) : null}
        <Button onClick={() => setSelected([])}>
          {t("plugin.clearSelection")}
        </Button>
      </div>
    ) : null;

  const bulkReport = bulkResult ? (
    <p className="notice" role="status">
      {t("plugin.bulkResult", { ok: bulkResult.ok, failed: bulkResult.failed })}
    </p>
  ) : null;

  const dialog =
    command && onRunCommand ? (
      <PluginCommandDialog
        command={command}
        locale={locale}
        onCancel={() => setCommand(undefined)}
        onSubmit={(input) => {
          onRunCommand(command.id, input);
          setCommand(undefined);
        }}
      />
    ) : null;

  const header = (
    <>
      {hideTitle ? null : <h1>{resolveLocalizedText(descriptor.title, locale)}</h1>}
      {toolbar}
      {filterBar}
      {bulkBar}
      {bulkReport}
      {dialog}
    </>
  );

  if (!rows.length) {
    // `plugin-list`は紙の幅を変えるための目印。`:has()`が参照するので残す
    return (
      <div className="plugin-list dense">
        {header}
        <p className="notice">
          {descriptor.emptyState
            ? resolveLocalizedText(descriptor.emptyState.message, locale)
            : t("search.empty")}
        </p>
        {/* 0件でも作成へ誘導する。エラー画面にしない。 */}
        {descriptor.emptyState?.commandId && onRunCommand
          ? payload.commands
              .filter((item) => item.id === descriptor.emptyState?.commandId)
              .map((item) => (
                <Button
                  key={item.id}
                  onClick={() =>
                    item.inputs?.length ? setCommand(item) : onRunCommand(item.id, {})
                  }
                >
                  {resolveLocalizedText(item.title, locale)}
                </Button>
              ))
          : null}
      </div>
    );
  }

  const allSelected = rows.every((row) => selected.includes(row.name));

  return (
    <div className="plugin-list">
      {header}
      <DataTable
        rows={rows}
        rowKey={(row) => row.name}
        caption={resolveLocalizedText(descriptor.title, locale)}
        selection={
          selectable
            ? {
                selectAllLabel: t("plugin.selectAll"),
                allSelected,
                isSelected: (row) => selected.includes(row.name),
                rowLabel: (row) => row.title,
                onToggleRow: (row, isSelected) =>
                  setSelected(
                    isSelected
                      ? [...selected, row.name]
                      : selected.filter((name) => name !== row.name)
                  ),
                onToggleAll: (isSelected) =>
                  setSelected(
                    isSelected
                      ? [...new Set([...selected, ...rows.map((row) => row.name)])]
                      : selected.filter((name) => !rows.some((row) => row.name === name))
                  )
              }
            : undefined
        }
        columns={columns.map((column) => ({
          id: column.id,
          label: resolveLocalizedText(column.label, locale),
          ...(column.sortable
            ? {
                sort: ((): SortDirection => {
                  if (sort?.columnId !== column.id) return "none";
                  return sort.direction === "asc" ? "ascending" : "descending";
                })(),
                onSort: () =>
                  setSort({
                    columnId: column.id,
                    direction:
                      sort?.columnId === column.id && sort.direction === "asc"
                        ? "desc"
                        : "asc"
                  })
              }
            : {}),
          cell: (row: PluginViewRow) =>
            column.id === "title" ? (
              <>
                <button
                  type="button"
                  className={styles["plugin-list-open"]}
                  onClick={() => onOpen?.(row.name)}
                >
                  {row.title}
                </button>
                {/*
                  読み込めない行と、値は読めていて注意があるだけの行を
                  区別する。同じ見た目にすると、直すべきものが埋もれる。
                */}
                {row.errorCount ? (
                  <span className={styles["plugin-list-error"]}>{t("plugin.unreadableRow")}</span>
                ) : row.noticeCount ? (
                  <span className={styles["plugin-list-notice"]} title={t("plugin.hasNotices")}>
                    {t("plugin.noticeCount", { count: row.noticeCount })}
                  </span>
                ) : null}
                {/* 副次的な列は行を増やさずに畳む。2万件で行を積み上げない。 */}
                {secondary.length ? (
                  <span className={styles["plugin-list-secondary"]}>
                    {secondary
                      .map((item) => {
                        const text = cellText(cellValue(row, item), item, locale);
                        if (!text) return "";
                        const label = resolveLocalizedText(item.label, locale);
                        // 長い値は畳んだ行をさらに崩す。全文は詳細で読む。
                        const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
                        return `${label}: ${short}`;
                      })
                      .filter(Boolean)
                      .join(" / ")}
                  </span>
                ) : null}
              </>
            ) : (
              cellText(cellValue(row, column), column, locale)
            )
        }))}
      />
    </div>
  );
}
