import { useState } from "react";
import { localeDisplayName, normalizeLocale } from "@vellym-internal/core";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { PageEditSession } from "./page-edit-session.js";
import styles from "./page-language-controls.module.css";

const SUPPORTED_CONTENT_LOCALES = ["ja", "en"] as const;

export function PageLanguageControls(props: {
  session: PageEditSession;
  uiLocale: string;
  disabled?: boolean;
  onSelect(locale: string): void;
  onAdd(locale: string, initialize: { type: "empty" } | { type: "copy"; sourceLocale: string }): void;
  onRemove(locale: string): void;
  onRepairInvalid(rawKey: string): void;
  onDeleteInvalid(rawKey: string): void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [locale, setLocale] = useState("");
  const [mode, setMode] = useState<"copy" | "empty">("copy");
  const [sourceLocale, setSourceLocale] = useState(props.session.baseLocale);
  const [error, setError] = useState("");
  const visible = props.session.locales.filter(({ removed }) => !removed);
  const active = visible.find(({ locale: item }) => item === props.session.activeLocale);
  const addableLocales = SUPPORTED_CONTENT_LOCALES.filter(
    (item) => !visible.some(({ locale }) => locale === item)
  );

  function add() {
    try {
      props.onAdd(
        locale,
        mode === "copy" ? { type: "copy", sourceLocale } : { type: "empty" }
      );
      setAdding(false);
      setLocale("");
      setError("");
      const canonical = normalizeLocale(locale).canonical;
      window.requestAnimationFrame(() => {
        document.getElementById(`locale-tab-${canonical}`)?.focus();
      });
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(t(`language.addError.${code}`, { defaultValue: t("language.addError.INVALID_LOCALE") }));
    }
  }

  return (
    <div className={styles.controls}>
      <div className={styles.tabsRow}>
        <div role="tablist" aria-label={t("language.editTabs")} className={styles.tabs}>
          {visible.map((draft) => (
            <button
              type="button"
              role="tab"
              id={`locale-tab-${draft.locale}`}
              aria-selected={draft.locale === props.session.activeLocale}
              aria-controls="locale-editor-panel"
              tabIndex={draft.locale === props.session.activeLocale ? 0 : -1}
              key={draft.locale}
              disabled={props.disabled}
              onClick={() => props.onSelect(draft.locale)}
            >
              {localeDisplayName(draft.locale, props.uiLocale)}
              {draft.operation === "create" && <span className={styles.state}>{t("language.stateNew")}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={props.disabled || addableLocales.length === 0}
          onClick={() => { setLocale(addableLocales[0] ?? ""); setAdding(true); }}
        >
          {t("language.add")}
        </button>
      </div>
      {active && (
        <div className={styles.activeActions}>
          {!active.isBaseLocale && (
            <>
              <button
                type="button"
                className={styles.remove}
                disabled={props.disabled}
                onClick={() => {
                  if (window.confirm(t("language.removeConfirm", { locale: active.locale }))) {
                    props.onRemove(active.locale);
                    window.requestAnimationFrame(() => {
                      document.getElementById(`locale-tab-${props.session.baseLocale}`)?.focus();
                    });
                  }
                }}
              >
                {active.operation === "create" ? t("language.cancelAdd") : t("language.remove")}
              </button>
            </>
          )}
        </div>
      )}
      {props.session.invalidTranslations.length > 0 && (
        <section className={styles.invalid} aria-label={t("language.invalidTranslations")}>
          <strong>{t("language.invalidTranslations")}</strong>
          {props.session.invalidTranslations.map((item) => (
            <div key={item.rawKey}>
              <span>{item.rawKey}</span>
              <small>{item.diagnostics.map(({ message }) => message).join(" / ")}</small>
              {item.repairable && item.canonicalLocale &&
                !item.diagnostics.some(({ code }) => code === "DUPLICATE_TRANSLATION_LOCALE") && (
                <button type="button" onClick={() => props.onRepairInvalid(item.rawKey)}>
                  {t("language.repair")}
                </button>
              )}
              <button type="button" className={styles.remove} onClick={() => {
                if (window.confirm(t("language.deleteInvalidConfirm", { key: item.rawKey }))) {
                  props.onDeleteInvalid(item.rawKey);
                }
              }}>{t("language.deleteInvalid")}</button>
            </div>
          ))}
        </section>
      )}
      <ModalOverlay isOpen={adding} onOpenChange={setAdding} isDismissable className={styles.overlay}>
        <Modal className={styles.modal}>
          <Dialog aria-labelledby="add-language-title" className={styles.dialog}>
            <h2 id="add-language-title">{t("language.addTitle")}</h2>
            <label>
              <span>{t("language.localeLabel")}</span>
              <select
                autoFocus
                value={locale}
                onChange={(event) => { setLocale(event.target.value); setError(""); }}
              >
                {addableLocales.map((item) => (
                  <option value={item} key={item}>{localeDisplayName(item, props.uiLocale)}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{t("language.initializeLabel")}</legend>
              <label><input type="radio" checked={mode === "copy"} onChange={() => setMode("copy")} />{t("language.copy")}</label>
              <label><input type="radio" checked={mode === "empty"} onChange={() => setMode("empty")} />{t("language.empty")}</label>
            </fieldset>
            {mode === "copy" && (
              <label>
                <span>{t("language.copySource")}</span>
                <select value={sourceLocale} onChange={(event) => setSourceLocale(event.target.value)}>
                  {visible.map((draft) => <option value={draft.locale} key={draft.locale}>{localeDisplayName(draft.locale, props.uiLocale)}</option>)}
                </select>
              </label>
            )}
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <div className={styles.dialogActions}>
              <Button onPress={() => setAdding(false)}>{t("editor.cancel")}</Button>
              <Button onPress={add} isDisabled={!locale.trim()}>{t("language.addAction")}</Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
