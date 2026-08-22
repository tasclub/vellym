import { useTranslation } from "react-i18next";
import {
  resolveLocalizedText,
  type PluginFieldDescriptor,
  type PluginIndexValue
} from "@vellym/plugin-api";
import styles from "./field-input.module.css";

/** 保存へ渡す値。宣言したpathへそのまま書き戻す */
export type PluginSpecValue =
  | string
  | number
  | boolean
  | null
  | PluginSpecValue[]
  | { [key: string]: PluginSpecValue };

/**
 * 索引行のどのキーを読むか。
 *
 * プラグインが`valueKey`を宣言していればそれを使う。hostが項目のpathから
 * キーを組み立てない。組み立ててしまうと、あるプラグインの命名規約が
 * 汎用レンダラへ染み出す。
 */
export function valueKeyOf(field: PluginFieldDescriptor): string {
  return field.valueKey ?? field.id;
}

export function asText(value: PluginIndexValue | undefined): string {
  if (value === undefined || value === null) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** 入力文字列を、宣言した型の値へ戻す。空欄はキーごと消す */
export function toSpecValue(
  field: PluginFieldDescriptor,
  text: string
): PluginSpecValue {
  if (!text) return null;
  if (field.type === "number") {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : text;
  }
  if (field.type === "boolean") return text === "true";
  if (field.type === "multiselect") {
    return text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return text;
}

/**
 * 必須の印。**色に頼らず、記号と読み上げ文言の両方で示す。**
 *
 * 必須が何を意味するかはコマンドの入力欄と詳細で違う。ここは印だけを担い、
 * 止めるかどうかはそれぞれの画面が決める。
 */
export function RequiredMark() {
  const { t } = useTranslation();
  return (
    <span className={styles["plugin-required"]} aria-hidden="false">
      <span aria-hidden="true">＊</span>
      <span className="visually-hidden">{t("plugin.required")}</span>
    </span>
  );
}

/**
 * 単一項目の入力。型から入力欄が決まる。
 *
 * 詳細と、コマンドの入力欄が同じものを使う。作成のときだけ別の見た目に
 * なると、同じ項目が2つの顔を持つことになる。
 */
export function FieldInput({
  field,
  id,
  value,
  locale,
  disabled,
  autoFocus,
  onChange
}: {
  field: PluginFieldDescriptor;
  id: string;
  value: string;
  locale: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange(next: string): void;
}) {
  const { t } = useTranslation();
  if (field.options) {
    return (
      <select
        id={id}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("plugin.emptySelect")}</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.symbol
              ? `${option.symbol} ${resolveLocalizedText(option.label, locale)}`
              : resolveLocalizedText(option.label, locale)}
          </option>
        ))}
        {/* 定義に無い値も選択肢として残す。開いた瞬間に値が変わらないようにする。 */}
        {value && !field.options.some((option) => option.value === value) ? (
          <option value={value}>{value}</option>
        ) : null}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === "true"}
        disabled={disabled}
        autoFocus={autoFocus}
        // チェックボックスに「未入力」は無い。外した状態は空欄ではなく偽である。
        // 空文字を返すと`toSpecValue`がnullにし、キーごと消えてしまう。
        onChange={(event) => onChange(event.target.checked ? "true" : "false")}
      />
    );
  }
  if (field.type === "multiline") {
    return (
      <textarea
        id={id}
        rows={3}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "multiselect") {
    return (
      <input
        id={id}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        // 空欄が何を入れる場所かを書く。「—」では読めない。
        placeholder={t("plugin.multiselectHint")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      id={id}
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      {...(field.type === "reference" ? { placeholder: t("plugin.referenceHint") } : {})}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
