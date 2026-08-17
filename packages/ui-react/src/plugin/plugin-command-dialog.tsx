import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  resolveLocalizedText,
  type PluginCommandInput,
  type PluginInputValue,
  type PluginLocalizedText
} from "@vellym/plugin-api";
import { FieldInput, RequiredMark, toSpecValue } from "../shared/field-input.js";
import { Button } from "../shared/button.js";
import { Dialog } from "../shared/dialog.js";
import styles from "./plugin.module.css";

export interface PluginCommandDescriptor {
  id: string;
  title: PluginLocalizedText;
  inputs?: readonly PluginCommandInput[];
}

/** 初期値を入力欄の文字列にする。表示上は「ただの初期の値」であり、印は付けない */
function initialText(field: PluginCommandInput): string {
  const value = field.initialValue;
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * プラグインのコマンドを起こす前に、宣言された入力を尋ねるダイアログ。
 *
 * 入力欄はdescriptorから作る。コマンドごとの専用画面を持たない。
 * **ここでの`required`はこの実行だけを止める。** 既にあるリソースの編集や、
 * 手で書いたYAMLは止めない。
 */
export function PluginCommandDialog({
  command,
  locale,
  onCancel,
  onSubmit
}: {
  command?: PluginCommandDescriptor;
  locale: string;
  onCancel(): void;
  onSubmit(input: Record<string, PluginInputValue>): void;
}) {
  const { t } = useTranslation();
  const fields = useMemo(() => command?.inputs ?? [], [command]);
  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of fields) values[field.id] = initialText(field);
    return values;
  }, [fields]);
  const [draft, setDraft] = useState(initial);
  const [showEmpty, setShowEmpty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // 送信ボタンはダイアログの操作欄にあり、フォームの外にある。idで結び付ける
  const formId = "plugin-command-form";
  useEffect(() => {
    setDraft(initial);
    setShowEmpty(false);
  }, [initial]);
  if (!command) return null;

  const title = resolveLocalizedText(command.title, locale);
  const firstEmpty = fields.find((field) => field.required && !draft[field.id]);

  return (
    <Dialog
      isOpen
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>{t("editor.cancel")}</Button>
          <Button tone="primary" type="submit" form={formId}>
            {title}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (firstEmpty) {
            // どこが足りないかを探させない。最初の未入力へ連れて行く。
            setShowEmpty(true);
            formRef.current
              ?.querySelector<HTMLElement>(`#plugin-input-${CSS.escape(firstEmpty.id)}`)
              ?.focus();
            return;
          }
          const input: Record<string, PluginInputValue> = {};
          for (const field of fields) {
            const value = toSpecValue(field, draft[field.id] ?? "");
            if (value === null || typeof value === "object") {
              if (Array.isArray(value)) input[field.id] = value as string[];
              continue;
            }
            input[field.id] = value;
          }
          onSubmit(input);
        }}
      >
        {fields.map((field, index) => {
          const empty = field.required && !draft[field.id];
          return (
            <label key={field.id} htmlFor={`plugin-input-${field.id}`}>
              <span>
                {resolveLocalizedText(field.label, locale)}
                {field.required ? <RequiredMark /> : null}
              </span>
              <FieldInput
                field={field}
                id={`plugin-input-${field.id}`}
                value={draft[field.id] ?? ""}
                locale={locale}
                autoFocus={index === 0}
                onChange={(next) => setDraft({ ...draft, [field.id]: next })}
              />
              {showEmpty && empty ? (
                <span className={styles["plugin-detail-note"]} role="alert">
                  {t("plugin.requiredEmpty")}
                </span>
              ) : null}
              {field.description ? (
                <span className={styles["plugin-detail-note"]}>
                  {resolveLocalizedText(field.description, locale)}
                </span>
              ) : null}
            </label>
          );
        })}
      </form>
    </Dialog>
  );
}
