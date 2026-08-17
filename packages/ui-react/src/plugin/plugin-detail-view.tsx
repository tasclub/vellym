import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  resolveLocalizedText,
  type PluginDetailViewDescriptor,
  type PluginFieldDescriptor,
  type PluginGroupFieldDescriptor,
  type PluginIndexValue
} from "@vellym/plugin-api";
import type { PluginViewPayload, PluginViewRow } from "./plugin-list-view.js";
import { DataTable } from "../shared/table.js";
import {
  FieldInput,
  RequiredMark,
  asText,
  toSpecValue,
  valueKeyOf,
  type PluginSpecValue
} from "../shared/field-input.js";
import { Button } from "../shared/button.js";
import styles from "./plugin.module.css";

export type { PluginSpecValue };

function isGroup(
  field: PluginFieldDescriptor | PluginGroupFieldDescriptor
): field is PluginGroupFieldDescriptor {
  return field.type === "group";
}

/**
 * 宣言に無い値。定義から消えた項目がここに入る。
 *
 * `undeclaredFields: "read-only"`のときだけ、値を保持したまま読み取り専用で見せる。
 * 表示しないことと削除することを混同しない。
 */
function undeclaredEntries(
  descriptor: PluginDetailViewDescriptor,
  row: PluginViewRow | undefined
): Array<[string, PluginIndexValue]> {
  const prefix = descriptor.undeclaredKeyPrefix;
  if (!row || !prefix || descriptor.undeclaredFields === "hidden") return [];
  const declared = new Set(
    descriptor.fields.filter((field) => !isGroup(field)).map((field) => valueKeyOf(field))
  );
  return Object.entries(row.values).filter(
    ([key]) => key.startsWith(prefix) && !declared.has(key)
  );
}

/** 参照のときに出す文字列。選択肢は表示名へ、記号があれば前に置く */
function displayText(
  field: PluginFieldDescriptor,
  value: string,
  locale: string
): string {
  if (!value) return "";
  const option = field.options?.find((candidate) => candidate.value === value);
  if (!option) return value;
  const label = resolveLocalizedText(option.label, locale);
  return option.symbol ? `${option.symbol} ${label}` : label;
}

type GroupRow = Record<string, string>;

/** 繰り返し行の入れ替え。並び順が表示順であり、先頭が新規作成時の初期値になる */
function moveRow(rows: GroupRow[], index: number, delta: number): GroupRow[] {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

/**
 * プラグインが宣言した詳細descriptorを描く汎用レンダラ。
 *
 * **参照と編集を分ける。**
 *
 * - `mode: "read"` は値を読むだけ。入力欄も保存も出さない。
 * - `mode: "edit"` は入力欄を出すが、**自分では保存しない。** 変更を親へ渡し、
 *   タイトル・本文と一緒に1回の保存で書く。属性だけが別の保存経路を持つと、
 *   利用者から見て「どれを押せば何が保存されるのか」が分からなくなる。
 *
 * `mode: "settings"` は定義そのものの編集で、繰り返し構造を自分で保存する。
 * こちらは本文もタイトルも持たないため、まとめる相手がいない。
 */
export function PluginDetailView({
  payload,
  locale,
  mode,
  onSave,
  onChange
}: {
  payload: PluginViewPayload;
  locale: string;
  mode: "read" | "edit" | "settings";
  /**
   * 値が変わったときに親へ渡す。`mode: "edit"`のときだけ呼ぶ。
   *
   * **効果（`useEffect`）からは呼ばない。** 入力の操作から直接呼ぶ。
   * 描き終わってから親へ知らせる形にすると、親の描き直しが次の通知を生み、
   * 更新が止まらなくなる。
   */
  onChange?(changes: Array<{ path: string[]; value: PluginSpecValue }>): void;
  onSave?(
    changes: Array<{ path: string[]; value: PluginSpecValue }>
  ): Promise<void> | void;
}) {
  const { t } = useTranslation();
  const descriptor =
    payload.descriptor.type === "detail" ? payload.descriptor : undefined;
  const row = payload.target;
  const spec = payload.targetSpec ?? {};

  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of descriptor?.fields ?? []) {
      if (isGroup(field)) continue;
      values[field.id] = asText(row?.values[valueKeyOf(field)]);
    }
    return values;
  }, [descriptor, row]);

  const initialGroups = useMemo(() => {
    const groups: Record<string, GroupRow[]> = {};
    for (const field of descriptor?.fields ?? []) {
      if (!isGroup(field)) continue;
      const source = field.path.reduce<unknown>(
        (value, key) => (value as Record<string, unknown> | undefined)?.[key],
        spec
      );
      groups[field.id] = (Array.isArray(source) ? source : []).map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        const entry: GroupRow = {};
        for (const child of field.fields) {
          const raw = record[child.path[child.path.length - 1] ?? child.id];
          entry[child.id] = raw === undefined || raw === null ? "" : String(raw);
        }
        return entry;
      });
    }
    return groups;
  }, [descriptor, spec]);

  const [draft, setDraft] = useState(initial);
  const [groups, setGroups] = useState(initialGroups);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(initial), [initial]);
  useEffect(() => setGroups(initialGroups), [initialGroups]);

  const singleFields = useMemo(
    () => (descriptor?.fields ?? []).filter((field) => !isGroup(field)),
    [descriptor]
  );

  /**
   * 1つの項目を書き換え、その場で親へ渡す。
   *
   * 次の値から変更の一覧を作り直して渡す。`draft`の更新を待って効果で送ると、
   * 親の描き直しと往復して更新が止まらなくなる。
   */
  function updateField(id: string, value: string) {
    const next = { ...draft, [id]: value };
    setDraft(next);
    if (mode !== "edit" || !onChange) return;
    onChange(
      singleFields
        .filter((field) => next[field.id] !== initial[field.id])
        .map((field) => ({
          path: [...field.path],
          value: toSpecValue(field, next[field.id] ?? "")
        }))
    );
  }

  if (!descriptor) return null;
  const changed =
    Object.keys(draft).some((id) => draft[id] !== initial[id]) ||
    JSON.stringify(groups) !== JSON.stringify(initialGroups);
  const undeclared = undeclaredEntries(descriptor, row);

  const updateGroup = (id: string, next: GroupRow[]) =>
    setGroups({ ...groups, [id]: next });

  const notices = payload.targetDiagnostics ?? [];

  // `plugin-detail`は紙の見た目を外から変えるための目印である。
  // `styles.css`の`:has()`が参照するため、**モジュール化せずグローバルに残す。**
  return (
    <div className="plugin-detail">
      {notices.length ? (
        <div className={styles["plugin-detail-notices"]} role="note">
          <p>{t("plugin.notices")}</p>
          <ul>
            {notices.map((notice) => (
              <li key={`${notice.code}${notice.path ?? ""}`}>{notice.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className={styles["plugin-detail-fields"]}>
        {descriptor.fields.filter((field) => !isGroup(field)).map((field) => (
          <div key={field.id} className={styles["plugin-detail-field"]}>
            <dt>
              {mode === "read" ? (
                <span>{resolveLocalizedText(field.label, locale)}</span>
              ) : (
                <label htmlFor={`plugin-field-${field.id}`}>
                  {resolveLocalizedText(field.label, locale)}
                  {field.required ? <RequiredMark /> : null}
                </label>
              )}
            </dt>
            <dd>
              {mode === "read" ? (
                // 参照は読むだけ。入力欄を出さない。空欄は「―」で場所を残す。
                <span className={styles["plugin-detail-value"]}>
                  {displayText(field, draft[field.id] ?? "", locale) || "—"}
                </span>
              ) : (
                <FieldInput
                  field={field}
                  id={`plugin-field-${field.id}`}
                  value={draft[field.id] ?? ""}
                  locale={locale}
                  disabled={field.readOnly}
                  onChange={(next) => updateField(field.id, next)}
                />
              )}
              {/*
                空であることをその場で示す。画面からの保存はこれが残っている間
                通らないが、**開くことも直すこともやめることも妨げない。**
              */}
              {mode !== "read" && field.required && !draft[field.id] ? (
                <span className={styles["plugin-detail-note"]}>{t("plugin.requiredEmpty")}</span>
              ) : null}
            </dd>
          </div>
        ))}
        {undeclared.map(([key, value]) => (
          <div key={key} className={`${styles["plugin-detail-field"]} ${styles["plugin-detail-undeclared"]}`}>
            <dt>{key.slice((descriptor.undeclaredKeyPrefix ?? "").length)}</dt>
            <dd>
              <span>{asText(value)}</span>
              <span className={styles["plugin-detail-note"]}>{t("plugin.undeclaredField")}</span>
            </dd>
          </div>
        ))}
      </dl>

      {mode === "settings"
        ? descriptor.fields.filter(isGroup).map((group) => {
        const rows = groups[group.id] ?? [];
        return (
          <section key={group.id} className={styles["plugin-detail-group"]}>
            <h2>{resolveLocalizedText(group.label, locale)}</h2>
            {group.description ? (
              <p className={styles["plugin-detail-note"]}>
                {resolveLocalizedText(group.description, locale)}
              </p>
            ) : null}
            <DataTable
              rows={rows}
              rowKey={(_, index) => String(index)}
              caption={resolveLocalizedText(group.label, locale)}
              columns={[
                ...group.fields.map((child) => ({
                  id: child.id,
                  label: resolveLocalizedText(child.label, locale),
                  cell: (entry: Record<string, string>, index: number) => (
                    <FieldInput
                      field={child}
                      id={`plugin-group-${group.id}-${index}-${child.id}`}
                      value={entry[child.id] ?? ""}
                      locale={locale}
                      disabled={false}
                      onChange={(next) =>
                        updateGroup(
                          group.id,
                          rows.map((item, position) =>
                            position === index ? { ...item, [child.id]: next } : item
                          )
                        )
                      }
                    />
                  )
                })),
                {
                  id: "actions",
                  label: t("plugin.rowActions"),
                  labelHidden: true,
                  cell: (_entry: Record<string, string>, index: number) => (
                    <>
                      {/*
                        並び順が表示順であり、先頭が新規作成時の初期値になる。
                        並べ替えられなければ、どちらも利用者が決められない。
                      */}
                      <Button
                        disabled={index === 0}
                        aria-label={t("plugin.moveUp")}
                        onClick={() => updateGroup(group.id, moveRow(rows, index, -1))}
                      >
                        ↑
                      </Button>
                      <Button
                        disabled={index === rows.length - 1}
                        aria-label={t("plugin.moveDown")}
                        onClick={() => updateGroup(group.id, moveRow(rows, index, 1))}
                      >
                        ↓
                      </Button>
                      <Button
                        onClick={() =>
                          updateGroup(
                            group.id,
                            rows.filter((_, position) => position !== index)
                          )
                        }
                      >
                        {t("plugin.removeRow")}
                      </Button>
                    </>
                  )
                }
              ]}
            />
            {true ? (
              <Button
                onClick={() => updateGroup(group.id, [...rows, {}])}
              >
                {group.addLabel
                  ? resolveLocalizedText(group.addLabel, locale)
                  : t("plugin.addRow")}
              </Button>
            ) : null}
          </section>
            );
          })
        : null}

      {mode === "settings" && onSave ? (
        <Button className={styles["plugin-detail-save"]}
          disabled={!changed || saving}
          onClick={async () => {
            setSaving(true);
            try {
              const changes: Array<{ path: string[]; value: PluginSpecValue }> = [];
              for (const field of descriptor.fields) {
                if (isGroup(field)) {
                  if (JSON.stringify(groups[field.id]) === JSON.stringify(initialGroups[field.id])) {
                    continue;
                  }
                  changes.push({
                    path: [...field.path],
                    value: (groups[field.id] ?? [])
                      // すべて空の行は書き出さない。追加しただけの行を残さない。
                      .filter((entry) => Object.values(entry).some((value) => value))
                      .map((entry) => {
                        const item: Record<string, PluginSpecValue> = {};
                        for (const child of field.fields) {
                          const value = toSpecValue(child, entry[child.id] ?? "");
                          if (value !== null) {
                            item[child.path[child.path.length - 1] ?? child.id] = value;
                          }
                        }
                        return item;
                      })
                  });
                  continue;
                }
                if (draft[field.id] === initial[field.id]) continue;
                changes.push({
                  path: [...field.path],
                  value: toSpecValue(field, draft[field.id] ?? "")
                });
              }
              await onSave(changes);
            } finally {
              setSaving(false);
            }
          }}
        >
          {t("editor.save")}
        </Button>
      ) : null}
    </div>
  );
}
