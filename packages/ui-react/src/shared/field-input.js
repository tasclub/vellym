import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useTranslation } from "react-i18next";
import { resolveLocalizedText } from "@vellym/plugin-api";
import styles from "./field-input.module.css";
/**
 * 索引行のどのキーを読むか。
 *
 * プラグインが`valueKey`を宣言していればそれを使う。hostが項目のpathから
 * キーを組み立てない。組み立ててしまうと、あるプラグインの命名規約が
 * 汎用レンダラへ染み出す。
 */
export function valueKeyOf(field) {
    return field.valueKey ?? field.id;
}
export function asText(value) {
    if (value === undefined || value === null)
        return "";
    return Array.isArray(value) ? value.join(", ") : String(value);
}
/** 入力文字列を、宣言した型の値へ戻す。空欄はキーごと消す */
export function toSpecValue(field, text) {
    if (!text)
        return null;
    if (field.type === "number") {
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : text;
    }
    if (field.type === "boolean")
        return text === "true";
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
    return (_jsxs("span", { className: styles["plugin-required"], "aria-hidden": "false", children: [_jsx("span", { "aria-hidden": "true", children: "\uFF0A" }), _jsx("span", { className: "visually-hidden", children: t("plugin.required") })] }));
}
/**
 * 単一項目の入力。型から入力欄が決まる。
 *
 * 詳細と、コマンドの入力欄が同じものを使う。作成のときだけ別の見た目に
 * なると、同じ項目が2つの顔を持つことになる。
 */
export function FieldInput({ field, id, value, locale, disabled, autoFocus, onChange }) {
    const { t } = useTranslation();
    if (field.options) {
        return (_jsxs("select", { id: id, value: value, disabled: disabled, autoFocus: autoFocus, onChange: (event) => onChange(event.target.value), children: [_jsx("option", { value: "", children: t("plugin.emptySelect") }), field.options.map((option) => (_jsx("option", { value: option.value, children: option.symbol
                        ? `${option.symbol} ${resolveLocalizedText(option.label, locale)}`
                        : resolveLocalizedText(option.label, locale) }, option.value))), value && !field.options.some((option) => option.value === value) ? (_jsx("option", { value: value, children: value })) : null] }));
    }
    if (field.type === "boolean") {
        return (_jsx("input", { id: id, type: "checkbox", checked: value === "true", disabled: disabled, autoFocus: autoFocus, onChange: (event) => onChange(event.target.checked ? "true" : "") }));
    }
    if (field.type === "multiline") {
        return (_jsx("textarea", { id: id, rows: 3, value: value, disabled: disabled, autoFocus: autoFocus, onChange: (event) => onChange(event.target.value) }));
    }
    if (field.type === "multiselect") {
        return (_jsx("input", { id: id, value: value, disabled: disabled, autoFocus: autoFocus, 
            // 空欄が何を入れる場所かを書く。「—」では読めない。
            placeholder: t("plugin.multiselectHint"), onChange: (event) => onChange(event.target.value) }));
    }
    return (_jsx("input", { id: id, type: field.type === "number" ? "number" : field.type === "date" ? "date" : "text", value: value, disabled: disabled, autoFocus: autoFocus, ...(field.type === "reference" ? { placeholder: t("plugin.referenceHint") } : {}), onChange: (event) => onChange(event.target.value) }));
}
//# sourceMappingURL=field-input.js.map