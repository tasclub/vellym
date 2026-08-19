import { useEffect, useMemo, useState } from "react";
import type { SupportedLanguage } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { setUiLanguage } from "../shared/i18n.js";
import { Icon } from "../shared/icon.js";
import {
  ApiError,
  applySetup,
  fetchSetupCatalog,
  previewSetup,
  type DevelopmentMethod,
  type DocumentationLevel,
  type ProjectSize,
  type SetupApplyResult,
  type SetupCatalog,
  type SetupInput,
  type SetupMode,
  type SetupPlan
} from "../shared/api.js";
import {
  buildCatalogIndex,
  countNodes,
  estimateSelection,
  filterTree,
  resolveSelection,
  selectedTree,
  selectionIds,
  toggleNode,
  treeForIds,
  type SetupSelectionState,
  type SetupTreeNode
} from "./setup-catalog-tree.js";
import { SetupTree, referenceLabel } from "./setup-tree.js";
import { errorMessage } from "../shared/error-message.js";
import { Button } from "../shared/button.js";
import styles from "./setup.module.css";

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

const EMPTY_SELECTION: SetupSelectionState = {
  pageIds: new Set<string>(),
  explicitFolderIds: new Set<string>()
};

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
  const [catalog, setCatalog] = useState<SetupCatalog>();
  const operation = props.operation ?? "initialize";
  const adding = operation === "add";
  const [mode, setMode] = useState<SetupMode>(adding ? "templates" : "recommended");
  const [size, setSize] = useState<ProjectSize>("small-team");
  const [method, setMethod] = useState<DevelopmentMethod>("hybrid");
  const [level, setLevel] = useState<DocumentationLevel>("standard");
  const [language, setLanguage] = useState<SupportedLanguage>(props.initialLanguage ?? "ja");
  const [contentRoot, setContentRoot] = useState(props.contentRoot);
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<SetupSelectionState>(EMPTY_SELECTION);
  const [selectionReady, setSelectionReady] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState("");
  const [filterArea, setFilterArea] = useState("");
  const [filterReference, setFilterReference] = useState("");
  const [pageFileNames, setPageFileNames] = useState<Record<string, string>>({});
  const [pageTitles, setPageTitles] = useState<Record<string, string>>({});
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, "skip" | "alternate">
  >({});
  // Nodes shown on the review step. Captured when the step opens and only ever
  // grown, so unchecking a row leaves it in place instead of making it vanish
  // with no way back.
  const [reviewScope, setReviewScope] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<SetupPlan>();
  const [result, setResult] = useState<SetupApplyResult>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const ja = language === "ja";
  const copy = {
    steps: ja ? ["基本情報", "構成案", "生成内容"] : ["Basics", "Structure", "Create"],
    title: ja ? "初期プロジェクト構成" : "Initial project structure",
    next: ja ? "次へ" : "Next",
    back: ja ? "戻る" : "Back",
    recommended: ja ? "Vellymのおすすめ" : "Vellym recommendation",
    templates: ja ? "Folder・Pageを自分で選ぶ" : "Choose folders and pages yourself",
    empty: ja ? "空のプロジェクト" : "Empty project",
    create: ja ? "この内容で生成" : "Create project",
    creating: ja ? "生成中…" : "Creating…"
  };

  const contentRootInfo = useMemo(
    () => analyzeContentRoot(props.projectRoot, contentRoot),
    [props.projectRoot, contentRoot]
  );

  const index = useMemo(() => (catalog ? buildCatalogIndex(catalog) : undefined), [catalog]);

  useEffect(() => {
    if (!adding) setUiLanguage(language);
  }, [adding, language]);

  // The catalog carries localized folder names and page titles, so it is
  // reloaded whenever the generated language changes.
  useEffect(() => {
    const controller = new AbortController();
    fetchSetupCatalog(language, controller.signal)
      .then((response) => {
        setCatalog(response.data);
        setFolderNames((current) =>
          Object.fromEntries(
            response.data.folders.map((folder) => [
              folder.id,
              current[folder.id] ?? folder.defaultName
            ])
          )
        );
        setExpanded(
          new Set(response.data.folders.filter((folder) => !folder.parentId).map((f) => f.id))
        );
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(errorMessage(error, t));
      });
    return () => controller.abort();
  }, [language]);

  const resolved = useMemo(
    () => (index ? resolveSelection(index, selection) : undefined),
    [index, selection]
  );

  const input = useMemo<SetupInput>(
    () => ({
      operation,
      mode,
      size,
      method,
      level,
      ...(selectionReady
        ? {
            selectedTemplateIds: [...selection.pageIds],
            selectedFolderIds: [...selection.explicitFolderIds]
          }
        : {}),
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
      selection,
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
    if (step !== 3 || !catalog) return;
    const timer = window.setTimeout(() => void refreshPlan(), 200);
    return () => window.clearTimeout(timer);
    // refreshPlan is intentionally driven by the serialized input fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, catalog, input]);

  function selectLanguage(next: SupportedLanguage) {
    // Folder names come from the catalog for the chosen language, so any name
    // the user has not edited is reloaded with it.
    setFolderNames((current) => {
      if (!catalog) return current;
      return Object.fromEntries(
        catalog.folders.map((folder) => [
          folder.id,
          current[folder.id] === folder.defaultName ? folder.defaultName : current[folder.id] ?? ""
        ])
      );
    });
    setLanguage(next);
    setPlan(undefined);
  }

  function revealFolders(folderIds: Iterable<string>) {
    setExpanded((current) => new Set([...current, ...folderIds]));
  }

  function applyRecommendation(nextLevel: DocumentationLevel) {
    setLevel(nextLevel);
    if (!index) return;
    const estimate = estimateSelection(index, size, method, nextLevel);
    setSelection({ pageIds: new Set(estimate.pageIds), explicitFolderIds: new Set() });
    revealFolders(estimate.folderIds);
    setSelectionReady(true);
  }

  function enterStep2() {
    if (mode === "recommended") applyRecommendation(level);
    else if (mode === "empty") {
      setSelection(EMPTY_SELECTION);
      setSelectionReady(true);
    } else {
      // The manual route starts from an empty selection.
      setSelection(EMPTY_SELECTION);
      setSelectionReady(true);
    }
    setPlan(undefined);
    setStep(2);
  }

  function toggleExpanded(nodeId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function toggleSelected(nodeId: string, checked: boolean) {
    if (!index) return;
    const next = toggleNode(index, selection, nodeId, checked);
    setSelection(next);
    // Anything newly selected joins the review scope so it stays reachable.
    setReviewScope((scope) => new Set([...scope, ...selectionIds(resolveSelection(index, next))]));
    setSelectionReady(true);
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
        setMessage(
          ja
            ? "生成対象が変更されました。再確認してください。"
            : "The target changed. Review it again."
        );
        await refreshPlan();
      } else {
        setMessage(errorMessage(error, t));
      }
    } finally {
      setBusy(false);
    }
  }

  const catalogTree = useMemo(
    () =>
      index
        ? filterTree(index.roots, {
            query: filterQuery,
            areaId: filterArea,
            referenceModel: filterReference
          })
        : [],
    [index, filterQuery, filterArea, filterReference]
  );

  const finalTree = useMemo(
    () => (index && resolved ? selectedTree(index.roots, resolved) : []),
    [index, resolved]
  );
  const finalCounts = useMemo(() => countNodes(finalTree), [finalTree]);

  const reviewTree = useMemo(() => {
    if (!index || !resolved) return [];
    return treeForIds(index.roots, new Set([...reviewScope, ...selectionIds(resolved)]));
  }, [index, resolved, reviewScope]);
  const reviewFolderIds = useMemo(
    () =>
      reviewTree.flatMap(function collect(node): string[] {
        return node.kind === "folder"
          ? [node.id, ...node.children.flatMap(collect)]
          : node.children.flatMap(collect);
      }),
    [reviewTree]
  );
  const omittedIds = useMemo(() => {
    if (!resolved) return new Set<string>();
    const generated = selectionIds(resolved);
    return new Set([...reviewScope].filter((id) => !generated.has(id)));
  }, [resolved, reviewScope]);

  function levelPreview(value: DocumentationLevel) {
    if (!index) return { folders: 0, pages: 0, tree: [] as SetupTreeNode[] };
    const estimate = estimateSelection(index, size, method, value);
    const tree = selectedTree(index.roots, estimate);
    return { ...countNodes(tree), tree };
  }

  function detailFor(node: SetupTreeNode) {
    if (!index) return undefined;
    const file = plan?.files.find((item) => item.nodeId === node.id);
    if (node.kind === "folder") {
      const folder = index.folderById.get(node.id);
      if (!folder) return undefined;
      return (
        <div className={styles["setup-tree-detail"]}>
          <label className={styles["structure-file-name"]}>
            <span>{ja ? "Folder名" : "Folder name"}</span>
            <input
              value={folderNames[node.id] ?? folder.defaultName}
              onChange={(event) =>
                setFolderNames((current) => ({ ...current, [node.id]: event.target.value }))
              }
            />
          </label>
          {file?.status === "reuse" && (
            <p>
              {ja
                ? "既存フォルダを利用します（_index.yamlは変更しません）"
                : "Reuses the existing folder; its _index.yaml is left untouched."}
            </p>
          )}
          {file?.conflictReason === "ancestor" && (
            <p className={styles["file-conflict"]}>
              {ja
                ? "同名のファイルがあるため、この配下は作成できません。Folder名を変更してください。"
                : "A file uses this path, so nothing below it can be created. Rename the folder."}
            </p>
          )}
        </div>
      );
    }
    const page = index.pageById.get(node.id);
    if (!page) return undefined;
    return (
      <div className={styles["setup-tree-detail"]}>
        <label className={styles["structure-file-name"]}>
          <span>{ja ? "Page名" : "Page title"}</span>
          <input
            value={pageTitles[node.id] ?? file?.title ?? page.title}
            onChange={(event) =>
              setPageTitles((current) => ({ ...current, [node.id]: event.target.value }))
            }
          />
        </label>
        <label className={styles["structure-file-name"]}>
          <span>{ja ? "ファイル名" : "Filename"}</span>
          <input
            value={
              pageFileNames[node.id] ??
              (file ? file.relativePath.split("/").pop() : page.defaultFileName) ??
              page.defaultFileName
            }
            onChange={(event) =>
              setPageFileNames((current) => ({ ...current, [node.id]: event.target.value }))
            }
          />
        </label>
        {file?.status === "skip" && file.conflictReason !== "ancestor" && (
          <div className={styles["file-conflict"]}>
            <span>
              {file.conflictReason === "template-existing"
                ? ja
                  ? "同じテンプレートから作成済みのためskip"
                  : "Skipped because this template was already generated"
                : ja
                  ? "既存ファイルがあるためskip"
                  : "Skipped because the file exists"}
            </span>
            {file.conflictReason !== "template-existing" && (
              <Button
                onClick={() =>
                  setConflictResolutions((current) => ({ ...current, [node.id]: "alternate" }))
                }
              >
                {ja ? "別名で作成" : "Create with another name"}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles["setup-shell"]}>
      <header className={styles["setup-header"]}>
        <span className={styles["setup-brand"]}>Vellym</span>
        <span>{adding ? (ja ? "構成を追加" : "Add project content") : copy.title}</span>
      </header>
      <ol className={styles["setup-steps"]} aria-label={t("setup.progressLabel")}>
        {copy.steps.map((label, position) => {
          const number = position + 1;
          return (
            <li
              key={label}
              className={number === step ? styles["current"] : number < step ? styles["done"] : ""}
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

      <section className={styles["setup-card"]} aria-labelledby="setup-title">
        {step === 1 && (
          <>
            <h1 id="setup-title">
              {adding
                ? ja ? "追加方法と基本情報" : "Addition and basics"
                : ja ? "開始方法と基本情報" : "Start and basics"}
            </h1>
            <fieldset className={styles["profile-list"]}>
              <legend>{ja ? "開始方法" : "Starting point"}</legend>
              {([
                ["recommended", copy.recommended, ja ? "規模と開発方式から階層を提案します" : "Proposes a hierarchy from size and method"],
                ["templates", copy.templates, ja ? "組み込みカタログを空選択から開きます" : "Opens the built-in catalog with nothing selected"],
                ...(adding
                  ? []
                  : [["empty", copy.empty, ja ? "configとrepository rootだけを作成します" : "Creates only the config and repository root"] as [SetupMode, string, string]])
              ] as Array<[SetupMode, string, string]>).map(([value, label, hint]) => (
                <label key={value} className={mode === value ? styles["selected"] : ""}>
                  <input
                    type="radio"
                    name="setup-mode"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setSelection(EMPTY_SELECTION);
                      setSelectionReady(false);
                    }}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <dl className={styles["setup-location"]}>
              <div>
                <dt>{ja ? "初期生成言語" : "Generated language"}</dt>
                <dd>
                  <select
                    value={language}
                    onChange={(event) => selectLanguage(event.target.value as SupportedLanguage)}
                  >
                    <option value="ja">日本語</option>
                    <option value="en">English</option>
                  </select>
                </dd>
              </div>
              <div><dt>project root</dt><dd>{props.projectRoot}</dd></div>
              <div>
                <dt>content root</dt>
                <dd>
                  <input
                    disabled={adding}
                    value={contentRoot}
                    onChange={(event) => setContentRoot(event.target.value)}
                  />
                  {contentRootInfo.error && (
                    <p className={styles["setup-error"]}>
                      {ja
                        ? "project内の相対pathを指定してください"
                        : "Enter a relative path inside the project"}
                    </p>
                  )}
                </dd>
              </div>
            </dl>
            {mode === "recommended" && (
              <dl className={styles["setup-location"]}>
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
                    <select
                      value={method}
                      onChange={(event) => setMethod(event.target.value as DevelopmentMethod)}
                    >
                      <option value="agile">{ja ? "アジャイル" : "Agile"}</option>
                      <option value="hybrid">{ja ? "ハイブリッド" : "Hybrid"}</option>
                      <option value="waterfall">{ja ? "ウォーターフォール" : "Waterfall"}</option>
                    </select>
                  </dd>
                </div>
              </dl>
            )}
            <div className={styles["setup-actions"]}>
              <Button tone="primary"
                disabled={Boolean(contentRootInfo.error) || !catalog}
                onClick={enterStep2}
              >
                {copy.next}
              </Button>
            </div>
          </>
        )}

        {step === 2 && index && (
          <>
            <h1 id="setup-title">
              {mode === "recommended"
                ? ja ? "おすすめ構成" : "Recommended structure"
                : mode === "templates"
                  ? ja ? "Folder・Pageを選ぶ" : "Choose folders and pages"
                  : ja ? "空のプロジェクト" : "Empty project"}
            </h1>

            {mode === "recommended" && (
              <>
                <p>
                  {ja
                    ? "管理量を選びます。標準をおすすめします。生成する階層をそのまま確認できます。"
                    : "Choose how much to manage. Standard is recommended. The hierarchy below is what gets created."}
                </p>
                <fieldset className={styles["profile-list"]}>
                  <legend className={"visually-hidden"}>level</legend>
                  {(["light", "standard", "strict"] as DocumentationLevel[]).map((value) => {
                    const preview = levelPreview(value);
                    const names = ja
                      ? { light: "軽量", standard: "標準（おすすめ）", strict: "厳格" }
                      : { light: "Light", standard: "Standard (recommended)", strict: "Strict" };
                    const reasons = ja
                      ? {
                          light: "管理コストを抑え、最低限必要なPageだけを持ちます",
                          standard: "管理・技術・品質をバランスよく扱います",
                          strict: "証跡、変更、引継ぎ、追跡性を重視します"
                        }
                      : {
                          light: "Keeps overhead low with only the essential pages",
                          standard: "Balances management, technical, and quality information",
                          strict: "Emphasizes evidence, change control, handover, and traceability"
                        };
                    return (
                      <label key={value} className={level === value ? styles["selected"] : ""}>
                        <input
                          type="radio"
                          name="setup-level"
                          checked={level === value}
                          onChange={() => applyRecommendation(value)}
                        />
                        <span>
                          <strong>{names[value]}</strong>
                          <small>{reasons[value]}</small>
                          <small>
                            {ja
                              ? `Folder ${preview.folders}件 / Page ${preview.pages}件`
                              : `${preview.folders} folders / ${preview.pages} pages`}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
                <h2>{ja ? "生成する階層" : "Hierarchy to create"}</h2>
                <SetupTree
                  index={index}
                  nodes={finalTree}
                  selection={selection}
                  expanded={expanded}
                  language={language}
                  readOnly
                  label={ja ? "生成する階層" : "Hierarchy to create"}
                  onToggleExpanded={toggleExpanded}
                />
              </>
            )}

            {mode === "templates" && (
              <>
                <p>
                  {ja
                    ? "初期選択はありません。必要なFolderとPageを選んでください。Folderを選ぶと配下がまとめて選択されます。"
                    : "Nothing is selected yet. Pick the folders and pages you need; selecting a folder selects everything under it."}
                </p>
                <div className={styles["setup-filters"]}>
                  <label>
                    <span>{ja ? "検索" : "Search"}</span>
                    <input
                      type="search"
                      value={filterQuery}
                      onChange={(event) => setFilterQuery(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{ja ? "情報領域" : "Information area"}</span>
                    <select value={filterArea} onChange={(event) => setFilterArea(event.target.value)}>
                      <option value="">{ja ? "すべて" : "All"}</option>
                      {index.catalog.areas.map((area) => (
                        <option key={area.id} value={area.id}>{area.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{ja ? "参考体系" : "Reference"}</span>
                    <select
                      value={filterReference}
                      onChange={(event) => setFilterReference(event.target.value)}
                    >
                      <option value="">{ja ? "すべて" : "All"}</option>
                      {index.catalog.referenceModels.map((id) => (
                        <option key={id} value={id}>{referenceLabel(id)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p role="status">
                  {ja
                    ? `選択中: Folder ${finalCounts.folders}件 / Page ${finalCounts.pages}件`
                    : `Selected: ${finalCounts.folders} folders / ${finalCounts.pages} pages`}
                </p>
                <SetupTree
                  index={index}
                  nodes={catalogTree}
                  selection={selection}
                  expanded={expanded}
                  language={language}
                  label={ja ? "組み込みカタログ" : "Built-in catalog"}
                  onToggleExpanded={toggleExpanded}
                  onToggleSelected={toggleSelected}
                />
              </>
            )}

            {mode === "empty" && (
              <p>
                {ja
                  ? "標準のFolderとPageを作成しません。vellym.config.yamlとrepository rootだけを作成し、その後は通常の構造編集で自由に構成できます。"
                  : "No standard folders or pages are created. Only vellym.config.yaml and the repository root are written; you build the structure afterwards with the normal editing tools."}
              </p>
            )}

            <div className={styles["setup-actions"]}>
              <Button onClick={() => setStep(1)}>{copy.back}</Button>
              <Button tone="primary"
                onClick={() => {
                  setPlan(undefined);
                  setReviewScope(resolved ? selectionIds(resolved) : new Set());
                  if (resolved) revealFolders(resolved.folderIds);
                  setStep(3);
                }}
              >
                {copy.next}
              </Button>
            </div>
          </>
        )}

        {step === 3 && index && (
          <>
            <h1 id="setup-title">{ja ? "生成内容の確認" : "Review generated content"}</h1>
            <p>
              {mode === "empty"
                ? ja ? "標準FolderとPageを作成しません。" : "No standard Folders or Pages will be created."
                : ja
                  ? "生成する階層だけを表示しています。名前を確認し、不要なものは解除してください。"
                  : "Only the hierarchy to be created is shown. Review the names and clear anything you do not need."}
            </p>
            <div className={styles["setup-tree-toolbar"]}>
              <p role="status" className={styles["setup-tree-count"]}>
                {busy
                  ? ja ? "生成計画を確認中…" : "Checking the plan…"
                  : ja
                    ? `Folder ${finalCounts.folders}件 / Page ${finalCounts.pages}件を作成します`
                    : `Creating ${finalCounts.folders} folders and ${finalCounts.pages} pages`}
              </p>
              <div className={styles["setup-tree-toolbar-actions"]}>
                <Button onClick={() => revealFolders(reviewFolderIds)}>
                  {ja ? "すべて展開" : "Expand all"}
                </Button>
                <Button onClick={() => setExpanded(new Set())}>
                  {ja ? "すべて折りたたむ" : "Collapse all"}
                </Button>
              </div>
            </div>
            {omittedIds.size > 0 && (
              <p className={styles["setup-tree-hint"]}>
                {ja
                  ? "チェックを外した項目は「作成しません」と表示したまま残ります。再度チェックすると生成対象へ戻ります。"
                  : "Cleared items stay in the list marked \"Not created\". Check one again to bring it back."}
              </p>
            )}
            <div className={styles["setup-structure"]}>
              <SetupTree
                index={index}
                nodes={reviewTree}
                selection={selection}
                expanded={expanded}
                language={language}
                label={ja ? "生成内容" : "Content to create"}
                reasons={plan?.recommendationReasons}
                omittedIds={omittedIds}
                onToggleExpanded={toggleExpanded}
                onToggleSelected={toggleSelected}
                renderDetail={detailFor}
              />
            </div>
            <div className={styles["setup-actions"]}>
              <Button disabled={busy} onClick={() => setStep(2)}>{copy.back}</Button>
              <Button tone="primary"
                disabled={busy || !plan || plan.files.some((file) => file.status === "conflict")}
                onClick={() => void apply()}
              >
                {busy ? copy.creating : copy.create}
              </Button>
            </div>
          </>
        )}

        {step === 4 && result && (
          <>
            <h1 id="setup-title">
              {adding
                ? ja ? "構成を追加しました" : "Project content added"
                : ja ? "初期構成を生成しました" : "Project structure created"}
            </h1>
            <p role="status">
              {ja
                ? `Folder ${result.created.filter((file) => file.kind === "folder").length}件、Page ${result.created.filter((file) => file.kind === "page").length}件を作成しました。`
                : `Created ${result.created.filter((file) => file.kind === "folder").length} folders and ${result.created.filter((file) => file.kind === "page").length} pages.`}
            </p>
            <div className={styles["setup-actions"]}>
              <Button tone="primary" onClick={props.onComplete}>
                {adding
                  ? ja ? "設定へ戻る" : "Back to settings"
                  : ja ? "プロジェクトを開く" : "Open project"}
              </Button>
            </div>
          </>
        )}

        {message && (
          <div className={styles["setup-error"]} role="alert"><strong>■ Error</strong><p>{message}</p></div>
        )}
      </section>
    </div>
  );
}
