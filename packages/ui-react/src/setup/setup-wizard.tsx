import { useEffect, useMemo, useRef, useState } from "react";
import type { SupportedLanguage } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { setUiLanguage } from "../shared/i18n.js";
import { ApiError, applyInit, fetchInitCatalog, previewInit, type InitCatalog, type InitInput, type InitPlan } from "../shared/api.js";
import { errorMessage } from "../shared/error-message.js";
import { Button } from "../shared/button.js";
import { InitFolderTree } from "./init-folder-tree.js";
import pluginOptions from "./plugin-options.json";
import styles from "./setup.module.css";

// Kept for existing consumers of the review summary helper.
export function reviewSummary(files: readonly { status: string }[]) {
  return files.reduce((summary, file) => {
    if (file.status === "create" || file.status === "update") summary.create++;
    else if (file.status === "skip" || file.status === "reuse") summary.keep++;
    else if (file.status === "conflict") summary.conflict++;
    return summary;
  }, { create: 0, keep: 0, conflict: 0 });
}

const structureIds = ["by-type", "by-phase", "by-feature"] as const;

export function SetupWizard(props: {
  projectRoot: string;
  contentRoot: string;
  resolvedContentRoot: string;
  operation?: "initialize" | "add";
  initialLanguage?: SupportedLanguage;
  onComplete(): void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [language, setLanguage] = useState<SupportedLanguage>(props.initialLanguage ?? "ja");
  const [root, setRoot] = useState<InitInput["root"]>("docs");
  const [structure, setStructure] = useState<InitInput["structure"]>("by-type");
  const [numbered, setNumbered] = useState(false);
  const [supplementGuide, setSupplementGuide] = useState(false);
  // Overrides are scoped by structure and language; returning to a step or type
  // restores edits without carrying translated defaults into the next language.
  const [names, setNames] = useState<Record<string, Record<string, string>>>({});
  const [plugins, setPlugins] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<InitCatalog>();
  const [catalogLanguage, setCatalogLanguage] = useState<SupportedLanguage>();
  const [plan, setPlan] = useState<InitPlan>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failedApply, setFailedApply] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const scope = `${language}:${structure}`;
  const folderNames = useMemo(() => names[scope] ?? {}, [names, scope]);
  const activeNames = useMemo(() => {
    const ids = new Set<string>();
    function visit(folders: NonNullable<InitCatalog["structures"][number]["folders"]>) {
      for (const folder of folders) { ids.add(folder.id); visit(folder.children ?? []); }
    }
    visit(catalog?.structures.find(item => item.id === structure)?.folders ?? []);
    if (supplementGuide) visit(catalog?.structures.find(item => item.id === "guide")?.folders ?? []);
    return Object.fromEntries(Object.entries(folderNames).filter(([id]) => ids.has(id)));
  }, [catalog, structure, supplementGuide, folderNames]);
  const input = useMemo<InitInput>(() => ({
    root, structure, numbered, supplementGuide, language, folderNames: activeNames,
    plugins: pluginOptions.filter(option => plugins.includes(option.id)).map(option => option.packageName)
  }), [root, structure, numbered, supplementGuide, language, activeNames, plugins]);
  const ready = catalogLanguage === language && Boolean(catalog);
  const folders = ready ? [
    ...(catalog?.structures.find(item => item.id === structure)?.folders ?? []),
    ...(supplementGuide ? catalog?.structures.find(item => item.id === "guide")?.folders ?? [] : [])
  ] : [];
  const resolvedRoot = `${props.projectRoot.replace(/\/+$/, "")}${root === "." ? "" : `/${root}`}` || "/";

  useEffect(() => { setUiLanguage(language); }, [language]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    const controller = new AbortController();
    setMessage("");
    fetchInitCatalog(language, controller.signal).then(response => {
      setCatalog(response.data);
      setCatalogLanguage(language);
    }).catch(error => {
      if (!controller.signal.aborted) setMessage(errorMessage(error, t));
    });
    return () => controller.abort();
  }, [language, t]);

  // A cancelled request must never replace the plan for newer choices. Clear
  // the old plan before requesting, so Create cannot submit stale input.
  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    setPlan(undefined);
    setBusy(true);
    setMessage("");
    previewInit(input).then(response => {
      if (!cancelled) setPlan(response.data);
    }).catch(error => {
      if (!cancelled) setMessage(errorMessage(error, t));
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [step, input, t]);

  async function create() {
    if (!plan || busy) return;
    setBusy(true);
    setMessage("");
    setFailedApply(false);
    try {
      await applyInit(plan);
      // The generated index is the entry page. Let the app reload bootstrap
      // at its explicit URL rather than selecting some pre-existing document.
      // When an existing index.yaml was kept (skipped), vellym-index does not
      // exist: open the workspace and let it pick the entry instead.
      const entry = root === "." ? "index.yaml" : `${root}/index.yaml`;
      const created = plan.files.some(file => file.relativePath === entry && file.status === "create");
      window.history.replaceState(null, "", created ? `/${language}/pages/vellym-index/` : `/${language}/`);
      props.onComplete();
    } catch (error) {
      setFailedApply(true);
      setMessage(errorMessage(error, t));
      setPlan(undefined);
      // Re-plan after any failure, including stale hashes (409), so retry
      // always uses the actual filesystem, never the failed plan.
      try { setPlan((await previewInit(input)).data); }
      catch (planError) { setMessage(errorMessage(planError, t)); }
      if (error instanceof ApiError && error.status === 409) setFailedApply(false);
    } finally { setBusy(false); }
  }

  const steps = ["location", "structure", "plugins", "review"] as const;
  return (
    <main className={styles["setup-shell"]} data-testid="setup-wizard">
      <header className={styles["setup-header"]}>
        <span className={styles["setup-brand"]}>Vellym</span>
        <span>{t("init.title")}</span>
      </header>
      <ol className={styles["setup-steps"]} aria-label={t("setup.progressLabel")} data-testid="setup-progress">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? "step" : undefined}
            className={step === index + 1 ? styles.current : step > index + 1 ? styles.done : ""}>
            <span aria-hidden="true">{step === index + 1 ? "▶" : step > index + 1 ? "✓" : index + 1}</span>{" "}
            {t(`init.steps.${label}`)}
          </li>
        ))}
      </ol>
      <section className={`${styles["setup-card"]} ${styles["init-card"]}`} aria-labelledby="setup-title" aria-busy={busy}>
        <h1 id="setup-title" ref={heading} tabIndex={-1} data-testid="setup-heading">{t(`init.steps.${steps[step - 1]}`)}</h1>
        {step === 1 && <>
          <fieldset className={styles["profile-list"]}>
            <legend>{t("init.root")}</legend>
            {(["docs", "vellym", "."] as const).map(value => (
              <label key={value} className={root === value ? styles.selected : ""}>
                <input type="radio" name="init-root" data-testid={`setup-root-${value === "." ? "project" : value}`}
                  checked={root === value} onChange={() => setRoot(value)} />
                <span>{t(`init.roots.${value === "." ? "project" : value}`)}</span>
              </label>
            ))}
          </fieldset>
          <p className={styles["init-path"]}>{t("init.absolutePath")} <code data-testid="setup-absolute-path">{resolvedRoot}</code></p>
          <label className={styles["init-field"]}>
            <span>{t("init.language")}</span>
            <select data-testid="setup-language" value={language} onChange={event => setLanguage(event.target.value as SupportedLanguage)}>
              <option lang="ja" value="ja">日本語</option>
              <option lang="en" value="en">English</option>
            </select>
          </label>
        </>}
        {step === 2 && <div className={styles["init-columns"]}>
          <div>
            <fieldset className={styles["profile-list"]}>
              <legend>{t("init.structure")}</legend>
              {structureIds.map(id => (
                <label key={id} className={structure === id ? styles.selected : ""}>
                  <input type="radio" name="init-structure" data-testid={`setup-structure-${id}`}
                    checked={structure === id} onChange={() => {
                      setStructure(id);
                      setNumbered(catalog?.structures.find(item => item.id === id)?.numberedByDefault ?? false);
                    }} />
                  <span><strong>{t(`init.structures.${id}.title`)}</strong><small>{t(`init.structures.${id}.hint`)}</small></span>
                </label>
              ))}
            </fieldset>
            <label className={styles["init-check"]}><input type="checkbox" data-testid="setup-guide"
              checked={supplementGuide} onChange={event => setSupplementGuide(event.target.checked)} />{t("init.supplementGuide")}</label>
            <label className={styles["init-check"]}><input type="checkbox" data-testid="setup-numbered"
              checked={numbered} onChange={event => setNumbered(event.target.checked)} />{t("init.numbered")}</label>
          </div>
          <div>
            <h2>{t("init.folderTree")}</h2>
            <InitFolderTree folders={folders} numbered={numbered} names={folderNames}
              onRename={(id, value) => setNames(current => ({ ...current, [scope]: { ...current[scope], [id]: value } }))} />
          </div>
        </div>}
        {step === 3 && <fieldset className={styles["profile-list"]}>
          <legend>{t("init.plugins")}</legend>
          {pluginOptions.map(option => <label key={option.id} className={plugins.includes(option.id) ? styles.selected : ""}>
            <input type="checkbox" data-testid={`setup-plugin-${option.id}`} checked={plugins.includes(option.id)}
              onChange={event => setPlugins(current => event.target.checked ? [...current, option.id] : current.filter(item => item !== option.id))} />
            <span><strong>{t(option.titleKey)}</strong><small>{t(option.hintKey)}</small></span>
          </label>)}
        </fieldset>}
        {step === 4 && <>
          <p role="status" data-testid="setup-plan-status">{busy ? t("init.planning") : t("init.summary", {
            create: plan?.files.filter(file => file.status !== "skip").length ?? 0,
            skip: plan?.files.filter(file => file.status === "skip").length ?? 0
          })}</p>
          {(["create", "skip"] as const).map(group => <div key={group}>
            <h2>{t(`init.${group === "create" ? "willCreate" : "willSkip"}`)}</h2>
            <ul className={styles["init-files"]} data-testid={`setup-files-${group}`}>
              {plan?.files.filter(file => group === "skip" ? file.status === "skip" : file.status !== "skip").map(file =>
                <li key={file.relativePath}><code>{file.relativePath}</code>{file.status === "update" && <span> — {t("init.append")}</span>}</li>)}
            </ul>
          </div>)}
        </>}
        {message && <div className={styles["setup-error"]} role="alert"><p>{message}</p>
          {failedApply && <p>{t("init.rolledBack")}</p>}
        </div>}
        <div className={styles["setup-actions"]}>
          {step > 1 && <Button data-testid="setup-back" disabled={busy} onClick={() => setStep(current => current - 1)}>{t("init.back")}</Button>}
          {step < 4
            ? <Button tone="primary" data-testid="setup-next" disabled={!ready} onClick={() => setStep(current => current + 1)}>{t("init.next")}</Button>
            : <Button tone="primary" data-testid="setup-create" disabled={busy || !plan} onClick={() => void create()}>{busy ? t("init.creating") : t("init.create")}</Button>}
        </div>
      </section>
    </main>
  );
}
