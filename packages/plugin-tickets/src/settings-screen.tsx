import { useMemo, useState } from "react";
import { resolveLocalizedText, type PluginLocalizedText, type PluginRenderContext, type PluginValueType } from "@vellym/plugin-api";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { Button } from "@vellym/plugin-api/ui";
import { moveRelative, moveTo, newKey, SortableRow } from "./sortable.js";

/**
 * 定義の編集画面。**プラグインが自分で描く。**
 *
 * 宣言（`type: "group"`）では選択肢を編集できない。選択肢は「繰り返し構造の
 * 中の繰り返し構造」であり、`group`は入れ子を持てないためである。契約へ
 * 入れ子を足すと、プラグインが新しい見せ方を欲しがるたびにCoreの契約が太る
 * 問題が再発する。**だからここはプラグイン側で描く。**
 *
 * 操作はhostの`Button`を使う。実体はimport mapで受け取り、型は
 * `@vellym/plugin-api/ui`から得る。**第三者のプラグインと同じ経路である。** 入力欄は素の要素で描く
 * （`FieldInput`は保存pathを前提にした宣言を要求するため、画面の中だけの
 * 一時的な入力には向かない）。字の大きさと余白はトークンが継承で降りてくる。
 */

interface StatusRow {
  key: string;
  id: string;
  label: string;
  category: "open" | "closed";
}

interface OptionRow {
  key: string;
  value: string;
  label: string;
}

interface FieldRow {
  key: string;
  id: string;
  label: string;
  type: PluginValueType;
  required: boolean;
  listColumn: boolean;
  options: OptionRow[];
}

const TYPES: PluginValueType[] = [
  "text",
  "multiline",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
  "reference"
];

/** 選択肢を持てる型。ここだけ選択肢の編集を出す */
function hasOptions(type: PluginValueType): boolean {
  return type === "select" || type === "multiselect";
}

function readStatuses(spec: Readonly<Record<string, unknown>>): StatusRow[] {
  const list = Array.isArray(spec.statuses) ? spec.statuses : [];
  return list.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      key: newKey(),
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      category: row.category === "closed" ? ("closed" as const) : ("open" as const)
    };
  });
}

function readFields(spec: Readonly<Record<string, unknown>>): FieldRow[] {
  const list = Array.isArray(spec.fields) ? spec.fields : [];
  return list.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const options = Array.isArray(row.options) ? row.options : [];
    return {
      key: newKey(),
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      type: (TYPES.includes(row.type as PluginValueType)
        ? row.type
        : "text") as PluginValueType,
      required: row.required === true,
      listColumn: row.listColumn === true,
      options: options.map((option) => {
        const entry = (option ?? {}) as Record<string, unknown>;
        return { key: newKey(), value: String(entry.value ?? ""), label: String(entry.label ?? "") };
      })
    };
  });
}

export function TrackerSettingsScreen({ context }: PluginViewProps) {
  return <Screen context={context} />;
}

function Screen({ context }: { context: PluginRenderContext }) {
  const spec = context.target?.spec ?? {};
  const [statuses, setStatuses] = useState(() => readStatuses(spec));
  const [fields, setFields] = useState(() => readFields(spec));
  const savedHierarchy = typeof spec.hierarchy === "object" && spec.hierarchy !== null &&
    !Array.isArray(spec.hierarchy) ? spec.hierarchy as Record<string, unknown> : {};
  const [parentField, setParentField] = useState(() =>
    typeof savedHierarchy.parentField === "string" ? savedHierarchy.parentField : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmingStatusRemoval, setConfirmingStatusRemoval] = useState<string | null>(null);
  const [confirmingOptionRemoval, setConfirmingOptionRemoval] = useState<string | null>(null);
  const text = (japanese: string, english: string) => resolveLocalizedText(
    { ja: japanese, en: english } satisfies PluginLocalizedText,
    context.locale
  );

  /**
   * 値ごとの使用件数。
   *
   * **使用中の選択肢やステータスを消すときに件数を出す**（受入C03）。
   * 索引行だけで数えられるので、チケット本体は読み直さない。
   */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of context.rows) {
      for (const [key, value] of Object.entries(row.values)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item === undefined || item === null || item === "") continue;
          const mapKey = `${key} ${String(item)}`;
          counts.set(mapKey, (counts.get(mapKey) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [context.rows]);

  const usedBy = (key: string, value: string) => usage.get(`${key} ${value}`) ?? 0;

  const usageBadge = (count: number) =>
    text(`${count}件`, `${count} in use`);

  const usageDescription = (count: number) =>
    text(
      `${count}件がこの値を使っています`,
      `${count} ${count === 1 ? "ticket uses" : "tickets use"} this value`
    );

  const removalConfirmation = (count: number) =>
    text(
      `${count}件が使用中です。削除すると定義外になります。`,
      `${count} ${count === 1 ? "ticket is" : "tickets are"} using this value. Removing it leaves them undefined.`
    );

  const idTitle = text(
    "保存した後は変えないでください。変えると、その値を使うチケットが定義外になります",
    "Do not change this ID after saving. Changing it makes tickets using this value undefined."
  );
  async function submit() {
    setSaving(true);
    setMessage("");
    const result = await context.save([
      {
        path: ["statuses"],
        value: statuses.map((row) => ({
          id: row.id,
          label: row.label,
          category: row.category
        }))
      },
      {
        path: ["fields"],
        value: fields.map((row) => ({
          id: row.id,
          label: row.label,
          type: row.type,
          required: row.required,
          listColumn: row.listColumn,
          /*
           * **空の選択肢は書かない。**
           *
           * 型が`select`でも1件も無いなら`options`ごと省く。空配列を残すと、
           * 正本YAMLに意味の無いキーが増える。選択肢を持たない型に書かない
           * のも同じ理由である。実際に一度`options: []`を書いてしまった。
           */
          ...(hasOptions(row.type) && row.options.length
            ? { options: row.options.map(({ value, label }) => ({ value, label })) }
            : {})
        }))
      },
      ...(parentField || savedHierarchy.parentField !== undefined
        ? [{ path: ["hierarchy", "parentField"], value: parentField || null }] : [])
    ]);
    setSaving(false);
    setMessage(result.ok ? text("保存しました", "Saved") : result.message);
  }

  if (context.isStatic) {
    // 静的出力では編集の導線を出さない。**disabledで残さない。**
    return <p>{text("この画面は閲覧のみです", "This view is read-only.")}</p>;
  }

  return (
    <div className="tickets-settings" data-plugin="tickets" data-view="tracker-settings">
      <h2>{text("ステータス", "Statuses")}</h2>
      <div className="tickets-settings-header tickets-settings-status-grid" aria-hidden="true">
        <span title={idTitle}>{text("ID", "ID")}</span><span>{text("表示名", "Label")}</span>
        <span>{text("区分", "Category")}</span><span>{text("操作", "Actions")}</span>
      </div>
      {statuses.map((row, index) => {
        const inUse = usedBy("status", row.id);
        const confirmingRemoval = confirmingStatusRemoval === row.key;
        const patch = (change: Partial<StatusRow>) => {
          if (change.id !== undefined) {
            setConfirmingStatusRemoval((key) => key === row.key ? null : key);
          }
          setStatuses(
            statuses.map((item, position) =>
              position === index ? { ...item, ...change } : item
            )
          );
        };
        return (
          <SortableRow key={row.key} rowKey={row.key} group="statuses" label={text(`並び替え: ${row.id}`, `Reorder: ${row.id}`)}
            className="tickets-settings-status-grid tickets-settings-row" rowType="status"
            onMove={(delta) => setStatuses((list) => moveTo(list, index, index + delta))}
            onDropAt={(source, side) => setStatuses((list) => moveRelative(list, source, row.key, side))}>
            <label>
              <span className="tickets-settings-cell-label">{text("ID", "ID")}</span>
              <input
                type="text"
                value={row.id}
                onChange={(event) => patch({ id: event.target.value })}
              />
            </label>
            <label>
              <span className="tickets-settings-cell-label">{text("表示名", "Label")}</span>
              <input
                type="text"
                value={row.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </label>
            <label>
              <span className="tickets-settings-cell-label">{text("区分", "Category")}</span>
              <select
                value={row.category}
                onChange={(event) =>
                  patch({
                    category: event.target.value === "closed" ? "closed" : "open"
                  })
                }
              >
                <option value="open">{text("未完了", "Open")}</option>
                <option value="closed">{text("完了", "Closed")}</option>
              </select>
            </label>
            <div className="tickets-settings-actions">
              {index === 0
                ? <span className="tickets-settings-badge" data-marker="default">{text("初期値", "Default")}</span>
                : null}
              {inUse > 0
                ? <span className="tickets-settings-badge" data-marker="usage" aria-label={usageDescription(inUse)} title={usageDescription(inUse)}>
                    {usageBadge(inUse)}
                  </span>
                : null}
              {confirmingRemoval ? (
                <>
                  <Button onClick={() => {
                    setStatuses((list) => list.filter((item) => item.key !== row.key));
                    setConfirmingStatusRemoval(null);
                  }}>
                    {text("削除する", "Delete")}
                  </Button>
                  <Button onClick={() => setConfirmingStatusRemoval(null)}>
                    {text("やめる", "Cancel")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => {
                  if (inUse > 0) setConfirmingStatusRemoval(row.key);
                  else setStatuses((list) => list.filter((item) => item.key !== row.key));
                }}>
                  {text("削除", "Remove")}
                </Button>
              )}
            </div>
            {confirmingRemoval ? <span role="status">{removalConfirmation(inUse)}</span> : null}
          </SortableRow>
        );
      })}
      <Button
        
        onClick={() =>
          setStatuses([...statuses, { key: newKey(), id: "", label: "", category: "open" }])
        }
      >
        {text("ステータスを追加", "Add status")}
      </Button>

      <h2>{text("項目", "Fields")}</h2>
      <div className="tickets-settings-header tickets-settings-field-grid" aria-hidden="true">
        <span title={idTitle}>{text("ID", "ID")}</span><span>{text("表示名", "Label")}</span>
        <span>{text("型", "Type")}</span><span>{text("必須", "Required")}</span>
        <span>{text("一覧に出す", "Show in list")}</span><span>{text("操作", "Actions")}</span>
      </div>
      {fields.map((row, index) => {
        const patch = (change: Partial<FieldRow>) =>
          setFields(
            fields.map((item, position) =>
              position === index ? { ...item, ...change } : item
            )
          );
        return (
          <SortableRow key={row.key} rowKey={row.key} group="fields" label={text(`並び替え: ${row.id}`, `Reorder: ${row.id}`)}
            className="tickets-settings-field-grid tickets-settings-row" rowType="field"
            onMove={(delta) => setFields((list) => moveTo(list, index, index + delta))}
            onDropAt={(source, side) => setFields((list) => moveRelative(list, source, row.key, side))}>
            <label>
              <span className="tickets-settings-cell-label">{text("ID", "ID")}</span>
              <input
                type="text"
                value={row.id}
                onChange={(event) => patch({ id: event.target.value })}
              />
            </label>
            <label>
              <span className="tickets-settings-cell-label">{text("表示名", "Label")}</span>
              <input
                type="text"
                value={row.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </label>
            <label>
              <span className="tickets-settings-cell-label">{text("型", "Type")}</span>
              <select
                value={row.type}
                onChange={(event) =>
                  patch({ type: event.target.value as PluginValueType })
                }
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="tickets-settings-cell-label">{text("必須", "Required")}</span>
              <input
                type="checkbox"
                checked={row.required}
                onChange={(event) => patch({ required: event.target.checked })}
              />
            </label>
            <label>
              <span className="tickets-settings-cell-label">{text("一覧に出す", "Show in list")}</span>
              <input
                type="checkbox"
                checked={row.listColumn}
                onChange={(event) => patch({ listColumn: event.target.checked })}
              />
            </label>
            <div className="tickets-settings-actions">
              {/* The definition order is the list column order and the order inside each detail group. */}
              <Button onClick={() => setFields(fields.filter((_, position) => position !== index))}>
                {text("項目を削除", "Remove field")}
              </Button>
            </div>

            {/*
              **ここが宣言では表せなかった箇所である。**
              繰り返し（項目）の中の繰り返し（選択肢）を、選択肢を持てる型の
              ときだけ出す。契約へ入れ子を足す代わりに、プラグインが描く。
            */}
            {hasOptions(row.type) ? (
              <fieldset data-options-for={row.id}>
                <legend>{text("選択肢", "Options")}</legend>
                <div className="tickets-settings-header tickets-settings-option-grid" aria-hidden="true">
                  <span>{text("値", "Value")}</span><span>{text("表示名", "Label")}</span>
                  <span>{text("操作", "Actions")}</span>
                </div>
                {row.options.map((option, optionIndex) => {
                  const optionInUse = usedBy(`field:${row.id}`, option.value);
                  const confirmingRemoval = confirmingOptionRemoval === option.key;
                  const patchOption = (change: Partial<OptionRow>) =>
                    {
                      if (change.value !== undefined) {
                        setConfirmingOptionRemoval((key) => key === option.key ? null : key);
                      }
                      patch({
                        options: row.options.map((entry, spot) =>
                          spot === optionIndex ? { ...entry, ...change } : entry
                        )
                      });
                    };
                  return (
                    <SortableRow key={option.key} rowKey={option.key} group={`options:${row.key}`}
                      label={text(`並び替え: ${option.value}`, `Reorder: ${option.value}`)}
                      className="tickets-settings-option-grid tickets-settings-row" rowType="option"
                      onMove={(delta) => patch({ options: moveTo(row.options, optionIndex, optionIndex + delta) })}
                      onDropAt={(source, side) => patch({ options: moveRelative(row.options, source, option.key, side) })}>
                      <label>
                        <span className="tickets-settings-cell-label">{text("値", "Value")}</span>
                        <input
                          type="text"
                          value={option.value}
                          onChange={(event) =>
                            patchOption({ value: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span className="tickets-settings-cell-label">{text("表示名", "Label")}</span>
                        <input
                          type="text"
                          value={option.label}
                          onChange={(event) =>
                            patchOption({ label: event.target.value })
                          }
                        />
                      </label>
                      <div className="tickets-settings-actions">
                        {optionIndex === 0
                          ? <span className="tickets-settings-badge" data-marker="default">{text("初期値", "Default")}</span>
                          : null}
                        {optionInUse > 0
                          ? <span className="tickets-settings-badge" data-marker="usage" aria-label={usageDescription(optionInUse)} title={usageDescription(optionInUse)}>
                              {usageBadge(optionInUse)}
                            </span>
                          : null}
                        {confirmingRemoval ? (
                          <>
                            <Button onClick={() => {
                              patch({ options: row.options.filter((entry) => entry.key !== option.key) });
                              setConfirmingOptionRemoval(null);
                            }}>
                              {text("削除する", "Delete")}
                            </Button>
                            <Button onClick={() => setConfirmingOptionRemoval(null)}>
                              {text("やめる", "Cancel")}
                            </Button>
                          </>
                        ) : (
                          <Button onClick={() => {
                            if (optionInUse > 0) setConfirmingOptionRemoval(option.key);
                            else patch({ options: row.options.filter((entry) => entry.key !== option.key) });
                          }}>
                            {text("削除", "Remove")}
                          </Button>
                        )}
                      </div>
                      {confirmingRemoval ? <span role="status">{removalConfirmation(optionInUse)}</span> : null}
                    </SortableRow>
                  );
                })}
                <Button
                  onClick={() =>
                    patch({ options: [...row.options, { key: newKey(), value: "", label: "" }] })
                  }
                >
                  {text("選択肢を追加", "Add option")}
                </Button>
              </fieldset>
            ) : null}
          </SortableRow>
        );
      })}
      <Button
        
        onClick={() =>
          setFields([
            ...fields,
            {
              key: newKey(),
              id: "",
              label: "",
              type: "text",
              required: false,
              listColumn: false,
              options: []
            }
          ])
        }
      >
        {text("項目を追加", "Add field")}
      </Button>

      <p>
        <label>
          {text("親を指す参照項目", "Parent reference field")}{" "}
          <select value={parentField} onChange={(event) => setParentField(event.target.value)}>
            <option value="">{text("指定しない", "None")}</option>
            {fields.filter((field) => field.type === "reference" && field.id).map((field) => (
              <option key={field.id} value={field.id}>{field.label || field.id}</option>
            ))}
          </select>
        </label>
      </p>

      <p>
        <Button tone="primary" disabled={saving} onClick={() => void submit()}>
          {saving ? text("保存しています…", "Saving…") : text("保存", "Save")}
        </Button>
      </p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
