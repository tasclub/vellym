import { useEffect, useMemo, useRef, useState } from "react";
import type { DropPosition } from "react-aria-components";
import type {
  Diagnostic,
  DocumentNavigationFolder,
  DocumentNavigationNode,
  FolderSummary,
  PageSummary,
  PageView,
  RichTextBlock
} from "@vellym-internal/core";
import {
  assessPageEditing,
  buildDocumentNavigation,
  extractDocumentHeadings
} from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  fetchBootstrap,
  fetchPage,
  fetchPluginView,
  runPluginCommand,
  fetchPageEdit,
  fetchPages,
  patchPage,
  applyStructure,
  previewStructure,
  undoStructure,
  type BootstrapData,
  type StructureApplyResult,
  type StructureUndoPlan,
  type StructurePlan
} from "../shared/api.js";
import { AdminView } from "./admin-view.js";
import { EditorWorkspace } from "../editor/editor-workspace.js";
import { resolveLocalizedText } from "@vellym/plugin-api";
import { DocumentView } from "../editor/view.js";
import {
  PluginDetailPanel,
  PluginListPage,
  PluginParentLink
} from "../plugin/plugin-area.js";
import type {
  PluginBulkChange,
  PluginViewPayload
} from "../plugin/plugin-list-view.js";
import type { PluginSpecValue } from "../shared/field-input.js";
import type { PluginInputValue } from "@vellym/plugin-api";
import { FolderView } from "../editor/folder-view.js";
import {
  draftCopyText,
  sameDraft,
  type SaveState
} from "../editor/save-state.js";
import { useRepositoryWatch } from "./use-repository-watch.js";
import { SetupWizard } from "../setup/setup-wizard.js";
import type { StructureAction } from "../editor/structure-dialog.js";
import { AppOverlays } from "./app-overlays.js";
import { WorkspaceShell } from "./workspace-shell.js";
import { setUiLanguage } from "../shared/i18n.js";
import { errorMessage } from "../shared/error-message.js";
import { LanguageSwitcher } from "./language-switcher.js";
import { PageLanguagePanel } from "../editor/page-language-panel.js";
import {
  createPageEditSession,
  pageEditExport,
  pageEditPatch,
  pageEditSessionDirty,
  type PageEditSession
} from "../editor/page-edit-session.js";
import { planTreeMove } from "./tree-move.js";
import { KindIconProvider } from "../shared/kind-icon.js";
import { usePluginRenderers } from "../plugin/plugin-renderers.js";
import { createRenderContext } from "../plugin/render-context.js";
// 設定を読み込めない画面は初期セットアップと同じ体裁で出す
import setupStyles from "../setup/setup.module.css";
import {
  documentPagePath,
  resolveDocumentLocation,
  staticAppBasePath
} from "./routing.js";

function currentDocumentLocation() {
  return resolveDocumentLocation({
    pathname: window.location.pathname,
    hash: window.location.hash,
    basePath: staticAppBasePath(),
    defaultLocale: window.__VELLYM_STATIC__?.defaultLocale
  });
}

type PendingLeave =
  | { kind: "navigate"; page: string; heading?: string }
  | { kind: "folder"; folderPath: string }
  | { kind: "settings" }
  | { kind: "cancel" }
  | { kind: "reload" };

function parentPath(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  parts.pop();
  return parts.join("/");
}

function basename(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath;
}

/**
 * 選んだ資源へ同じ値をまとめて書く。**1件ずつ通常の保存経路を通す。**
 *
 * まとめて書く専用の経路を作らない。非破壊往復、realpath境界、hash競合検出が
 * そのまま効く。競合したものだけが失敗し、残りは保存される。
 *
 * 失敗した名前を返す。全体を取り消さない。ファイルを正本とする以上、
 * 部分的に進んだ状態は異常ではなく、そのまま見せて直せるようにする。
 */
async function applyBulkChange(change: PluginBulkChange): Promise<string[]> {
  const failed: string[] = [];
  for (const name of change.names) {
    try {
      // 最新のhashを取ってから書く。一覧の索引行はhashを持たない。
      const edit = await fetchPageEdit(name);
      await patchPage(name, {
        baseHash: edit.data.hash,
        specValues: [{ path: [...change.path], value: change.value }]
      });
    } catch {
      failed.push(name);
    }
  }
  return failed;
}

/** 選んだ資源を`_archive/`へ移す。削除はしない。こちらも1件ずつ行う */
async function applyBulkArchive(names: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const pageId of names) {
    try {
      const plan = await previewStructure({ type: "archive-page", pageId });
      await applyStructure(plan.data);
    } catch {
      failed.push(pageId);
    }
  }
  return failed;
}

export function App() {
  const { t } = useTranslation();
  const [bootstrap, setBootstrap] = useState<BootstrapData>();
  const [bootstrapDiagnostics, setBootstrapDiagnostics] = useState<Diagnostic[]>([]);
  const [bootstrapError, setBootstrapError] = useState("");
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [selected, setSelected] = useState<string>();
  const [selectedFolder, setSelectedFolder] = useState<string>();
  const [area, setArea] = useState<"documents" | "settings">("documents");
  const [view, setView] = useState<PageView>();
  // プラグインが登録したビュー。開いたリソースのkindに対応するものがあれば、
  // 本文の代わりにこれを描く。無ければ通常の文書表示のままにする。
  const [pluginView, setPluginView] = useState<PluginViewPayload>();
  // 「完了を含める」は個人設定であり、正本にも絞り込み条件にも書き戻さない。
  const [showAllRows, setShowAllRows] = useState(false);
  // 次に開くリソースと、そこで開くビュー。対象が一致したときだけ使い、
  // 一度使ったら既定へ戻す。作成直後に設定画面を開くために使う。
  const pendingViewRef = useRef<{ name: string; viewId: string } | undefined>(undefined);
  /**
   * 読み込みの通し番号。**古い応答で新しい表示を上書きしない。**
   *
   * ビューの切替は「切替先を控えてから読み直す」ため、直前に走っていた読み込みが
   * あとから返ると、切替前のビュー（一覧）で上書きされ、設定画面へ入った直後に
   * 戻される。
   */
  const loadSeqRef = useRef(0);
  /**
   * プラグインが宣言した項目の編集中の値。タイトル・本文と一緒に1回で保存する。
   *
   * **stateで持つ。** refに置くと未保存判定から見えなくなり、保存状態の
   * 巻き戻しと往復して更新が止まらなくなる。
   */
  const [specChanges, setSpecChanges] = useState<
    Array<{ path: string[]; value: PluginSpecValue }>
  >([]);
  /** 作成した直後は編集画面へ入る。作ってから開き直させない */
  const pendingEditRef = useRef<string | undefined>(undefined);
  // ツリーから起こしたプラグインのコマンド。入力を尋ねてから実行する。
  const [pluginCommand, setPluginCommand] = useState<{
    commandId: string;
    parentPath: string;
  }>();
  const [editSession, setEditSession] = useState<PageEditSession>();
  const [requestedLocale, setRequestedLocale] = useState<string | undefined>(
    () => currentDocumentLocation().locale
  );
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [blocks, setBlocks] = useState<RichTextBlock[]>([]);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState<number>();
  const [copyMessage, setCopyMessage] = useState("");
  const [conflictView, setConflictView] = useState<PageView>();
  const [pendingLeave, setPendingLeave] = useState<PendingLeave>();
  /**
   * プラグインのブラウザ側エントリ。読み込みに失敗しても**SPAは起動したまま**
   * にする。宣言で描ける画面はそのまま出る。
   */
  const pluginRenderers = usePluginRenderers(
    bootstrap?.plugins?.browserEntries,
    bootstrap?.plugins?.hostVersion ?? ""
  );
  // 空状態のCTAから最初のPageを作るためのダイアログ制御。
  const [createAction, setCreateAction] = useState<StructureAction>();
  const [structureUndo, setStructureUndo] = useState<{
    plan: StructureUndoPlan;
    message: string;
    folderMove?: { from: string; to: string };
  }>();
  const [pendingLocation, setPendingLocation] = useState<{
    page: string;
    heading?: string;
  } | undefined>(() => {
    const location = currentDocumentLocation();
    return location.page
      ? { page: location.page, heading: location.heading }
      : undefined;
  });
  const draftRef = useRef({ title, slug, blocks });
  const viewRef = useRef(view);
  draftRef.current = { title, slug, blocks };
  viewRef.current = view;
  const legacyUnsavedChanges = Boolean(
    view &&
    (title !== view.page.metadata.title ||
      slug !== (view.page.metadata.slug ?? view.page.metadata.name) ||
      blocks.length !== view.knownBlocks.length ||
      blocks.some((block, index) => {
        const original = view.knownBlocks[index];
        return !original ||
          block.id !== original.id ||
          block.content !== original.content;
      }))
  );
  const hasUnsavedChanges =
    // プラグインの項目もページの未保存に含める。ここから漏れると、
    // 保存状態が「未保存」と「保存済み」の間で往復する。
    specChanges.length > 0 ||
    (editSession ? pageEditSessionDirty(editSession) : legacyUnsavedChanges);

  async function loadBootstrap(signal?: AbortSignal) {
    try {
      const routeLocale = currentDocumentLocation().locale;
      const result = await fetchBootstrap(signal, routeLocale);
      setBootstrap(result.data);
      setRequestedLocale(result.data.project.requestedLocale);
      setBootstrapDiagnostics(result.diagnostics);
      setBootstrapError("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setBootstrapError(errorMessage(error, t));
    }
  }

  async function loadList(signal?: AbortSignal) {
    try {
      const locale = requestedLocale ?? bootstrap?.project.requestedLocale;
      const result = await fetchPages(signal, locale);
      setPages(result.data.pages);
      setFolders(result.data.folders);
      setDiagnostics(result.diagnostics);
      const location = currentDocumentLocation();
      const requestedPage = result.data.pages.find(
        (page) => page.slug === location.page || page.name === location.page
      );
      const welcomePage = result.data.pages.find((page) => page.name === "welcome");
      const initialPage = requestedPage ?? welcomePage ?? result.data.pages[0];
      const initial = requestedPage?.name ?? location.page ?? initialPage?.name;
      if (!location.page && !selected && initialPage) {
        window.history.replaceState(
          null,
          "",
          documentPagePath(
            locale ?? result.data.defaultLocale,
            initialPage.slug ?? initialPage.name
          )
        );
      }
      if (initial && location.page) {
        setPendingLocation({ page: initial, heading: location.heading });
      }
      setSelected((current) => {
        if (current) return current;
        return initial;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(errorMessage(error, t));
    }
  }

  function applyView(next: PageView) {
    setView(next);
    setSelected(next.page.metadata.name);
    setTitle(next.page.metadata.title);
    setSlug(next.page.metadata.slug ?? next.page.metadata.name);
    setBlocks(next.knownBlocks.map((block) => ({ ...block })));
    setSaveState("saved");
    setExternalChange(false);
    setMessage("");
    setSaveError("");
    setCopyMessage("");
    setConflictView(undefined);
    setEditing(false);
    setEditSession(undefined);
    setSpecChanges([]);
  }

  async function loadPage(name: string, discard = false, signal?: AbortSignal) {
    if (hasUnsavedChanges && !discard) {
      setExternalChange(true);
      return;
    }
    const seq = ++loadSeqRef.current;
    try {
      const next = (await fetchPage(
        name,
        signal,
        requestedLocale ?? bootstrap?.project.requestedLocale ?? "ja"
      )).data;
      // プラグインのビューは内容が同じでも切り替わりうる（一覧と設定など）。
      // 同一内容の早期returnより先に解決する。
      // 同じリソースを続けて読み込むことがあるため、使っても消さない。
      // 別のリソースへ移ったときに捨てる。
      if (pendingViewRef.current && pendingViewRef.current.name !== name) {
        pendingViewRef.current = undefined;
      }
      const pending = pendingViewRef.current?.viewId;
      const nextPluginView = await fetchPluginView(
        name,
        signal,
        requestedLocale ?? bootstrap?.project.requestedLocale ?? "ja",
        pending
      );
      // 自分より新しい読み込みが始まっていれば、この応答は捨てる。
      if (seq !== loadSeqRef.current) return;
      setPluginView(nextPluginView);
      if (
        viewRef.current?.hash === next.hash &&
        viewRef.current.relativePath === next.relativePath
      ) {
        setExternalChange(false);
        return;
      }
      applyView(next);
      // 作った直後はそのまま編集画面へ入る。作ってから開き直させない。
      if (pendingEditRef.current === name) {
        pendingEditRef.current = undefined;
        // `view`の状態はまだ前のページを指している。開いたばかりの名前を渡す。
        await startMultilingualEdit(name);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(errorMessage(error, t));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const route = currentDocumentLocation();
    if (!route.legacy && route.locale && route.page) {
      const canonical = documentPagePath(route.locale, route.page, route.heading);
      if (`${window.location.pathname}${window.location.hash}` !== canonical) {
        window.history.replaceState(null, "", canonical);
      }
    }
    void loadBootstrap(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (bootstrap?.state !== "ready") return;
    const controller = new AbortController();
    void loadList(controller.signal);
    return () => controller.abort();
  }, [bootstrap?.state, requestedLocale]);

  useEffect(() => {
    if (bootstrap?.state === "ready") setUiLanguage(bootstrap.project.language);
  }, [bootstrap?.state === "ready" ? bootstrap.project.language : undefined]);

  useEffect(() => {
    if (bootstrap?.state !== "ready") return;
    if (!selected) return;
    const controller = new AbortController();
    void loadPage(selected, true, controller.signal);
    return () => controller.abort();
  }, [selected, requestedLocale]);

  useEffect(() => {
    function restoreLocation() {
      const location = currentDocumentLocation();
      const nextLocale = location.locale ?? bootstrap?.project.defaultLocale;
      const targetPage = pages.find(
        (page) => page.slug === location.page || page.name === location.page
      );
      if (!location.page) return;
      const targetName = targetPage?.name ?? location.page;
      if (
        hasUnsavedChanges &&
        selected &&
        (targetName !== selected || nextLocale !== requestedLocale)
      ) {
        const currentSlug =
          pages.find((page) => page.name === selected)?.slug ?? selected;
        window.history.replaceState(
          null,
          "",
          documentPagePath(
            requestedLocale ?? bootstrap?.project.defaultLocale ?? "ja",
            currentSlug
          )
        );
        setPendingLeave({
          kind: "navigate",
          page: targetName,
          heading: location.heading
        });
        return;
      }
      if (nextLocale && nextLocale !== requestedLocale) {
        setRequestedLocale(nextLocale);
      }
      setPendingLocation({ page: targetName, heading: location.heading });
      setSelected(targetName);
    }
    // 本文中の見出しアンカー（`[..](#heading)`）はクリック時にlocation.hashを
    // 書き換えるだけで、履歴操作のpopstateは発火しない。hashchangeも購読して、
    // ハッシュリンクで遷移できるようにする。
    window.addEventListener("popstate", restoreLocation);
    window.addEventListener("hashchange", restoreLocation);
    return () => {
      window.removeEventListener("popstate", restoreLocation);
      window.removeEventListener("hashchange", restoreLocation);
    };
  }, [
    bootstrap?.project.defaultLocale,
    hasUnsavedChanges,
    pages,
    requestedLocale,
    selected
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function protectBrowserLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protectBrowserLeave);
    return () => window.removeEventListener("beforeunload", protectBrowserLeave);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!editing) return;
    if (!hasUnsavedChanges && saveState === "dirty") {
      setSaveState("saved");
    } else if (
      hasUnsavedChanges &&
      (saveState === "saved" || saveState === "success")
    ) {
      setSaveState("dirty");
    }
  }, [editing, hasUnsavedChanges, saveState]);

  useEffect(() => {
    if (saveState !== "success") return;
    const timer = window.setTimeout(() => setSaveState("saved"), 5000);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  const {
    connection: watchConnection,
    message: watchMessage,
    externalChange,
    setExternalChange
  } = useRepositoryWatch({
    live: bootstrap?.state === "ready" && Boolean(bootstrap.capabilities.live),
    onConfigChange: () => void loadBootstrap(),
    onChange: () => {
      void loadList();
      if (!selected) return;
      if (hasUnsavedChanges) {
        setExternalChange(true);
      } else {
        void loadPage(selected, true);
      }
    },
    reconnectedMessage: t("app.watchReconnected")
  });

  useEffect(() => {
    if (!structureUndo) return;
    const timer = window.setTimeout(() => setStructureUndo(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [structureUndo]);

  const draft = useMemo<PageView | undefined>(() => {
    if (!view) return undefined;
    return {
      ...view,
      page: {
        ...view.page,
        metadata: { ...view.page.metadata, title, slug }
      },
      knownBlocks: blocks
    };
  }, [view, title, slug, blocks]);
  /**
   * 必須なのに空の項目。**画面からの保存だけを止める判断に使う。**
   *
   * 子からの通知ではなく、開いている宣言と現在値から数える。通知に頼ると、
   * 一度も入力せずに保存したときに空を見落とす。
   */
  /*
   * **早期returnより前に置く。** `app.tsx`は`bootstrap`が未取得のとき、
   * セットアップのとき、設定が読めないときに早くreturnする。その後ろへ
   * hookを置くと、描画のたびに呼ばれるhookの数が変わってReactが壊れる
   * （error #310）。実際にそれを踏んだ。
   */
  /**
   * rendererへ渡す文脈。**保存はCoreの経路を通す。**
   *
   * 保存後は読み直す。`applyView`が保存状態とメッセージを消すため、
   * 結果の表示は読み直しのあとで行う。
   */
  const pluginRenderContext = useMemo(() => {
    if (!pluginView || !view) return undefined;
    return createRenderContext({
      payload: pluginView,
      locale: view.locale ?? view.baseLocale ?? "ja",
      targetName: view.page.metadata.name,
      targetTitle: view.page.metadata.title,
      targetPath: view.relativePath,
      onSaved: async () => {
        await loadPage(view.page.metadata.name, true);
        setSavedAt(Date.now());
        setSaveState("success");
      },
      describeError: (error) => errorMessage(error, t)
    });
    // 読み直しの関数は毎回作り直されるため、依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginView, view, t]);

  const missingRequired = useMemo(() => {
    const descriptor = pluginView?.descriptor;
    if (!descriptor || descriptor.type !== "detail") return [];
    const pending = new Map(
      specChanges.map((change) => [change.path.join("\u0000"), change.value])
    );
    const empty = (value: unknown) =>
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    return descriptor.fields
      .filter((field) => field.required === true)
      .filter((field) => {
        const key = field.path.join("\u0000");
        const valueKey =
          "valueKey" in field && field.valueKey ? field.valueKey : field.id;
        return empty(
          pending.has(key) ? pending.get(key) : pluginView?.target?.values[valueKey]
        );
      })
      .map((field) => field.id);
  }, [pluginView, specChanges]);

  /**
   * プラグインが宣言した詳細を編集できるか。
   *
   * 本文ブロックの有無で決めない。チケットは属性とタイトルが本体であり、
   * 本文はその下に付くものである。定義そのものの編集（`body: "none"`）は
   * 自分の画面で保存するため、ここには含めない。
   */
  const pluginDetailEditable =
    pluginView?.descriptor.type === "detail" && pluginView.descriptor.body !== "none";
  const editAssessment = useMemo(
    () =>
      view
        ? assessPageEditing(editing && draft ? draft : view)
        : { supported: false, reasons: [], blocks: [] },
    [draft, editing, view]
  );
  const navigation = useMemo(
    () => buildDocumentNavigation(pages, new Map(), folders),
    [folders, pages]
  );
  const headings = useMemo(
    () => extractDocumentHeadings((editing ? draft : view)?.knownBlocks ?? []),
    [draft?.knownBlocks, editing, view?.knownBlocks]
  );
  const selectedFolderNode = useMemo(() => {
    const visit = (
      nodes: DocumentNavigationNode[]
    ): DocumentNavigationFolder | undefined => {
      for (const node of nodes) {
        if (node.kind !== "folder") continue;
        if (node.path === selectedFolder) return node;
        const nested = visit(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    if (selectedFolder === "") {
      return {
        kind: "folder" as const,
        name: "",
        title: t("nav.allDocuments"),
        path: "",
        children: navigation.tree
      };
    }
    return selectedFolder !== undefined ? visit(navigation.tree) : undefined;
  }, [navigation.tree, selectedFolder]);

  useEffect(() => {
    document.title =
      area === "settings"
        ? t("app.titleSettings")
        : selectedFolderNode
          ? `${selectedFolderNode.title} — Vellym`
          : view
            ? `${view.page.metadata.title} — Vellym`
            : "Vellym";
  }, [area, selectedFolderNode, view]);

  useEffect(() => {
    document.documentElement.lang = bootstrap?.project.uiLocale ?? "ja";
    document.documentElement.dir = "ltr";
  }, [bootstrap?.project.uiLocale]);

  useEffect(() => {
    if (!view || pendingLocation?.page !== view.page.metadata.name) return;
    const headingId = pendingLocation.heading;
    setPendingLocation(undefined);
    if (!headingId) {
      const content = document.getElementById("document-content");
      // 前後ナビゲーションで前ページのスクロール位置を引き継がず、新しい文書の
      // 先頭に着地するようスクロール位置をリセットする。
      content?.scrollTo({ top: 0 });
      content?.focus();
      return;
    }
    window.requestAnimationFrame(() => {
      const target = document.getElementById(headingId);
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
  }, [view, pendingLocation]);

  function commitNavigation(name: string, heading?: string) {
    const route = pages.find((page) => page.name === name)?.slug ?? name;
    window.history.pushState(
      null,
      "",
      documentPagePath(
        requestedLocale ?? bootstrap?.project.defaultLocale ?? "ja",
        route,
        heading
      )
    );
    setPendingLocation({ page: name, heading });
    setSelected(name);
    setSelectedFolder(undefined);
    setArea("documents");
  }

  function navigate(name: string, heading?: string) {
    if (hasUnsavedChanges && selected !== name) {
      setPendingLeave({ kind: "navigate", page: name, heading });
      return;
    }
    commitNavigation(name, heading);
  }

  function acceptStructureResult(
    plan: StructurePlan,
    result: StructureApplyResult
  ) {
    setPages(result.pages);
    setFolders(result.folders);
    const folderMove =
      plan.input.type === "move-folder"
        ? {
            from: plan.input.folderPath,
            to: [plan.input.destinationPath, basename(plan.input.folderPath)]
              .filter(Boolean)
              .join("/")
          }
        : undefined;
    if (folderMove) {
      setSelectedFolder((current) => {
        if (
          current === undefined ||
          (current !== folderMove.from &&
            !current.startsWith(`${folderMove.from}/`))
        ) {
          return current;
        }
        return `${folderMove.to}${current.slice(folderMove.from.length)}`;
      });
    }
    if (result.undoPlan) {
      setStructureUndo({
        plan: result.undoPlan,
        message:
          plan.input.type === "reorder"
            ? t("app.reorderApplied")
            : t("app.moveApplied"),
        folderMove
      });
    }
    const created =
      plan.input.type === "create-page" ? plan.input.pageId : undefined;
    if (created) {
      commitNavigation(created);
      return;
    }
    if (selected && result.pages.some((page) => page.name === selected)) {
      void loadPage(selected, true);
      return;
    }
    const fallback = result.pages[0]?.name;
    if (fallback) {
      window.history.replaceState(
        null,
        "",
        documentPagePath(
          requestedLocale ?? bootstrap?.project.defaultLocale ?? "ja",
          result.pages.find((page) => page.name === fallback)?.slug ?? fallback
        )
      );
      setPendingLocation({ page: fallback });
      setSelected(fallback);
    } else {
      setSelected(undefined);
      setView(undefined);
    }
  }

  async function moveTreeItem(
    sourceKey: string,
    targetKey: string,
    position: DropPosition
  ) {
    const input = planTreeMove({
      sourceKey,
      targetKey,
      position,
      pages,
      folders,
      navigation
    });
    if (!input) return;
    try {
      const plan = (await previewStructure(input)).data;
      if (!plan.executable) {
        setMessage(plan.conflict ?? t("app.structureChangeFailed"));
        return;
      }
      const result = (await applyStructure(plan)).data;
      acceptStructureResult(plan, result);
      setMessage(t("app.structureSaved"));
    } catch (error) {
      setMessage(errorMessage(error, t));
    }
  }

  function leaveTo(action: PendingLeave) {
    if (!view) return;
    if (action.kind === "navigate") {
      commitNavigation(action.page, action.heading);
    } else if (action.kind === "folder") {
      setSelectedFolder(action.folderPath);
      setArea("documents");
    } else if (action.kind === "settings") {
      setSelectedFolder(undefined);
      setArea("settings");
    } else if (action.kind === "reload") {
      void loadPage(view.page.metadata.name, true);
    }
  }

  function discardAndLeave() {
    const action = pendingLeave;
    setPendingLeave(undefined);
    if (!action || !view) return;
    applyView(view);
    leaveTo(action);
  }

  // 未保存離脱ダイアログの「保存して移動」。保存に成功したときだけ移動し、
  // 失敗（競合・エラー）ならとどまってダイアログを閉じない。
  async function saveAndLeave() {
    const action = pendingLeave;
    if (!action) return;
    const saved = await save();
    if (!saved) return;
    setPendingLeave(undefined);
    leaveTo(action);
  }

  function markDirty() {
    setSaveState("dirty");
    setSaveError("");
    setCopyMessage("");
  }

  /**
   * 編集を始める。
   *
   * 対象を引数で受け取れるようにしてある。読み込み直後に呼ぶ場合、`view`の状態は
   * まだこの関数が閉じ込めた**前の**ページを指しており、そのまま使うと
   * 「別のページの編集セッション」と「開いたページのプラグイン画面」が
   * 混ざる。作った直後に編集へ入る経路がこれを踏んだ。
   */
  async function startMultilingualEdit(target?: string) {
    const pageId = target ?? view?.page.metadata.name;
    if (!pageId) return;
    setSaveError("");
    try {
      const edit = (await fetchPageEdit(pageId)).data;
      if (edit.readOnly) {
        setSaveError(edit.readOnlyReasons.join("、"));
        return;
      }
      const session = createPageEditSession(edit, activeLocale);
      const active = session.locales.find(
        ({ locale }) => locale === session.activeLocale
      )!;
      setEditSession(session);
      setTitle(active.title);
      setSlug(session.slug);
      setBlocks(active.blocks.map((block) => ({ ...block })));
      setEditing(true);
      setSaveState("saved");
    } catch (error) {
      setSaveError(errorMessage(error, t));
    }
  }

  function updateActiveLocale(
    change: (draft: PageEditSession["locales"][number]) =>
      PageEditSession["locales"][number]
  ) {
    setEditSession((current) => current ? {
      ...current,
      locales: current.locales.map((draft) =>
        draft.locale === current.activeLocale ? change(draft) : draft
      )
    } : current);
    markDirty();
  }

  async function save(): Promise<boolean> {
    if (!view || view.readOnly) return false;
    // **画面から必須を空のまま登録・保存させない。** 止めるのはこの操作だけである。
    // 開くこと、編集画面に入ること、やめること、YAMLを直接直すことは妨げない。
    // `validate`と`build`も止めない（警告のまま）。
    if (editing && missingRequired.length) {
      setSaveState("dirty");
      setSaveError(t("plugin.requiredEmpty"));
      // どこが足りないかを探させない。最初の未入力へ連れて行く。
      document.getElementById(`plugin-field-${missingRequired[0]}`)?.focus();
      return false;
    }
    const specValues = specChanges;
    setSaveState("saving");
    setSaveError("");
    setCopyMessage("");
    setConflictView(undefined);
    if (editSession) {
      const submittedSession = editSession;
      try {
        await patchPage(editSession.pageId, {
          ...pageEditPatch(editSession),
          // プラグインが宣言した項目も同じ保存で書く。属性だけ別の保存にしない。
          ...(specValues.length ? { specValues } : {})
        });
        setSpecChanges([]);
        const locale = requestedLocale ?? bootstrap?.project.defaultLocale ?? editSession.baseLocale;
        const refreshed = (await fetchPage(editSession.pageId, undefined, locale)).data;
        applyView(refreshed);
        await loadList();
        const savedSlug = refreshed.page.metadata.slug ?? refreshed.page.metadata.name;
        window.history.replaceState(
          null,
          "",
          documentPagePath(locale, savedSlug, currentDocumentLocation().heading)
        );
        setSavedAt(Date.now());
        setSaveState("success");
        return true;
      } catch (error) {
        // submittedSessionは失敗時の全言語export対象としてeditSessionを保持するため、
        // ここでは破棄しない。
        void submittedSession;
        if (error instanceof ApiError && error.status === 409) {
          setSaveState("conflict");
          setExternalChange(true);
          setSaveError(error.message);
          return false;
        }
        setSaveState("failure");
        setSaveError(errorMessage(error, t));
        return false;
      }
    }
    const submitted = {
      title,
      slug,
      blocks: blocks.map((block) => ({ ...block }))
    };
    const originalById = new Map(
      view.knownBlocks.map((block) => [block.id, block.content])
    );
    try {
      const result = await patchPage(view.page.metadata.name, {
        baseHash: view.hash,
        ...(submitted.title === view.page.metadata.title
          ? {}
          : { title: submitted.title }),
        ...(submitted.slug === (view.page.metadata.slug ?? view.page.metadata.name)
          ? {}
          : { slug: submitted.slug }),
        richTextBlocks: submitted.blocks
          .filter((block) => originalById.get(block.id) !== block.content)
          .map(({ id, content }) => ({ id, content })),
        ...(specValues.length ? { specValues } : {})
      });
      setSpecChanges([]);
      const current = draftRef.current;
      setView(result.data);
      const savedSlug =
        result.data.page.metadata.slug ?? result.data.page.metadata.name;
      setPages((currentPages) =>
        currentPages.map((page) =>
          page.name === result.data.page.metadata.name
            ? {
                ...page,
                title: result.data.page.metadata.title,
                slug: savedSlug
              }
            : page
        )
      );
      const currentLocation = currentDocumentLocation();
      window.history.replaceState(
        null,
        "",
        documentPagePath(
          requestedLocale ?? bootstrap?.project.defaultLocale ?? "ja",
          savedSlug,
          currentLocation.heading
        )
      );
      setExternalChange(false);
      setMessage("");
      if (!sameDraft(submitted, current)) {
        setSaveState("dirty");
        return false;
      }
      setTitle(result.data.page.metadata.title);
      setSlug(result.data.page.metadata.slug ?? result.data.page.metadata.name);
      setBlocks(result.data.knownBlocks.map((block) => ({ ...block })));
      setEditing(false);
      setSavedAt(Date.now());
      setSaveState("success");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveState("conflict");
        setExternalChange(true);
        setSaveError(error.message);
        try {
          setConflictView(
            (await fetchPage(view.page.metadata.name)).data
          );
        } catch {
          setSaveError(
            t("app.saveErrorReloadNeeded", {
              message: error.message
            })
          );
        }
        return false;
      }
      setSaveState("failure");
      setSaveError(errorMessage(error, t));
      return false;
    }
  }

  /** 文書ツリーから起こしたプラグインのコマンドを、入力を受け取ってから実行する */
  async function runTreeCommand(input: Record<string, PluginInputValue>) {
    const target = pluginCommand;
    setPluginCommand(undefined);
    if (!target) return;
    try {
      const created = await runPluginCommand(target.commandId, {
        input: { ...input, folder: target.parentPath },
        locale: requestedLocale ?? bootstrap?.project.requestedLocale
      });
      await loadList();
      // 作った直後は設定画面を開く。ステータスも項目も空のままにしない。
      // どのビューを開くかはプラグインが決める（作成の応答で受け取る）。
      if (created.openView) {
        pendingViewRef.current = { name: created.name, viewId: created.openView };
      }
      navigate(created.name);
    } catch (error) {
      setMessage(errorMessage(error, t));
    }
  }

  /** 直前の構造変更を戻す。選んでいたフォルダも一緒に元の位置へ連れて帰る */
  function undoStructureChange() {
    const pending = structureUndo;
    if (!pending) return;
    setStructureUndo(undefined);
    void undoStructure(pending.plan)
      .then((response) => {
        setPages(response.data.pages);
        setFolders(response.data.folders);
        const move = pending.folderMove;
        if (move) {
          setSelectedFolder((current) => {
            if (
              current === undefined ||
              (current !== move.to && !current.startsWith(`${move.to}/`))
            ) {
              return current;
            }
            return `${move.from}${current.slice(move.to.length)}`;
          });
        }
        setMessage(t("app.structureUndone"));
      })
      .catch((error) => {
        setMessage(errorMessage(error, t));
      });
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(
        editSession ? pageEditExport(editSession) : draftCopyText(title, blocks)
      );
      setCopyMessage(t("app.draftCopied"));
    } catch {
      setCopyMessage("");
      setSaveError(
        t("app.copyFailed")
      );
    }
  }

  async function renamePageFile(fileName: string) {
    if (!view || hasUnsavedChanges) return;
    const plan = (await previewStructure({
      type: "rename-page-file",
      pageId: view.page.metadata.name,
      fileName
    })).data;
    if (!plan.executable) {
      throw new Error(plan.conflict ?? t("app.renameFailed"));
    }
    const result = (await applyStructure(plan)).data;
    acceptStructureResult(plan, result);
  }

  if (!bootstrap) {
    return (
      <main className="startup-state">
        <p role={bootstrapError ? "alert" : "status"}>
          {bootstrapError || "Vellymを読み込んでいます…"}
        </p>
        {bootstrapError && (
          <button type="button" onClick={() => void loadBootstrap()}>
            もう一度試す
          </button>
        )}
      </main>
    );
  }

  if (bootstrap.state === "setup") {
    return (
      <SetupWizard
        projectRoot={bootstrap.project.projectRoot}
        contentRoot={bootstrap.project.contentRoot}
        resolvedContentRoot={bootstrap.project.resolvedContentRoot}
        onComplete={() => void loadBootstrap()}
      />
    );
  }

  if (bootstrap.state === "config-error") {
    return (
      <main className="startup-state config-error">
        <div>
          <p className={setupStyles["setup-kicker"]}>設定を読み込めません</p>
          <h1>設定ファイルを確認してください</h1>
          <p>
            設定ファイルは存在するため、未初期化として上書きしません。
            内容を修正してから再読み込みしてください。
          </p>
          {bootstrapDiagnostics.map((item) => (
            <p className={setupStyles["setup-error"]} key={`${item.code}:${item.message}`}>
              <strong>■ {item.code}</strong><br />
              {item.message}
            </p>
          ))}
          <button type="button" onClick={() => void loadBootstrap()}>
            再読み込み
          </button>
        </div>
      </main>
    );
  }


  // 読み込みに失敗したプラグインは、名前と原因を1行で示す。
  const pluginRendererMessage = pluginRenderers.failures
    .map((failure) =>
      t("plugin.rendererUnavailable", {
        plugin: failure.pluginId,
        message: failure.message
      })
    )
    .join(" / ");

  const leaveDestination =
    pendingLeave?.kind === "navigate"
      ? pages.find((page) => page.name === pendingLeave.page)?.title
      : pendingLeave?.kind === "folder"
        ? folders.find((folder) => folder.path === pendingLeave.folderPath)?.title
        : pendingLeave?.kind === "settings"
          ? t("app.leaveSettings")
      : pendingLeave?.kind === "reload"
        ? t("app.leaveReload")
        : undefined;
  const activeDocument = view;
  const activeLocale =
    requestedLocale ?? bootstrap.project.requestedLocale;
  const activeSlug =
    view?.page.metadata.slug ??
    view?.page.metadata.name ??
    currentDocumentLocation().page ??
    selected;
  const languageSwitcher = activeDocument && activeSlug ? (
    <LanguageSwitcher
      page={activeDocument}
      currentLocale={activeLocale}
      uiLocale={bootstrap.project.uiLocale}
      slug={activeSlug}
      heading={currentDocumentLocation().heading}
    />
  ) : undefined;
  const editLanguageControls = editSession ? (
    <PageLanguagePanel
      session={editSession}
      uiLocale={bootstrap.project.uiLocale}
      disabled={saveState === "saving"}
      onChange={(next, draft) => {
        setEditSession(next);
        if (draft) {
          setTitle(draft.title);
          setBlocks(draft.blocks);
          if (draft.slug !== undefined) setSlug(draft.slug);
        }
        markDirty();
      }}
    />
  ) : undefined;

  return (
    // 種別ごとのアイコンはプラグインが渡したものだけを配る。
    // **hostが種別名から推測しない。**
    <KindIconProvider value={bootstrap.plugins?.kindIcons ?? {}}>
      <WorkspaceShell
        navigation={navigation}
        pages={pages}
        folders={folders}
        selected={selectedFolder !== undefined ? undefined : selected}
        selectedFolder={selectedFolder}
        area={area}
        diagnosticCount={diagnostics.length}
        headings={headings}
        structureAvailable={
          !hasUnsavedChanges && saveState !== "saving"
        }
        canSearch={bootstrap.capabilities.search}
        canManage={bootstrap.capabilities.structure}
        canConfigure={bootstrap.capabilities.structure}
        pluginCreateOptions={(bootstrap.plugins?.documentTreeCommands ?? []).map(
          (command) => ({
            id: command.id,
            label: resolveLocalizedText(command.title, bootstrap.project.uiLocale)
          })
        )}
        onRunTreeCommand={(commandId, parentPath) =>
          setPluginCommand({ commandId, parentPath })
        }
        uiLocale={bootstrap.project.uiLocale}
        currentLocale={activeLocale}
        onSelect={(name) => navigate(name)}
        onSelectFolder={(folderPath) => {
          if (hasUnsavedChanges) {
            setPendingLeave({ kind: "folder", folderPath });
            return;
          }
          setSelectedFolder(folderPath);
          setArea("documents");
        }}
        onAreaChange={(nextArea) => {
          if (hasUnsavedChanges && nextArea === "settings" && nextArea !== area) {
            setPendingLeave({ kind: "settings" });
            return;
          }
          setArea(nextArea);
          if (nextArea === "settings") setSelectedFolder(undefined);
        }}
        onNavigate={navigate}
        onHeadingSelect={(heading) => {
          if (selected) navigate(selected, heading);
        }}
        onMoveTreeItem={(sourceKey, targetKey, position) => {
          void moveTreeItem(sourceKey, targetKey, position);
        }}
        onStructureApplied={(
          plan: StructurePlan,
          result: StructureApplyResult
        ) => {
          acceptStructureResult(plan, result);
        }}
        onFolderApplied={(folder) => {
          setFolders((current) => current.map((item) =>
            item.path === folder.path ? { ...item, ...folder } : item
          ));
          void loadList();
        }}
      >
        {area === "settings" ? (
          <AdminView
            projectRoot={bootstrap.project.projectRoot}
            contentRoot={bootstrap.project.contentRoot}
            resolvedContentRoot={bootstrap.project.resolvedContentRoot}
            configPath={bootstrap.project.configPath}
            diagnostics={diagnostics}
            language={bootstrap.project.language}
            canManageStructure={bootstrap.capabilities.structure}
            onConfigApplied={() => {
              void loadBootstrap();
              void loadList();
            }}
          />
        ) : selectedFolder !== undefined || pages.length === 0 ? (
          <FolderView
            folder={selectedFolderNode}
            onSelectPage={navigate}
            onSelectFolder={setSelectedFolder}
            onCreatePage={
              bootstrap.capabilities.structure
                ? () =>
                    setCreateAction({
                      type: "create-page",
                      parentPath: selectedFolder ?? "",
                      chooseParent: true
                    })
                : undefined
            }
          />
        ) : !editing && pluginView && pluginView.descriptor.type === "list" && view ? (
          <PluginListPage
            notice={pluginRendererMessage}
            renderer={pluginRenderers.byViewId.get(pluginView.viewId)}
            {...(pluginRenderContext ? { renderContext: pluginRenderContext } : {})}
            payload={pluginView}
            view={view}
            uiLocale={bootstrap.project.uiLocale}
            showAll={showAllRows}
            onToggleShowAll={setShowAllRows}
            onNavigate={navigate}
            onSwitchView={async (viewId) => {
              pendingViewRef.current = { name: view.page.metadata.name, viewId };
              await loadPage(view.page.metadata.name, true);
            }}
            onRunCommand={async (commandId, input) => {
              try {
                const created = await runPluginCommand(commandId, {
                  target: view.page.metadata.name,
                  input,
                  locale: requestedLocale ?? bootstrap.project.requestedLocale
                });
                // 作成の行き先が指定されていなければ編集画面へ入る。
                // 定義の設定画面のように、行き先を宣言しているものは従う。
                if (!created.openView) pendingEditRef.current = created.name;
                navigate(created.name);
              } catch (error) {
                setMessage(errorMessage(error, t));
              }
            }}
            onBulkChange={async (change) => {
              const failed = await applyBulkChange(change);
              await loadPage(view.page.metadata.name, true);
              return failed;
            }}
            onBulkArchive={async (names) => {
              const failed = await applyBulkArchive(names);
              await loadPage(view.page.metadata.name, true);
              return failed;
            }}
          />
        ) : (
        <EditorWorkspace
          view={view}
          onNavigatePage={navigate}
          beforeBody={
            pluginView && view ? (
              <PluginDetailPanel
                payload={pluginView}
                view={view}
                editing={editing}
                renderer={pluginRenderers.byViewId.get(pluginView.viewId)}
                {...(pluginRenderContext ? { renderContext: pluginRenderContext } : {})}
                onChange={(changes) => {
                  setSpecChanges(changes);
                  // 元の値へ戻したときは未保存にしない。0件になったことは
                  // 未保存判定が拾い、保存状態はそちらで戻る。
                  if (changes.length) markDirty();
                }}
                onSave={async (changes) => {
                  try {
                    // 通常のPage保存経路を通す。非破壊往復も競合検出もそのまま効く。
                    await patchPage(view.page.metadata.name, {
                      baseHash: view.hash,
                      specValues: changes
                    });
                    await loadPage(view.page.metadata.name, true);
                    // **読み直したあとで結果を示す。** `applyView`が保存状態と
                    // メッセージを消すため、先に出すと読み直しで消える。
                    setSavedAt(Date.now());
                    setSaveState("success");
                  } catch (error) {
                    // 状態も併せて変える。`saveError`だけでは画面に出ない。
                    setSaveState("failure");
                    setSaveError(errorMessage(error, t));
                  }
                }}
              />
            ) : undefined
          }
          aboveSurface={
            pluginView ? (
              <PluginParentLink
                payload={pluginView}
                uiLocale={bootstrap.project.uiLocale}
                onBack={(name) => {
                  // 既定のビュー（一覧）へ戻す。
                  pendingViewRef.current = undefined;
                  if (name === selected) {
                    // **同じ資源のビューを変えるだけなので`navigate`では動かない。**
                    // 読み込みは`selected`の変化で起きるため、値が同じだと何も
                    // 起きない。設定と一覧は同じ`TicketTracker`の別のビューである。
                    void loadPage(name, true);
                    return;
                  }
                  navigate(name);
                }}
              />
            ) : undefined
          }
          draft={draft}
          conflictView={conflictView}
          title={title}
          slug={slug}
          blocks={blocks}
          pages={pages}
          editing={editing}
          canEdit={
            // 本文が無いだけで編集を塞がない。チケットは属性とタイトルが本体で
            // あり、本文はその下に付くものである。
            (editAssessment.supported || pluginDetailEditable) &&
            bootstrap.capabilities.editing
          }
          // プラグインの画面では、本文についてのCoreの理由を出さない。
          // 「編集できる本文ブロックがありません」は一覧や属性の画面では意味を持たない。
          editReasons={pluginView ? [] : editAssessment.reasons}
          blockAssessments={editAssessment.blocks}
          saveState={saveState}
          hasUnsavedChanges={hasUnsavedChanges}
          message={
            message ||
            // プラグインのブラウザ側が読み込めなかったことは黙って隠さない。
            // **他の機能は使える**ので、止めずに知らせるだけにする。
            pluginRendererMessage ||
            // 警告は「読み込めない」ではない。プラグインが出す注意で
            // 文書全体が壊れているかのように見せない。
            (diagnostics.some((item) => item.severity === "error")
              ? t("app.diagnosticsMessage")
              : "")
          }
          saveError={saveError}
          savedAt={savedAt}
          copyMessage={copyMessage}
          watchConnection={watchConnection}
          watchMessage={watchMessage}
          externalChange={externalChange}
          onStartEdit={() => {
            if (editAssessment.supported) void startMultilingualEdit();
          }}
          onCancel={() => {
            if (hasUnsavedChanges) {
              setPendingLeave({ kind: "cancel" });
            } else if (view) {
              applyView(view);
            }
          }}
          onTitleChange={(value) => {
            setTitle(value);
            updateActiveLocale((draft) => ({ ...draft, title: value }));
            markDirty();
          }}
          onSlugChange={(value) => {
            setSlug(value);
            setEditSession((current) => current ? { ...current, slug: value } : current);
            markDirty();
          }}
          onBlockChange={(index, content) => {
            const block = blocks[index];
            if (!block) return;
            const next = [...blocks];
            next[index] = { ...block, content };
            setBlocks(next);
            updateActiveLocale((draft) => ({
              ...draft,
              blocks: draft.blocks.map((item, itemIndex) =>
                itemIndex === index ? { ...item, content } : item
              )
            }));
            markDirty();
          }}
          onSave={() => void save()}
          onRetry={() => void save()}
          onCopy={() => void copyDraft()}
          onKeepDraft={() => {
            if (!conflictView) return;
            setView(conflictView);
            setConflictView(undefined);
            setExternalChange(false);
            setSaveState("dirty");
            setSaveError("");
            setCopyMessage(
              t("app.draftKept")
            );
          }}
          onReload={() => {
            if (!view) return;
            if (hasUnsavedChanges) {
              setPendingLeave({ kind: "reload" });
            } else {
              void loadPage(view.page.metadata.name, true);
            }
          }}
          onRenameFile={renamePageFile}
          languageSwitcher={languageSwitcher}
          editLanguageControls={editLanguageControls}
          editLocale={editSession?.activeLocale}
          localeDrafts={editSession?.locales
            .filter(({ removed }) => !removed)
            .map(({ locale, title, blocks }) => ({ locale, title, blocks }))}
          onLocaleTitleChange={(locale, value) => {
            setEditSession((current) => current ? {
              ...current,
              locales: current.locales.map((draft) =>
                draft.locale === locale ? { ...draft, title: value } : draft
              )
            } : current);
            if (editSession?.activeLocale === locale) setTitle(value);
            markDirty();
          }}
          onLocaleBlockChange={(locale, index, content) => {
            setEditSession((current) => current ? {
              ...current,
              locales: current.locales.map((draft) =>
                draft.locale === locale
                  ? {
                      ...draft,
                      blocks: draft.blocks.map((block, blockIndex) =>
                        blockIndex === index ? { ...block, content } : block
                      )
                    }
                  : draft
              )
            } : current);
            if (editSession?.activeLocale === locale) {
              setBlocks((current) => current.map((block, blockIndex) =>
                blockIndex === index ? { ...block, content } : block
              ));
            }
            markDirty();
          }}
        />
        )}
      </WorkspaceShell>
      <AppOverlays
        unsavedChanges={{
          isOpen: Boolean(pendingLeave),
          destination: leaveDestination,
          busy: saveState === "saving",
          onStay: () => setPendingLeave(undefined),
          onSaveAndLeave: () => void saveAndLeave(),
          onDiscard: discardAndLeave
        }}
        pluginCommand={{
          command: (bootstrap.plugins?.documentTreeCommands ?? []).find(
            (item) => item.id === pluginCommand?.commandId
          ),
          locale: bootstrap.project.uiLocale,
          onCancel: () => setPluginCommand(undefined),
          onSubmit: (input) => void runTreeCommand(input)
        }}
        structureAction={{
          action: createAction,
          pages,
          folders,
          onOpenChange: (open) => {
            if (!open) setCreateAction(undefined);
          },
          onApplied: (plan, result) => {
            acceptStructureResult(plan, result);
            setCreateAction(undefined);
          }
        }}
        undo={
          structureUndo
            ? { message: structureUndo.message, onUndo: undoStructureChange }
            : undefined
        }
      />
    </KindIconProvider>
  );
}
