import { useMemo, useState } from "react";
import type { PluginRenderContext, PluginValueType } from "@vellym/plugin-api";
import type { PluginViewProps } from "@vellym/plugin-api/react";
import { Button } from "@vellym/plugin-api/ui";

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
  id: string;
  label: string;
  category: "open" | "closed";
}

interface OptionRow {
  value: string;
  label: string;
}

interface FieldRow {
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
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      type: (TYPES.includes(row.type as PluginValueType)
        ? row.type
        : "text") as PluginValueType,
      required: row.required === true,
      listColumn: row.listColumn === true,
      options: options.map((option) => {
        const entry = (option ?? {}) as Record<string, unknown>;
        return { value: String(entry.value ?? ""), label: String(entry.label ?? "") };
      })
    };
  });
}

function move<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

export function TrackerSettingsScreen({ context }: PluginViewProps) {
  return <Screen context={context as PluginRenderContext} />;
}

function Screen({ context }: { context: PluginRenderContext }) {
  const spec = context.target?.spec ?? {};
  const [statuses, setStatuses] = useState(() => readStatuses(spec));
  const [fields, setFields] = useState(() => readFields(spec));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const ja = context.locale.startsWith("ja");
  const text = (japanese: string, english: string) => (ja ? japanese : english);

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

  const removalNote = (count: number) =>
    text(
      `${count}件がこの値を使っています。消すと定義外になります`,
      `${count} item(s) use this value. Removing it leaves them undefined.`
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
            ? { options: row.options }
            : {})
        }))
      }
    ]);
    setSaving(false);
    setMessage(result.ok ? text("保存しました", "Saved") : result.message);
  }

  if (context.isStatic) {
    // 静的出力では編集の導線を出さない。**disabledで残さない。**
    return <p>{text("この画面は閲覧のみです", "This view is read-only.")}</p>;
  }

  return (
    <div data-plugin="tickets" data-view="tracker-settings">
      <h2>{text("ステータス", "Statuses")}</h2>
      <p>
        {text(
          "idは不変の識別子です。先頭が新しいチケットの初期値になります",
          "The id is permanent. The first row is the initial status."
        )}
      </p>
      {statuses.map((row, index) => {
        const inUse = usedBy("status", row.id);
        const patch = (change: Partial<StatusRow>) =>
          setStatuses(
            statuses.map((item, position) =>
              position === index ? { ...item, ...change } : item
            )
          );
        return (
          <div key={`status-${index}`} data-row="status">
            <label>
              {text("ID", "ID")}
              <input
                type="text"
                value={row.id}
                onChange={(event) => patch({ id: event.target.value })}
              />
            </label>
            <label>
              {text("表示名", "Label")}
              <input
                type="text"
                value={row.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </label>
            <label>
              {text("区分", "Category")}
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
            <Button
              
              aria-label={text("上へ", "Move up")}
              disabled={index === 0}
              onClick={() => setStatuses(move(statuses, index, -1))}
            >
              ↑
            </Button>
            <Button
              
              aria-label={text("下へ", "Move down")}
              disabled={index === statuses.length - 1}
              onClick={() => setStatuses(move(statuses, index, 1))}
            >
              ↓
            </Button>
            <Button
              
              onClick={() =>
                setStatuses(statuses.filter((_, position) => position !== index))
              }
            >
              {text("削除", "Remove")}
            </Button>
            {/* 使用中の値は、消す前に件数を出す。消してから気づかせない */}
            {inUse ? <span role="status">{removalNote(inUse)}</span> : null}
          </div>
        );
      })}
      <Button
        
        onClick={() =>
          setStatuses([...statuses, { id: "", label: "", category: "open" }])
        }
      >
        {text("ステータスを追加", "Add status")}
      </Button>

      <h2>{text("項目", "Fields")}</h2>
      {fields.map((row, index) => {
        const patch = (change: Partial<FieldRow>) =>
          setFields(
            fields.map((item, position) =>
              position === index ? { ...item, ...change } : item
            )
          );
        return (
          <div key={`field-${index}`} data-row="field">
            <label>
              {text("ID", "ID")}
              <input
                type="text"
                value={row.id}
                onChange={(event) => patch({ id: event.target.value })}
              />
            </label>
            <label>
              {text("表示名", "Label")}
              <input
                type="text"
                value={row.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </label>
            <label>
              {text("型", "Type")}
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
              {text("必須", "Required")}
              <input
                type="checkbox"
                checked={row.required}
                onChange={(event) => patch({ required: event.target.checked })}
              />
            </label>
            <label>
              {text("一覧に出す", "Show in list")}
              <input
                type="checkbox"
                checked={row.listColumn}
                onChange={(event) => patch({ listColumn: event.target.checked })}
              />
            </label>
            <Button
              
              onClick={() =>
                setFields(fields.filter((_, position) => position !== index))
              }
            >
              {text("項目を削除", "Remove field")}
            </Button>

            {/*
              **ここが宣言では表せなかった箇所である。**
              繰り返し（項目）の中の繰り返し（選択肢）を、選択肢を持てる型の
              ときだけ出す。契約へ入れ子を足す代わりに、プラグインが描く。
            */}
            {hasOptions(row.type) ? (
              <fieldset data-options-for={row.id}>
                <legend>{text("選択肢", "Options")}</legend>
                {row.options.map((option, optionIndex) => {
                  const optionInUse = usedBy(`field:${row.id}`, option.value);
                  const patchOption = (change: Partial<OptionRow>) =>
                    patch({
                      options: row.options.map((entry, spot) =>
                        spot === optionIndex ? { ...entry, ...change } : entry
                      )
                    });
                  return (
                    <div key={`option-${optionIndex}`} data-row="option">
                      <label>
                        {text("値", "Value")}
                        <input
                          type="text"
                          value={option.value}
                          onChange={(event) =>
                            patchOption({ value: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        {text("表示名", "Label")}
                        <input
                          type="text"
                          value={option.label}
                          onChange={(event) =>
                            patchOption({ label: event.target.value })
                          }
                        />
                      </label>
                      <Button
                        
                        aria-label={text("上へ", "Move up")}
                        disabled={optionIndex === 0}
                        onClick={() =>
                          patch({ options: move(row.options, optionIndex, -1) })
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        
                        aria-label={text("下へ", "Move down")}
                        disabled={optionIndex === row.options.length - 1}
                        onClick={() =>
                          patch({ options: move(row.options, optionIndex, 1) })
                        }
                      >
                        ↓
                      </Button>
                      <Button
                        
                        onClick={() =>
                          patch({
                            options: row.options.filter(
                              (_, spot) => spot !== optionIndex
                            )
                          })
                        }
                      >
                        {text("削除", "Remove")}
                      </Button>
                      {optionInUse ? (
                        <span role="status">{removalNote(optionInUse)}</span>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  onClick={() =>
                    patch({ options: [...row.options, { value: "", label: "" }] })
                  }
                >
                  {text("選択肢を追加", "Add option")}
                </Button>
              </fieldset>
            ) : null}
          </div>
        );
      })}
      <Button
        
        onClick={() =>
          setFields([
            ...fields,
            {
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
        <Button tone="primary" disabled={saving} onClick={() => void submit()}>
          {saving ? text("保存しています…", "Saving…") : text("保存", "Save")}
        </Button>
      </p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
