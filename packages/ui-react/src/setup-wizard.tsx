import { useEffect, useMemo, useState } from "react";
import type { SupportedLanguage } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { setUiLanguage } from "./i18n.js";
import { Icon } from "./icon.js";
import {
  ApiError,
  applySetup,
  fetchSetupManifest,
  previewSetup,
  type DevelopmentMethod,
  type DocumentationLevel,
  type ProjectSize,
  type SetupApplyResult,
  type SetupInput,
  type SetupManifest,
  type SetupMode,
  type SetupPlan,
  type SetupTemplate
} from "./api.js";
import { errorMessage } from "./error-message.js";

type ContentRootError = "empty" | "absolute" | "parent";

function analyzeContentRoot(
  projectRoot: string,
  raw: string
): { normalized: string; resolved: string; error?: ContentRootError } {
  const unified = raw.trim().replaceAll("\\", "/");
  const base = projectRoot.replace(/\/+$/, "");
  if (!unified) return { normalized: "", resolved: base, error: "empty" };
  if (unified.startsWith("/")) {
    return { normalized: unified, resolved: unified, error: "absolute" };
  }
  const segments = unified.split("/").filter((item) => item && item !== ".");
  const normalized = segments.join("/");
  if (segments.includes("..")) {
    return { normalized, resolved: `${base}/${normalized}`, error: "parent" };
  }
  if (!normalized) return { normalized, resolved: base, error: "empty" };
  return { normalized, resolved: `${base}/${normalized}` };
}

const LEVEL_RANK: Record<DocumentationLevel, number> = {
  light: 0,
  standard: 1,
  strict: 2
};

function estimatedTemplateIds(
  manifest: SetupManifest,
  size: ProjectSize,
  method: DevelopmentMethod,
  level: DocumentationLevel
): string[] {
  const selected = new Set(
    manifest.templates
      .filter(
        (item) =>
          item.requiredness !== "optional" &&
          LEVEL_RANK[item.minimumLevel ?? "strict"] <= LEVEL_RANK[level] &&
          (!item.sizes || item.sizes.includes(size)) &&
          (!item.methods || item.methods.includes(method))
      )
      .map((item) => item.id)
  );
  const byId = new Map(manifest.templates.map((item) => [item.id, item]));
  const addDependencies = (id: string): void => {
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (selected.has(dependency)) continue;
      selected.add(dependency);
      addDependencies(dependency);
    }
  };
  for (const id of [...selected]) addDependencies(id);
  return [...selected];
}

function templateText(
  template: SetupTemplate,
  language: SupportedLanguage
): { title: string; description: string } {
  return language === "en"
    ? {
        title: template.titleEn ?? template.title,
        description: template.descriptionEn ?? template.description
      }
    : { title: template.title, description: template.description };
}

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
  const [manifest, setManifest] = useState<SetupManifest>();
  const operation = props.operation ?? "initialize";
  const adding = operation === "add";
  const [mode, setMode] = useState<SetupMode>(adding ? "templates" : "recommended");
  const [size, setSize] = useState<ProjectSize>("small-team");
  const [method, setMethod] = useState<DevelopmentMethod>("hybrid");
  const [level, setLevel] = useState<DocumentationLevel>("standard");
  const [language, setLanguage] = useState<SupportedLanguage>(props.initialLanguage ?? "ja");
  const [contentRoot, setContentRoot] = useState(props.contentRoot);
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [selectionReady, setSelectionReady] = useState(false);
  const [pageFileNames, setPageFileNames] = useState<Record<string, string>>({});
  const [pageTitles, setPageTitles] = useState<Record<string, string>>({});
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, "skip" | "alternate">
  >({});
  const [plan, setPlan] = useState<SetupPlan>();
  const [result, setResult] = useState<SetupApplyResult>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const ja = language === "ja";
  const copy = {
    steps: ja ? ["基本情報", "構成案", "生成内容"] : ["Basics", "Plan", "Create"],
    title: ja ? "初期プロジェクト構成" : "Initial project structure",
    next: ja ? "次へ" : "Next",
    back: ja ? "戻る" : "Back",
    recommended: ja ? "Vellymのおすすめ" : "Vellym recommendation",
    templates: ja ? "組み込みテンプレートを選ぶ" : "Choose built-in templates",
    empty: ja ? "空のプロジェクト" : "Empty project",
    create: ja ? "この内容で生成" : "Create project",
    creating: ja ? "生成中…" : "Creating…"
  };

  const contentRootInfo = useMemo(
    () => analyzeContentRoot(props.projectRoot, contentRoot),
    [props.projectRoot, contentRoot]
  );

  useEffect(() => {
    if (!adding) setUiLanguage(language);
  }, [adding, language]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSetupManifest(controller.signal)
      .then((response) => {
        setManifest(response.data);
        setFolderNames(
          Object.fromEntries(
            response.data.areas.map((area) => [area.id, area.folderName[language]])
          )
        );
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(errorMessage(error, t));
      });
    return () => controller.abort();
  }, []);

  const input = useMemo<SetupInput>(
    () => ({
      operation,
      mode,
      size,
      method,
      level,
      ...(selectionReady ? { selectedTemplateIds } : {}),
      conflictResolutions,
      contentRoot: contentRootInfo.normalized,
      language,
      folderNames,
      pageFileNames,
      pageTitles
    }),
    [
      mode,
      operation,
      size,
      method,
      level,
      selectionReady,
      selectedTemplateIds,
      conflictResolutions,
      contentRootInfo.normalized,
      language,
      folderNames,
      pageFileNames,
      pageTitles
    ]
  );

  async function refreshPlan(nextInput: SetupInput = input) {
    if (contentRootInfo.error) return;
    setBusy(true);
    setMessage("");
    try {
      let next = (await previewSetup(nextInput)).data;
      if (!selectionReady && mode === "recommended") {
        setSelectedTemplateIds(next.selectedTemplateIds);
        setSelectionReady(true);
      }
      const resolutions = { ...nextInput.conflictResolutions };
      let changed = false;
      for (const file of next.files) {
        if (file.templateId && file.status === "conflict" && !resolutions[file.templateId]) {
          resolutions[file.templateId] = "skip";
          changed = true;
        }
      }
      if (changed) {
        setConflictResolutions(resolutions);
        next = (await previewSetup({ ...nextInput, conflictResolutions: resolutions })).data;
      }
      setPlan(next);
    } catch (error) {
      setMessage(errorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step !== 3 || !manifest) return;
    const timer = window.setTimeout(() => void refreshPlan(), 200);
    return () => window.clearTimeout(timer);
    // refreshPlan is intentionally driven by the serialized input fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, manifest, input]);

  function selectLanguage(next: SupportedLanguage) {
    setLanguage(next);
    if (manifest) {
      setFolderNames((current) =>
        Object.fromEntries(
          manifest.areas.map((area) => {
            const previousDefault = area.folderName[language];
            const currentName = current[area.id];
            return [
              area.id,
              !currentName || currentName === previousDefault
                ? area.folderName[next]
                : currentName
            ] as const;
          })
        )
      );
    }
    setPlan(undefined);
  }

  function enterFinalStep() {
    if (mode === "empty") {
      setSelectedTemplateIds([]);
      setSelectionReady(true);
    } else if (mode === "templates") {
      setSelectionReady(true);
    } else {
      setSelectionReady(false);
    }
    setPlan(undefined);
    setStep(3);
  }

  async function apply() {
    if (!plan || plan.files.some((file) => file.status === "conflict")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await applySetup(input, plan);
      setResult(response.data);
      setStep(4);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage(ja ? "生成対象が変更されました。再確認してください。" : "The target changed. Review it again.");
        await refreshPlan();
      } else {
        setMessage(errorMessage(error, t));
      }
    } finally {
      setBusy(false);
    }
  }

  const templatesById = new Map(
    manifest?.templates.map((template) => [template.id, template]) ?? []
  );
  const visibleTemplates = mode === "empty" ? [] : manifest?.templates ?? [];
  const groups = (manifest?.areas ?? [])
    .map((area) => ({
      area,
      templates: visibleTemplates.filter((template) => template.areaId === area.id)
    }))
    .filter((group) => group.templates.length);

  return (
    <div className="setup-shell">
      <header className="setup-header">
        <span className="setup-brand">Vellym</span>
        <span>{adding ? (ja ? "構成を追加" : "Add project content") : copy.title}</span>
      </header>
      <ol className="setup-steps" aria-label={t("setup.progressLabel")}>
        {copy.steps.map((label, index) => {
          const number = index + 1;
          return (
            <li
              key={label}
              className={number === step ? "current" : number < step ? "done" : ""}
              aria-current={number === step ? "step" : undefined}
            >
              <span aria-hidden="true">
                {number < step ? <Icon name="check" size={12} /> : number}
              </span>{" "}
              {label}
            </li>
          );
        })}
      </ol>

      <section className="setup-card" aria-labelledby="setup-title">
        {step === 1 && (
          <>
            <h1 id="setup-title">{adding ? (ja ? "追加方法と基本情報" : "Addition and basics") : (ja ? "開始方法と基本情報" : "Start and basics")}</h1>
            <fieldset className="profile-list">
              <legend>{ja ? "開始方法" : "Starting point"}</legend>
              {([
                ["recommended", copy.recommended],
                ["templates", copy.templates],
                ...(adding ? [] : [["empty", copy.empty] as [SetupMode, string]])
              ] as Array<[SetupMode, string]>).map(([value, label]) => (
                <label key={value} className={mode === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="setup-mode"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setSelectedTemplateIds([]);
                      setSelectionReady(value !== "recommended");
                    }}
                  />
                  <span><strong>{label}</strong></span>
                </label>
              ))}
            </fieldset>
            <dl className="setup-location">
              <div>
                <dt>{ja ? "初期生成言語" : "Generated language"}</dt>
                <dd>
                  <select value={language} onChange={(event) => selectLanguage(event.target.value as SupportedLanguage)}>
                    <option value="ja">日本語</option>
                    <option value="en">English</option>
                  </select>
                </dd>
              </div>
              <div><dt>project root</dt><dd>{props.projectRoot}</dd></div>
              <div>
                <dt>content root</dt>
                <dd>
                  <input disabled={adding} value={contentRoot} onChange={(event) => setContentRoot(event.target.value)} />
                  {contentRootInfo.error && <p className="setup-error">{ja ? "project内の相対pathを指定してください" : "Enter a relative path inside the project"}</p>}
                </dd>
              </div>
            </dl>
            {mode === "recommended" && (
              <dl className="setup-location">
                <div>
                  <dt>{ja ? "プロジェクト規模" : "Project size"}</dt>
                  <dd>
                    <select value={size} onChange={(event) => setSize(event.target.value as ProjectSize)}>
                      <option value="personal">{ja ? "個人・超小規模" : "Personal / very small"}</option>
                      <option value="small-team">{ja ? "小規模チーム" : "Small team"}</option>
                      <option value="medium-large">{ja ? "中〜大規模" : "Medium / large"}</option>
                    </select>
                  </dd>
                </div>
                <div>
                  <dt>{ja ? "開発方式" : "Development method"}</dt>
                  <dd>
                    <select value={method} onChange={(event) => setMethod(event.target.value as DevelopmentMethod)}>
                      <option value="agile">{ja ? "アジャイル" : "Agile"}</option>
                      <option value="hybrid">{ja ? "ハイブリッド" : "Hybrid"}</option>
                      <option value="waterfall">{ja ? "ウォーターフォール" : "Waterfall"}</option>
                    </select>
                  </dd>
                </div>
              </dl>
            )}
            <div className="setup-actions">
              <button
                className="primary"
                type="button"
                disabled={Boolean(contentRootInfo.error) || !manifest}
                onClick={() => mode === "recommended" ? setStep(2) : enterFinalStep()}
              >
                {copy.next}
              </button>
            </div>
          </>
        )}

        {step === 2 && manifest && (
          <>
            <h1 id="setup-title">{ja ? "おすすめ構成" : "Recommended structure"}</h1>
            <p>{ja ? "管理量を選びます。標準をおすすめします。" : "Choose the management level. Standard is recommended."}</p>
            <fieldset className="profile-list">
              <legend className="visually-hidden">level</legend>
              {(["light", "standard", "strict"] as DocumentationLevel[]).map((value) => {
                const count = estimatedTemplateIds(manifest, size, method, value).length;
                const names = ja
                  ? { light: "軽量", standard: "標準（おすすめ）", strict: "厳格" }
                  : { light: "Light", standard: "Standard (recommended)", strict: "Strict" };
                return (
                  <label key={value} className={level === value ? "selected" : ""}>
                    <input type="radio" name="setup-level" checked={level === value} onChange={() => setLevel(value)} />
                    <span>
                      <strong>{names[value]}</strong>
                      <small>{ja ? `${count} Page候補` : `${count} Page candidates`}</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="setup-actions">
              <button type="button" onClick={() => setStep(1)}>{copy.back}</button>
              <button className="primary" type="button" onClick={enterFinalStep}>{copy.next}</button>
            </div>
          </>
        )}

        {step === 3 && manifest && (
          <>
            <h1 id="setup-title">{ja ? "生成内容の確認" : "Review generated content"}</h1>
            <p>
              {mode === "empty"
                ? (ja ? "標準FolderとPageを作成しません。" : "No standard Folders or Pages will be created.")
                : (ja ? "必要なPageだけを選び、名前を確認してください。" : "Choose the Pages you need and review their names.")}
            </p>
            {busy && <p role="status">{ja ? "生成計画を確認中…" : "Checking the plan…"}</p>}
            <div className="setup-structure">
              {groups.map(({ area, templates }) => (
                <section className="structure-group" key={area.id}>
                  <label className="structure-group-heading" data-field="folder-name">
                    <span>{ja ? "Folder名" : "Folder name"}</span>
                    <input
                      value={folderNames[area.id] ?? area.folderName[language]}
                      onChange={(event) => setFolderNames((current) => ({ ...current, [area.id]: event.target.value }))}
                    />
                  </label>
                  <ul className="setup-file-list">
                    {templates.map((template) => {
                      const text = templateText(template, language);
                      const file = plan?.files.find((item) => item.templateId === template.id);
                      const selected = selectedTemplateIds.includes(template.id);
                      return (
                        <li key={template.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={busy}
                              onChange={(event) => {
                                setSelectionReady(true);
                                setSelectedTemplateIds((current) =>
                                  event.target.checked
                                    ? [...new Set([...current, template.id])]
                                    : current.filter((id) => id !== template.id)
                                );
                              }}
                            />
                            <span>
                              <strong>{text.title}</strong>
                              <small>{text.description}</small>
                              {mode === "recommended" && (
                                <small>
                                  {plan?.recommendationReasons[template.id]
                                    ? `${ja ? "推薦理由" : "Reason"}: ${plan.recommendationReasons[template.id]}${selected ? "" : (ja ? "（現在は除外）" : " (currently excluded)")}`
                                    : (ja ? "選択条件の対象外（任意で追加可能）" : "Outside the selected criteria (may be added manually)")}
                                </small>
                              )}
                            </span>
                          </label>
                          {selected && (
                            <>
                              <label className="structure-file-name">
                                <span>{ja ? "Page名" : "Page title"}</span>
                                <input
                                  value={pageTitles[template.id] ?? file?.title ?? text.title}
                                  onChange={(event) => setPageTitles((current) => ({ ...current, [template.id]: event.target.value }))}
                                />
                              </label>
                              <label className="structure-file-name">
                                <span>{ja ? "ファイル名" : "Filename"}</span>
                                <input
                                  value={pageFileNames[template.id] ?? (file ? file.relativePath.split("/").pop() : "") ?? ""}
                                  onChange={(event) => setPageFileNames((current) => ({ ...current, [template.id]: event.target.value }))}
                                />
                              </label>
                            </>
                          )}
                          {file?.status === "skip" && (
                            <div className="file-conflict">
                              <span>{ja ? "既存ファイルがあるためskip" : "Skipped because the file exists"}</span>
                              <button type="button" onClick={() => setConflictResolutions((current) => ({ ...current, [template.id]: "alternate" }))}>
                                {ja ? "別名で作成" : "Create with another name"}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <div className="setup-actions">
              <button type="button" disabled={busy} onClick={() => setStep(mode === "recommended" ? 2 : 1)}>{copy.back}</button>
              <button
                className="primary"
                type="button"
                disabled={busy || !plan || plan.files.some((file) => file.status === "conflict")}
                onClick={() => void apply()}
              >
                {busy ? copy.creating : copy.create}
              </button>
            </div>
          </>
        )}

        {step === 4 && result && (
          <>
            <h1 id="setup-title">{adding ? (ja ? "構成を追加しました" : "Project content added") : (ja ? "初期構成を生成しました" : "Project structure created")}</h1>
            <p role="status">
              {ja
                ? `${result.created.filter((file) => file.kind === "page").length} Pageを作成しました。`
                : `Created ${result.created.filter((file) => file.kind === "page").length} Pages.`}
            </p>
            <div className="setup-actions">
              <button className="primary" type="button" onClick={props.onComplete}>
                {adding ? (ja ? "設定へ戻る" : "Back to settings") : (ja ? "プロジェクトを開く" : "Open project")}
              </button>
            </div>
          </>
        )}

        {message && (
          <div className="setup-error" role="alert"><strong>■ Error</strong><p>{message}</p></div>
        )}
      </section>
    </div>
  );
}
