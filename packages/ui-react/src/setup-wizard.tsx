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
  type SetupApplyResult,
  type SetupInput,
  type SetupManifest,
  type SetupPlan,
  type SetupProfileId
} from "./api.js";

const profileChoices: Array<{
  id: string;
  titleKey: string;
  descriptionKey: string;
  profiles: SetupProfileId[];
}> = [
  {
    id: "product-planning",
    titleKey: "wizard.profile.productPlanning.title",
    descriptionKey: "wizard.profile.productPlanning.description",
    profiles: ["product-planning"]
  },
  {
    id: "basic",
    titleKey: "wizard.profile.basic.title",
    descriptionKey: "wizard.profile.basic.description",
    profiles: ["software-basic"]
  },
  {
    id: "architecture",
    titleKey: "wizard.profile.architecture.title",
    descriptionKey: "wizard.profile.architecture.description",
    profiles: ["software-basic", "arc42"]
  },
  {
    id: "project-management",
    titleKey: "wizard.profile.projectManagement.title",
    descriptionKey: "wizard.profile.projectManagement.description",
    profiles: ["software-basic", "project-management"]
  },
  {
    id: "minimal",
    titleKey: "wizard.profile.minimal.title",
    descriptionKey: "wizard.profile.minimal.description",
    profiles: ["minimal"]
  }
];

function templateIdsFor(
  manifest: SetupManifest,
  profiles: SetupProfileId[]
): string[] {
  const selected = new Set(profiles);
  return [
    ...new Set(
      manifest.profiles
        .filter((profile) => selected.has(profile.id))
        .flatMap((profile) => profile.templateIds)
    )
  ];
}

function defaultTemplateIdsFor(
  manifest: SetupManifest,
  profiles: SetupProfileId[]
): string[] {
  const available = new Set(templateIdsFor(manifest, profiles));
  return manifest.templates
    .filter(
      (template) =>
        available.has(template.id) && template.defaultSelected !== false
    )
    .map((template) => template.id);
}

// テンプレートのrelativePath（`docs/content/<folder>/<file>`）から論理フォルダ名を
// 取り出す。直下のファイル（welcomeや各ガイド）はフォルダなし（空文字）として扱う。
function logicalFolderOf(relativePath: string): string {
  const relative = relativePath.replace(/^docs\/content\//, "");
  const segments = relative.split("/");
  return segments.length > 1 ? segments[0]! : "";
}

// フォルダ名の言語別の既定値。言語切り替え時に「利用者が編集した欄」を判定するため、
// 前言語の既定と突き合わせる基準としても使う。
const FOLDER_NAME_DEFAULTS: Record<SupportedLanguage, Record<string, string>> = {
  ja: {
    project: "プロジェクト",
    requirements: "要求",
    decisions: "設計判断",
    architecture: "アーキテクチャ",
    "project-management": "プロジェクト管理"
  },
  en: {
    project: "project",
    requirements: "requirements",
    decisions: "decisions",
    architecture: "architecture",
    "project-management": "project-management"
  }
};

// 言語を切り替えても利用者が編集したフォルダ名は保持し、手を付けていない
// （前言語の既定のままの）欄だけ新しい言語の既定へ差し替える。
function mergeFolderNamesForLanguage(
  current: Record<string, string>,
  from: SupportedLanguage,
  to: SupportedLanguage
): Record<string, string> {
  const fromDefaults = FOLDER_NAME_DEFAULTS[from];
  const toDefaults = FOLDER_NAME_DEFAULTS[to];
  const merged = { ...current };
  for (const key of Object.keys(toDefaults)) {
    const value = current[key] ?? fromDefaults[key];
    if (value === fromDefaults[key]) merged[key] = toDefaults[key]!;
  }
  return merged;
}

type ContentRootError = "empty" | "absolute" | "parent";

// content root入力を正規化し、解決後pathが破綻しないようにする。
// `./docs`・末尾スラッシュ・重複スラッシュを畳み、絶対パスや `..` は不正として扱う。
function analyzeContentRoot(
  projectRoot: string,
  raw: string
): { normalized: string; resolved: string; error?: ContentRootError } {
  const unified = raw.trim().replaceAll("\\", "/");
  const base = projectRoot.replace(/\/+$/, "");
  if (unified === "") {
    return { normalized: "", resolved: base, error: "empty" };
  }
  if (unified.startsWith("/")) {
    return { normalized: unified, resolved: unified, error: "absolute" };
  }
  const segments = unified.split("/").filter((seg) => seg !== "" && seg !== ".");
  const normalized = segments.join("/");
  const resolved = normalized ? `${base}/${normalized}` : base;
  if (segments.includes("..")) {
    return { normalized, resolved, error: "parent" };
  }
  if (normalized === "") {
    return { normalized, resolved: base, error: "empty" };
  }
  return { normalized, resolved };
}

export function SetupWizard(props: {
  projectRoot: string;
  contentRoot: string;
  resolvedContentRoot: string;
  onComplete(): void;
}) {
  const [step, setStep] = useState(1);
  const [manifest, setManifest] = useState<SetupManifest>();
  const [choiceId, setChoiceId] = useState("basic");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, "skip" | "alternate">
  >({});
  const [plan, setPlan] = useState<SetupPlan>();
  const [result, setResult] = useState<SetupApplyResult>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [contentRoot, setContentRoot] = useState(props.contentRoot);
  const [language, setLanguage] = useState<SupportedLanguage>("ja");
  const [folderNames, setFolderNames] = useState<Record<string, string>>(
    () => ({ ...FOLDER_NAME_DEFAULTS.ja })
  );
  const [pageFileNames, setPageFileNames] = useState<Record<string, string>>({});
  const { t } = useTranslation();

  // 表示・検証・送信いずれも正規化済みのcontent rootを使う。
  const contentRootInfo = useMemo(
    () => analyzeContentRoot(props.projectRoot, contentRoot),
    [props.projectRoot, contentRoot]
  );

  useEffect(() => setUiLanguage(language), [language]);

  const steps = [
    t("wizard.step.intro"),
    t("wizard.step.location"),
    t("wizard.step.structure"),
    t("wizard.step.done")
  ];

  const profiles =
    profileChoices.find((choice) => choice.id === choiceId)?.profiles ??
    profileChoices[0]!.profiles;

  useEffect(() => {
    const controller = new AbortController();
    fetchSetupManifest(controller.signal)
      .then((response) => {
        setManifest(response.data);
        setSelectedTemplateIds(
          defaultTemplateIdsFor(response.data, profileChoices[0]!.profiles)
        );
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, []);

  const input = useMemo<SetupInput>(
    () => ({
      profiles,
      selectedTemplateIds,
      conflictResolutions,
      contentRoot: contentRootInfo.normalized,
      language,
      folderNames,
      pageFileNames
    }),
    [
      profiles,
      selectedTemplateIds,
      conflictResolutions,
      contentRootInfo.normalized,
      language,
      folderNames,
      pageFileNames
    ]
  );

  async function refreshPlan(
    resolutions = conflictResolutions,
    templateIds = selectedTemplateIds
  ) {
    setBusy(true);
    setMessage("");
    try {
      let next = (
        await previewSetup({
          profiles,
          selectedTemplateIds: templateIds,
          conflictResolutions: resolutions,
          contentRoot: contentRootInfo.normalized,
          language,
          folderNames,
          pageFileNames
        })
      ).data;
      const defaults = { ...resolutions };
      let changed = false;
      for (const file of next.files) {
        if (
          file.status === "conflict" &&
          file.templateId &&
          !defaults[file.templateId]
        ) {
          defaults[file.templateId] = "skip";
          changed = true;
        }
      }
      if (changed) {
        setConflictResolutions(defaults);
        next = (
          await previewSetup({
            profiles,
            selectedTemplateIds: templateIds,
            conflictResolutions: defaults,
            contentRoot: contentRootInfo.normalized,
            language,
            folderNames,
            pageFileNames
          })
        ).data;
      }
      setPlan(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step !== 3 || !manifest) return;
    const timer = window.setTimeout(() => {
      void refreshPlan();
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, manifest, choiceId, folderNames, pageFileNames]);

  async function changeResolution(
    templateId: string,
    resolution: "skip" | "alternate"
  ) {
    const next = { ...conflictResolutions, [templateId]: resolution };
    setConflictResolutions(next);
    await refreshPlan(next);
  }

  async function toggleTemplate(templateId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...selectedTemplateIds, templateId])]
      : selectedTemplateIds.filter((id) => id !== templateId);
    setSelectedTemplateIds(next);
    await refreshPlan(conflictResolutions, next);
  }

  async function apply() {
    if (!plan || plan.files.some((file) => file.status === "conflict")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await applySetup(input, plan.planHash);
      setResult(response.data);
      setStep(4);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage(t("wizard.error.conflict"));
        await refreshPlan();
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  const templatesById = new Map(
    manifest?.templates.map((template) => [template.id, template]) ?? []
  );
  const availableTemplateIds = manifest
    ? templateIdsFor(manifest, profiles)
    : [];
  // 作成対象を「保存先フォルダ」ごとにまとめる。フォルダ名の変更、作成可否、
  // ファイル名の変更、競合を1つのリストへ集約するための下ごしらえ。
  const structureGroups: Array<{ folder: string; templateIds: string[] }> = [];
  for (const templateId of availableTemplateIds) {
    const template = templatesById.get(templateId);
    if (!template) continue;
    const folder = logicalFolderOf(template.relativePath);
    let group = structureGroups.find((item) => item.folder === folder);
    if (!group) {
      group = { folder, templateIds: [] };
      structureGroups.push(group);
    }
    group.templateIds.push(templateId);
  }

  return (
    <main className="setup-shell">
      <header className="setup-header">
        <span className="setup-brand">Vellym</span>
        <span>{t("setup.title")}</span>
      </header>
      <ol className="setup-steps" aria-label={t("setup.progressLabel")}>
        {steps.map((label, index) => {
          const number = index + 1;
          return (
            <li
              key={label}
              className={number === step ? "current" : number < step ? "done" : ""}
              aria-current={number === step ? "step" : undefined}
            >
              <span aria-hidden="true">
                {number === step ? (
                  <Icon name="chevronRight" size={12} />
                ) : number < step ? (
                  <Icon name="check" size={12} />
                ) : (
                  number
                )}
              </span>{" "}
              {label}
            </li>
          );
        })}
      </ol>

      <section className="setup-card" aria-labelledby="setup-title">
        {step === 1 && (
          <>
            <p className="setup-kicker">{t("wizard.intro.kicker")}</p>
            <h1 id="setup-title">{t("wizard.intro.title")}</h1>
            <p>{t("wizard.intro.body1")}</p>
            <p>{t("wizard.intro.body2")}</p>
            <dl className="setup-location">
              <div>
                <dt>{t("wizard.intro.languageLabel")}</dt>
                <dd>
                  <select
                    value={language}
                    onChange={(event) => {
                      const next = event.target.value as SupportedLanguage;
                      setFolderNames((current) =>
                        mergeFolderNamesForLanguage(current, language, next)
                      );
                      setLanguage(next);
                      setPlan(undefined);
                    }}
                  >
                    <option value="ja">日本語</option>
                    <option value="en">English</option>
                  </select>
                </dd>
              </div>
            </dl>
            <p className="setup-note">{t("wizard.intro.languageHint")}</p>
            <div className="setup-actions">
              <button className="primary" type="button" onClick={() => setStep(2)}>
                {t("wizard.intro.next")}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="setup-kicker">{t("wizard.location.kicker")}</p>
            <h1 id="setup-title">{t("wizard.location.title")}</h1>
            <p>{t("wizard.location.body")}</p>
            <dl className="setup-location">
              <div>
                <dt>{t("wizard.location.projectRoot")}</dt>
                <dd>{props.projectRoot}</dd>
              </div>
              <div>
                <dt>{t("wizard.location.contentFolder")}</dt>
                <dd>
                  <input
                    type="text"
                    value={contentRoot}
                    aria-invalid={contentRootInfo.error ? true : undefined}
                    onChange={(event) => {
                      setContentRoot(event.target.value);
                      setPlan(undefined);
                    }}
                  />
                  {contentRootInfo.error && (
                    <p className="setup-error" role="alert">
                      {t(`wizard.location.error.${contentRootInfo.error}`)}
                    </p>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("wizard.location.resolved")}</dt>
                <dd>{contentRootInfo.resolved}</dd>
              </div>
              <div>
                <dt>{t("wizard.location.configFile")}</dt>
                <dd>vellym.config.yaml</dd>
              </div>
            </dl>
            <p className="setup-note">{t("wizard.location.note")}</p>
            <div className="setup-actions">
              <button type="button" onClick={() => setStep(1)}>
                {t("wizard.location.back")}
              </button>
              <button
                className="primary"
                type="button"
                disabled={Boolean(contentRootInfo.error)}
                onClick={() => setStep(3)}
              >
                {t("wizard.location.next")}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="setup-kicker">{t("wizard.structure.kicker")}</p>
            <h1 id="setup-title">{t("wizard.structure.title")}</h1>
            <p>{t("wizard.structure.body")}</p>
            <fieldset className="profile-list" disabled={!manifest || busy}>
              <legend className="visually-hidden">
                {t("wizard.structure.profilesLegend")}
              </legend>
              {profileChoices.map((choice) => {
                const count = manifest
                  ? templateIdsFor(manifest, choice.profiles).length
                  : 0;
                return (
                  <label
                    key={choice.id}
                    className={choiceId === choice.id ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="setup-profile"
                      checked={choiceId === choice.id}
                      onChange={() => {
                        setChoiceId(choice.id);
                        setPlan(undefined);
                        setConflictResolutions({});
                        if (manifest) {
                          setSelectedTemplateIds(
                            defaultTemplateIdsFor(manifest, choice.profiles)
                          );
                        }
                      }}
                    />
                    <span>
                      <strong>{t(choice.titleKey)}</strong>
                      <small>
                        {t(choice.descriptionKey)}{" "}
                        {t("wizard.structure.maxDocs", { count })}
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <fieldset className="profile-list" disabled={busy}>
              <legend>{t("wizard.structure.filesLegend")}</legend>
              {busy && <p role="status">{t("wizard.structure.checking")}</p>}
              <div className="setup-structure">
                {structureGroups.map((group) => (
                  <section className="structure-group" key={group.folder || "root"}>
                    {group.folder === "" ? (
                      <p className="structure-group-root">
                        {t("wizard.structure.rootGroup")}
                      </p>
                    ) : (
                      <label
                        className="structure-group-heading"
                        data-field="folder-name"
                      >
                        <span>{t("wizard.structure.folderLabel")}</span>
                        <input
                          type="text"
                          value={folderNames[group.folder] ?? group.folder}
                          onChange={(event) => {
                            const value = event.target.value;
                            setFolderNames((current) => ({
                              ...current,
                              [group.folder]: value
                            }));
                          }}
                        />
                      </label>
                    )}
                    <ul className="setup-file-list">
                      {group.templateIds.map((templateId) => {
                        const file = plan?.files.find(
                          (candidate) => candidate.templateId === templateId
                        );
                        const template = templatesById.get(templateId);
                        const selected =
                          selectedTemplateIds.includes(templateId);
                        return (
                          <li key={templateId}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={busy}
                                onChange={(event) =>
                                  void toggleTemplate(
                                    templateId,
                                    event.currentTarget.checked
                                  )
                                }
                              />
                              <span>
                                <strong>{template?.title}</strong>
                                <small>{template?.description}</small>
                              </span>
                            </label>
                            {selected && template?.editableFileName && (
                              <label
                                className="structure-file-name"
                                data-field="file-name"
                              >
                                <span>{t("wizard.structure.fileNameLabel")}</span>
                                <input
                                  type="text"
                                  value={
                                    pageFileNames[templateId] ??
                                    template.defaultFileName ??
                                    ""
                                  }
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setPageFileNames((current) => ({
                                      ...current,
                                      [templateId]: value
                                    }));
                                  }}
                                />
                              </label>
                            )}
                            {file?.status === "skip" && (
                              <div className="file-conflict">
                                <span>
                                  ▲{" "}
                                  {file.conflictReason === "page-id"
                                    ? t("wizard.structure.skipReasonPageId")
                                    : t("wizard.structure.skipReasonExists")}
                                </span>
                                {file.conflictReason !== "page-id" && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void changeResolution(
                                        templateId,
                                        "alternate"
                                      )
                                    }
                                  >
                                    {t("wizard.structure.createAlternate")}
                                  </button>
                                )}
                              </div>
                            )}
                            {file?.status === "create" &&
                              conflictResolutions[templateId] === "alternate" && (
                                <div className="file-conflict">
                                  <span>
                                    <Icon name="check" size={13} />{" "}
                                    {t("wizard.structure.alternateCreated")}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void changeResolution(templateId, "skip")
                                    }
                                  >
                                    {t("wizard.structure.cancelAlternate")}
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
              <p className="setup-note">{t("wizard.structure.fileNameNote")}</p>
            </fieldset>
            <div className="setup-actions">
              <button type="button" disabled={busy} onClick={() => setStep(2)}>
                {t("wizard.structure.back")}
              </button>
              <button
                className="primary"
                type="button"
                disabled={
                  busy ||
                  !plan ||
                  plan.files.some((file) => file.status === "conflict")
                }
                onClick={() => void apply()}
              >
                {busy ? t("wizard.structure.creating") : t("wizard.structure.createAction")}
              </button>
            </div>
          </>
        )}

        {step === 4 && result && (
          <>
            <p className="setup-kicker">{t("wizard.done.kicker")}</p>
            <h1 id="setup-title">{t("wizard.done.title")}</h1>
            <p role="status">
              {t("wizard.done.summary", {
                created: result.created.filter((file) => file.templateId).length
              })}
              {result.skipped.length > 0 &&
                t("wizard.done.skippedSuffix", { skipped: result.skipped.length })}
            </p>
            <div className="setup-actions">
              <button className="primary" type="button" onClick={props.onComplete}>
                {t("wizard.done.openFirst")}
              </button>
            </div>
          </>
        )}

        {message && (
          <div className="setup-error" role="alert">
            <strong>■ {t("wizard.error.kicker")}</strong>
            <p>{message}</p>
          </div>
        )}
      </section>
    </main>
  );
}
