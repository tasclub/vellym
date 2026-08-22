import { useCallback, useEffect, useState } from "react";
import type { Diagnostic, SupportedLanguage } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import {
  applyContentRoot,
  applySlugMigration,
  applyStructure,
  applyUiLanguage,
  fetchArchived,
  previewContentRoot,
  previewSlugMigration,
  previewStructure,
  type ArchivedEntry,
  type ContentRootPlan,
  type SlugMigrationPlan
} from "../shared/api.js";
import styles from "./admin-view.module.css";
import { errorMessage } from "../shared/error-message.js";
import { SetupWizard } from "../setup/setup-wizard.js";
import { Button } from "../shared/button.js";

export function AdminView(props: {
  contentRoot: string;
  projectRoot: string;
  resolvedContentRoot: string;
  configPath: string;
  diagnostics: Diagnostic[];
  language: SupportedLanguage;
  canManageStructure: boolean;
  onConfigApplied(): void;
}) {
  const [contentRoot, setContentRoot] = useState(props.contentRoot);
  const [plan, setPlan] = useState<ContentRootPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slugPlan, setSlugPlan] = useState<SlugMigrationPlan>();
  const [slugMessage, setSlugMessage] = useState("");
  const [uiLanguage, setUiLanguage] = useState<SupportedLanguage>(props.language);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [archived, setArchived] = useState<ArchivedEntry[]>([]);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [addingTemplates, setAddingTemplates] = useState(false);
  useEffect(() => setContentRoot(props.contentRoot), [props.contentRoot]);
  useEffect(() => setUiLanguage(props.language), [props.language]);
  const { t } = useTranslation();

  const { canManageStructure, onConfigApplied } = props;
  const loadArchived = useCallback(async () => {
    if (!canManageStructure) return;
    setArchiveError("");
    try {
      setArchived((await fetchArchived()).data.entries);
    } catch (caught) {
      setArchiveError(errorMessage(caught, t));
    } finally {
      setArchivedLoaded(true);
    }
  }, [canManageStructure]);
  useEffect(() => {
    void loadArchived();
  }, [loadArchived]);

  async function restoreEntry(entry: ArchivedEntry) {
    setArchiveBusy(entry.archivePath);
    setArchiveError("");
    try {
      const plan = (
        await previewStructure({
          type: "restore",
          archivePath: entry.archivePath
        })
      ).data;
      if (!plan.executable) {
        setArchiveError(plan.conflict ?? t("admin.archiveRestoreFailed"));
        return;
      }
      await applyStructure(plan);
      await loadArchived();
      onConfigApplied();
    } catch (caught) {
      setArchiveError(errorMessage(caught, t));
    } finally {
      setArchiveBusy(null);
    }
  }

  async function preview() {
    setBusy(true);
    setError("");
    try {
      setPlan((await previewContentRoot(contentRoot)).data);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      await applyContentRoot(plan);
      setPlan(undefined);
      props.onConfigApplied();
    } catch (caught) {
      setPlan(undefined);
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function changeLanguage() {
    if (uiLanguage === props.language) return;
    setLanguageBusy(true);
    setLanguageError("");
    try {
      await applyUiLanguage(uiLanguage);
      props.onConfigApplied();
    } catch (caught) {
      setUiLanguage(props.language);
      setLanguageError(errorMessage(caught, t));
    } finally {
      setLanguageBusy(false);
    }
  }

  async function inspectSlugs() {
    setBusy(true);
    setError("");
    setSlugMessage("");
    try {
      setSlugPlan((await previewSlugMigration()).data);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function migrateSlugs() {
    if (!slugPlan) return;
    setBusy(true);
    setError("");
    try {
      const result = (await applySlugMigration(slugPlan)).data;
      setSlugPlan(undefined);
      setSlugMessage(t("admin.slugMigrationResult", { count: result.migrated }));
      props.onConfigApplied();
    } catch (caught) {
      setSlugPlan(undefined);
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.admin} aria-labelledby="admin-title">
      <header>
        <p>{t("admin.kicker")}</p>
        <h1 id="admin-title">{t("admin.title")}</h1>
        <span>{t("admin.subtitle")}</span>
      </header>
      {addingTemplates ? (
        <SetupWizard
          operation="add"
          projectRoot={props.projectRoot}
          contentRoot={props.contentRoot}
          resolvedContentRoot={props.resolvedContentRoot}
          initialLanguage={props.language}
          onComplete={() => {
            setAddingTemplates(false);
            props.onConfigApplied();
          }}
        />
      ) : (
        <section className={styles.panel} aria-labelledby="template-add-title">
          <h2 id="template-add-title">{t("admin.templateAddTitle")}</h2>
          <p>{t("admin.templateAddDescription")}</p>
          <div className={styles.configActions}>
            <Button onClick={() => setAddingTemplates(true)}>
              {t("admin.templateAddAction")}
            </Button>
          </div>
        </section>
      )}
      <section className={styles.panel} aria-labelledby="source-title">
        <h2 id="source-title">{t("admin.sourceTitle")}</h2>
        <dl>
          <div><dt>{t("admin.projectRoot")}</dt><dd><code>{props.projectRoot}</code></dd></div>
          <div><dt>{t("admin.configFile")}</dt><dd><code>{props.configPath}</code></dd></div>
          <div><dt>{t("admin.contentRootRelative")}</dt><dd><code>{props.contentRoot}</code></dd></div>
          <div><dt>{t("admin.resolvedContentRoot")}</dt><dd><code>{props.resolvedContentRoot}</code></dd></div>
          <div><dt>{t("admin.saveMethod")}</dt><dd>{t("admin.saveMethodValue")}</dd></div>
        </dl>
      </section>
      <section className={styles.panel} aria-labelledby="language-title">
        <h2 id="language-title">{t("admin.languageTitle")}</h2>
        <p>{t("admin.languageDescription")}</p>
        <label className={styles.configField}>
          <span>{t("admin.languageFieldLabel")}</span>
          <select
            value={uiLanguage}
            disabled={languageBusy}
            onChange={(event) =>
              setUiLanguage(event.target.value as SupportedLanguage)
            }
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
        {languageError && <p role="alert">{languageError}</p>}
        <div className={styles.configActions}>
          <Button
            disabled={languageBusy || uiLanguage === props.language}
            onClick={() => void changeLanguage()}
          >
            {languageBusy ? t("admin.languageApplying") : t("admin.languageApplyAction")}
          </Button>
        </div>
      </section>
      <section className={styles.panel} aria-labelledby="content-root-title">
        <h2 id="content-root-title">{t("admin.contentRootTitle")}</h2>
        <p>{t("admin.contentRootDescription", { root: props.projectRoot })}</p>
        <label className={styles.configField}>
          <span>{t("admin.contentRootFieldLabel")}</span>
          <input
            value={contentRoot}
            onChange={(event) => {
              setContentRoot(event.target.value);
              setPlan(undefined);
            }}
          />
        </label>
        {plan && (
          <div className={styles.configPreview}>
            <strong>{plan.resolvedContentRoot}</strong>
            <span>
              {plan.exists
                ? t("admin.contentRootExistsSummary", {
                    pages: plan.pages,
                    diagnostics: plan.diagnostics
                  })
                : t("admin.contentRootMissingSummary")}
            </span>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={styles.configActions}>
          {!plan ? (
            <Button disabled={busy} onClick={() => void preview()}>
              {busy ? t("admin.previewing") : t("admin.previewAction")}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void apply()}>
              {busy ? t("admin.applying") : t("admin.applyAction")}
            </Button>
          )}
        </div>
      </section>
      {/* slug移行は技術的で使用頻度の低い操作なので、基本設定の流れから外すため
          既定で折りたたんでおく。 */}
      <details className={`${styles.panel} ${styles.advancedPanel}`}>
        <summary>
          {t("admin.slugMigrationTitle")}
          <span className={styles.advancedSummaryNote}>
            {t("admin.advancedLabel")}
          </span>
        </summary>
        <p>{t("admin.slugMigrationDescription")}</p>
        {slugPlan && (
          <div className={styles.configPreview}>
            <strong>{t("admin.slugMigrationCount", { count: slugPlan.pages.length })}</strong>
            <span>
              {slugPlan.pages.length
                ? slugPlan.pages.map((page) => `${page.title} → ${page.slug}`).join("、")
                : t("admin.slugMigrationNone")}
            </span>
          </div>
        )}
        {slugMessage && <p role="status">{slugMessage}</p>}
        <div className={styles.configActions}>
          {!slugPlan ? (
            <Button disabled={busy} onClick={() => void inspectSlugs()}>
              {t("admin.slugMigrationPreviewAction")}
            </Button>
          ) : slugPlan.pages.length > 0 ? (
            <Button disabled={busy} onClick={() => void migrateSlugs()}>
              {t("admin.slugMigrationApplyAction")}
            </Button>
          ) : null}
        </div>
      </details>
      {/* アーカイブ済みのページ・フォルダを_archiveからliveツリーへ復元する。
          structure機能が有効なときだけ表示（静的ビルドでは非表示）。 */}
      {props.canManageStructure && (
        <section className={styles.panel} aria-labelledby="archived-title">
          <h2 id="archived-title">{t("admin.archivedTitle")}</h2>
          <p>{t("admin.archivedDescription")}</p>
          {archiveError && <p role="alert">{archiveError}</p>}
          {archived.length === 0 ? (
            <p className={styles.archivedEmpty}>
              {archivedLoaded ? t("admin.archivedEmpty") : t("admin.archivedLoading")}
            </p>
          ) : (
            <ul className={styles.archivedList}>
              {archived.map((entry) => (
                <li key={entry.archivePath} className={styles.archivedItem}>
                  <div className={styles.archivedMeta}>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.type === "folder"
                        ? t("admin.archivedKindFolder")
                        : t("admin.archivedKindPage")}
                      {" · "}
                      <code>{entry.archivePath}</code>
                    </small>
                  </div>
                  <Button
                    disabled={archiveBusy !== null}
                    onClick={() => void restoreEntry(entry)}
                  >
                    {archiveBusy === entry.archivePath
                      ? t("admin.archivedRestoring")
                      : t("admin.archivedRestoreAction")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={styles.panel} aria-labelledby="problems-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="problems-title">{t("admin.problemsTitle")}</h2>
            <p>
              {props.diagnostics.length === 0
                ? t("admin.problemsNone")
                : t("admin.problemsSome", { count: props.diagnostics.length })}
            </p>
          </div>
        </div>
        {props.diagnostics.length > 0 && (
          <ol className={styles.problems}>
            {props.diagnostics.map((item, index) => (
              <li key={`${item.file}:${item.code}:${index}`}>
                <strong>■ {item.file}</strong>
                <span>{item.message}</span>
                <small>{item.code}{item.path ? ` · ${item.path}` : ""}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
