import { useState } from "react";
import { localeDisplayName, normalizeLocale } from "@vellym-internal/core";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";
import {
  addFolderLocale,
  deleteInvalidFolderTranslation,
  removeFolderLocale,
  repairInvalidFolderTranslation,
  type FolderEditSession
} from "./folder-edit-session.js";
import styles from "./page-language-controls.module.css";

const SUPPORTED_CONTENT_LOCALES = ["ja", "en"] as const;

export function FolderLanguageControls(props: {
  session: FolderEditSession;
  uiLocale: string;
  disabled?: boolean;
  onChange(session: FolderEditSession): void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [locale, setLocale] = useState("");
  const [mode, setMode] = useState<"copy" | "empty">("copy");
  const [sourceLocale, setSourceLocale] = useState(props.session.baseLocale);
  const [error, setError] = useState("");
  const visible = props.session.locales.filter(({ removed }) => !removed);
  const active = visible.find(({ locale: item }) => item === props.session.activeLocale)!;
  const addableLocales = SUPPORTED_CONTENT_LOCALES.filter(
    (item) => !visible.some(({ locale }) => locale === item)
  );

  function updateActive(change: Partial<typeof active>) {
    props.onChange({
      ...props.session,
      locales: props.session.locales.map((draft) =>
        draft.locale === active.locale ? { ...draft, ...change } : draft
      )
    });
  }

  function add() {
    try {
      props.onChange(addFolderLocale(
        props.session,
        locale,
        mode === "copy" ? { type: "copy", sourceLocale } : { type: "empty" }
      ));
      setAdding(false);
      setLocale("");
      setError("");
      const canonical = normalizeLocale(locale).canonical;
      window.requestAnimationFrame(() => {
        document.getElementById(`folder-locale-tab-${canonical}`)?.focus();
      });
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "INVALID_LOCALE";
      setError(t(`language.addError.${code}`, {
        defaultValue: t("language.addError.INVALID_LOCALE")
      }));
    }
  }

  return (
    <div className={styles.controls}>
      <div className={styles.tabsRow}>
        <div role="tablist" aria-label={t("language.folderEditTabs")} className={styles.tabs}>
          {visible.map((draft) => (
            <button
              type="button"
              role="tab"
              id={`folder-locale-tab-${draft.locale}`}
              aria-selected={draft.locale === props.session.activeLocale}
              aria-controls="folder-locale-panel"
              tabIndex={draft.locale === props.session.activeLocale ? 0 : -1}
              key={draft.locale}
              disabled={props.disabled}
              onClick={() => props.onChange({ ...props.session, activeLocale: draft.locale })}
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
      <div className={styles.activeActions}>
        {!active.isBaseLocale && (
          <>
            <button
              type="button"
              className={styles.remove}
              disabled={props.disabled}
              onClick={() => {
                if (window.confirm(t("language.removeFolderConfirm", { locale: active.locale }))) {
                  props.onChange(removeFolderLocale(props.session, active.locale));
                  window.requestAnimationFrame(() => {
                    document.getElementById(`folder-locale-tab-${props.session.baseLocale}`)?.focus();
                  });
                }
              }}
            >
              {active.operation === "create" ? t("language.cancelAdd") : t("language.remove")}
            </button>
          </>
        )}
      </div>
      <div id="folder-locale-panel" role="tabpanel" className={styles.folderFields}>
        <label>
          <span>{t("structure.displayName")}</span>
          <input
            autoFocus
            value={active.title}
            disabled={props.disabled}
            onChange={(event) => updateActive({ title: event.target.value })}
          />
        </label>
        <label>
          <span>{t("structure.descriptionOptional")}</span>
          <textarea
            value={active.description}
            disabled={props.disabled}
            onChange={(event) => updateActive({ description: event.target.value })}
          />
        </label>
      </div>
      {props.session.invalidTranslations.length > 0 && (
        <section className={styles.invalid} aria-label={t("language.invalidTranslations")}>
          <strong>{t("language.invalidTranslations")}</strong>
          {props.session.invalidTranslations.map((item) => (
            <div key={item.rawKey}>
              <span>{item.rawKey}</span>
              <small>{item.diagnostics.map(({ message }) => message).join(" / ")}</small>
              {item.repairable && item.canonicalLocale &&
                !item.diagnostics.some(({ code }) => code === "DUPLICATE_TRANSLATION_LOCALE") && (
                <button type="button" onClick={() => props.onChange(
                  repairInvalidFolderTranslation(props.session, item.rawKey)
                )}>{t("language.repair")}</button>
              )}
              <button type="button" className={styles.remove} onClick={() => {
                if (window.confirm(t("language.deleteInvalidConfirm", { key: item.rawKey }))) {
                  props.onChange(deleteInvalidFolderTranslation(props.session, item.rawKey));
                }
              }}>{t("language.deleteInvalid")}</button>
            </div>
          ))}
        </section>
      )}
      <ModalOverlay isOpen={adding} onOpenChange={setAdding} isDismissable className={styles.overlay}>
        <Modal className={styles.modal}>
          <Dialog aria-labelledby="add-folder-language-title" className={styles.dialog}>
            <h2 id="add-folder-language-title">{t("language.addFolderTitle")}</h2>
            <label>
              <span>{t("language.localeLabel")}</span>
              <select autoFocus value={locale} onChange={(event) => { setLocale(event.target.value); setError(""); }}>
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
