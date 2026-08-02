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
  fetchPages,
  patchPage,
  applyStructure,
  previewStructure,
  undoStructure,
  type BootstrapData,
  type StructureApplyResult,
  type StructureInput,
  type StructureUndoPlan,
  type StructurePlan
} from "./api.js";
import { AdminView } from "./admin-view.js";
import { EditorWorkspace } from "./editor-workspace.js";
import { FolderView } from "./folder-view.js";
import {
  draftCopyText,
  parseRepositoryEvent,
  sameDraft,
  type SaveState,
  type WatchConnection
} from "./save-state.js";
import { SetupWizard } from "./setup-wizard.js";
import {
  StructureActionDialog,
  type StructureAction
} from "./structure-dialog.js";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog.js";
import { WorkspaceShell } from "./workspace-shell.js";
import { setUiLanguage } from "./i18n.js";

function locationFromHash(): { page?: string; heading?: string } {
  const values = new URLSearchParams(window.location.hash.slice(1));
  return {
    page: values.get("page") ?? undefined,
    heading: values.get("heading") ?? undefined
  };
}

type PendingLeave =
  | { kind: "navigate"; page: string; heading?: string }
  | { kind: "folder"; folderPath: string }
  | { kind: "settings" }
  | { kind: "cancel" }
  | { kind: "reload" };

function pageHash(page: string, heading?: string): string {
  return `#${new URLSearchParams({
    page,
    ...(heading ? { heading } : {})
  }).toString()}`;
}

function parentPath(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  parts.pop();
  return parts.join("/");
}

function basename(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath;
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
  const [watchConnection, setWatchConnection] = useState<WatchConnection>({
    state: "connecting"
  });
  const [watchMessage, setWatchMessage] = useState("");
  const [externalChange, setExternalChange] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave>();
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
    const location = locationFromHash();
    return location.page
      ? { page: location.page, heading: location.heading }
      : undefined;
  });
  const externalHandler = useRef<() => void>(() => {});
  const draftRef = useRef({ title, slug, blocks });
  const viewRef = useRef(view);
  draftRef.current = { title, slug, blocks };
  viewRef.current = view;
  const hasUnsavedChanges = Boolean(
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

  async function loadBootstrap(signal?: AbortSignal) {
    try {
      const result = await fetchBootstrap(signal);
      setBootstrap(result.data);
      setBootstrapDiagnostics(result.diagnostics);
      setBootstrapError("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setBootstrapError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadList(signal?: AbortSignal) {
    try {
      const result = await fetchPages(signal);
      setPages(result.data.pages);
      setFolders(result.data.folders);
      setDiagnostics(result.diagnostics);
      const location = locationFromHash();
      const requestedPage = result.data.pages.find(
        (page) => page.slug === location.page || page.name === location.page
      );
      const welcomePage = result.data.pages.find((page) => page.name === "welcome");
      const initialPage = requestedPage ?? welcomePage ?? result.data.pages[0];
      const initial = initialPage?.name;
      if (!requestedPage && !selected && initialPage) {
        const hash = new URLSearchParams({ page: initialPage.slug ?? initialPage.name });
        window.history.replaceState(null, "", `#${hash.toString()}`);
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
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function applyView(next: PageView) {
    setView(next);
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
  }

  async function loadPage(name: string, discard = false, signal?: AbortSignal) {
    if (hasUnsavedChanges && !discard) {
      setExternalChange(true);
      return;
    }
    try {
      const next = (await fetchPage(name, signal)).data;
      if (
        viewRef.current?.hash === next.hash &&
        viewRef.current.relativePath === next.relativePath
      ) {
        setExternalChange(false);
        return;
      }
      applyView(next);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadBootstrap(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (bootstrap?.state !== "ready") return;
    const controller = new AbortController();
    void loadList(controller.signal);
    return () => controller.abort();
  }, [bootstrap?.state]);

  useEffect(() => {
    if (bootstrap?.state === "ready") setUiLanguage(bootstrap.project.language);
  }, [bootstrap?.state === "ready" ? bootstrap.project.language : undefined]);

  useEffect(() => {
    if (bootstrap?.state !== "ready") return;
    if (!selected) return;
    const controller = new AbortController();
    void loadPage(selected, true, controller.signal);
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    function restoreLocation() {
      const location = locationFromHash();
      const targetPage = pages.find(
        (page) => page.slug === location.page || page.name === location.page
      );
      if (
        !location.page ||
        !targetPage
      ) return;
      if (hasUnsavedChanges && selected && targetPage.name !== selected) {
        window.history.replaceState(null, "", pageHash(
          pages.find((page) => page.name === selected)?.slug ?? selected
        ));
        setPendingLeave({
          kind: "navigate",
          page: targetPage.name,
          heading: location.heading
        });
        return;
      }
      setPendingLocation({ page: targetPage.name, heading: location.heading });
      setSelected(targetPage.name);
    }
    // 本文中の内部リンク `[..](#page=slug)` はクリック時にlocation.hashを
    // 書き換えるだけで、履歴操作のpopstateは発火しない。hashchangeも購読して、
    // ページ間ハッシュリンクで遷移できるようにする。
    window.addEventListener("popstate", restoreLocation);
    window.addEventListener("hashchange", restoreLocation);
    return () => {
      window.removeEventListener("popstate", restoreLocation);
      window.removeEventListener("hashchange", restoreLocation);
    };
  }, [hasUnsavedChanges, pages, selected]);

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

  externalHandler.current = () => {
    void loadList();
    if (!selected) return;
    if (hasUnsavedChanges) {
      setExternalChange(true);
    } else {
      void loadPage(selected, true);
    }
  };

  useEffect(() => {
    if (bootstrap?.state !== "ready") return;
    if (!bootstrap?.capabilities.live) return;
    const events = new EventSource("/api/v1/events");
    events.onopen = () => {
      const now = Date.now();
      setWatchConnection((current) => {
        if (
          current.state === "disconnected" ||
          current.state === "error"
        ) {
          setWatchMessage(t("app.watchReconnected"));
        }
        return { state: "connected", lastConfirmedAt: now };
      });
    };
    events.onmessage = (event) => {
      const repositoryEvent = parseRepositoryEvent(event.data);
      if (!repositoryEvent) return;
      const now = Date.now();
      setWatchConnection({
        state: repositoryEvent.watcher === "error" ? "error" : "connected",
        lastConfirmedAt: now
      });
      if (
        repositoryEvent.kind === "repository-change" ||
        repositoryEvent.kind === "setup-complete" ||
        repositoryEvent.kind === "config-change"
      ) {
        if (repositoryEvent.kind === "config-change") void loadBootstrap();
        externalHandler.current();
      }
    };
    events.onerror = () => {
      setWatchConnection((current) => ({
        state: "disconnected",
        lastConfirmedAt: current.lastConfirmedAt
      }));
      setWatchMessage("");
    };
    return () => events.close();
  }, [bootstrap?.state]);

  useEffect(() => {
    if (!watchMessage) return;
    const timer = window.setTimeout(() => setWatchMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [watchMessage]);

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
  const editAssessment = useMemo(
    () =>
      view
        ? assessPageEditing(view)
        : { supported: false, reasons: [], blocks: [] },
    [view]
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
    window.history.pushState(null, "", pageHash(route, heading));
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
        pageHash(
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

  function directOrder(folderPath: string): string[] {
    const visit = (
      nodes: DocumentNavigationNode[]
    ): DocumentNavigationFolder | undefined => {
      for (const node of nodes) {
        if (node.kind !== "folder") continue;
        if (node.path === folderPath) return node;
        const nested = visit(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    const children =
      folderPath === ""
        ? navigation.tree
        : visit(navigation.tree)?.children ?? [];
    return children.map((child) =>
      child.kind === "folder"
        ? basename(child.path)
        : basename(child.relativePath)
    );
  }

  async function moveTreeItem(
    sourceKey: string,
    targetKey: string,
    position: DropPosition
  ) {
    const sourcePage = sourceKey.startsWith("page:")
      ? pages.find((page) => page.name === sourceKey.slice(5))
      : undefined;
    const sourceFolder = sourceKey.startsWith("folder:")
      ? folders.find((folder) => folder.path === sourceKey.slice(7))
      : undefined;
    const targetPage = targetKey.startsWith("page:")
      ? pages.find((page) => page.name === targetKey.slice(5))
      : undefined;
    const targetFolder = targetKey.startsWith("folder:")
      ? folders.find((folder) => folder.path === targetKey.slice(7))
      : undefined;
    if ((!sourcePage && !sourceFolder) || (!targetPage && !targetFolder)) return;

    let input: StructureInput;
    const sourceParent = sourcePage
      ? parentPath(sourcePage.relativePath)
      : parentPath(sourceFolder!.path);
    const targetParent =
      targetFolder && position === "on"
        ? targetFolder.path
        : targetPage
          ? parentPath(targetPage.relativePath)
          : parentPath(targetFolder!.path);
    const targetName = targetPage
      ? basename(targetPage.relativePath)
      : targetFolder?.path
        ? basename(targetFolder.path)
        : undefined;
    const sourceName = sourcePage
      ? basename(sourcePage.relativePath)
      : basename(sourceFolder!.path);
    if (sourceParent === targetParent && position !== "on") {
      const ordered = directOrder(targetParent);
      const next = ordered.filter((item) => item !== sourceName);
      const targetIndex = targetName ? next.indexOf(targetName) : next.length;
      next.splice(
        Math.max(0, targetIndex + (position === "after" ? 1 : 0)),
        0,
        sourceName
      );
      input = { type: "reorder", folderPath: targetParent, order: next };
    } else {
      const destinationOrder = directOrder(targetParent)
        .filter((item) => item !== sourceName);
      if (position === "on" || !targetName) {
        destinationOrder.push(sourceName);
      } else {
        const targetIndex = destinationOrder.indexOf(targetName);
        destinationOrder.splice(
          Math.max(0, targetIndex + (position === "after" ? 1 : 0)),
          0,
          sourceName
        );
      }
      if (sourcePage) {
        input = {
          type: "move-page",
          pageId: sourcePage.name,
          destinationPath: targetParent,
          destinationOrder
        };
      } else {
        input = {
          type: "move-folder",
          folderPath: sourceFolder!.path,
          destinationPath: targetParent,
          destinationOrder
        };
      }
    }
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
      setMessage(error instanceof Error ? error.message : String(error));
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

  async function save(): Promise<boolean> {
    if (!view || view.readOnly) return false;
    setSaveState("saving");
    setSaveError("");
    setCopyMessage("");
    setConflictView(undefined);
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
          .map(({ id, content }) => ({ id, content }))
      });
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
      const currentLocation = locationFromHash();
      window.history.replaceState(
        null,
        "",
        pageHash(savedSlug, currentLocation.heading)
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
      setSaveError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftCopyText(title, blocks));
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
          <p className="setup-kicker">設定を読み込めません</p>
          <h1>設定ファイルを確認してください</h1>
          <p>
            設定ファイルは存在するため、未初期化として上書きしません。
            内容を修正してから再読み込みしてください。
          </p>
          {bootstrapDiagnostics.map((item) => (
            <p className="setup-error" key={`${item.code}:${item.message}`}>
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

  return (
    <>
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
        ) : (
        <EditorWorkspace
          view={view}
          draft={draft}
          conflictView={conflictView}
          title={title}
          slug={slug}
          blocks={blocks}
          pages={pages}
          editing={editing}
          canEdit={editAssessment.supported && bootstrap.capabilities.editing}
          editReasons={editAssessment.reasons}
          blockAssessments={editAssessment.blocks}
          saveState={saveState}
          hasUnsavedChanges={hasUnsavedChanges}
          message={
            message ||
            (diagnostics.length > 0
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
            if (editAssessment.supported) setEditing(true);
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
            markDirty();
          }}
          onSlugChange={(value) => {
            setSlug(value);
            markDirty();
          }}
          onBlockChange={(index, content) => {
            const block = blocks[index];
            if (!block) return;
            const next = [...blocks];
            next[index] = { ...block, content };
            setBlocks(next);
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
        />
        )}
      </WorkspaceShell>
      <UnsavedChangesDialog
        isOpen={Boolean(pendingLeave)}
        destination={leaveDestination}
        busy={saveState === "saving"}
        onStay={() => setPendingLeave(undefined)}
        onSaveAndLeave={() => void saveAndLeave()}
        onDiscard={discardAndLeave}
      />
      <StructureActionDialog
        action={createAction}
        pages={pages}
        folders={folders}
        onOpenChange={(open) => {
          if (!open) setCreateAction(undefined);
        }}
        onApplied={(plan, result) => {
          acceptStructureResult(plan, result);
          setCreateAction(undefined);
        }}
      />
      {structureUndo && (
        <div className="structure-undo" role="status">
          <span>{structureUndo.message}</span>
          <button
            type="button"
            onClick={() => {
              const pending = structureUndo;
              setStructureUndo(undefined);
              void undoStructure(pending.plan)
                .then((response) => {
                  setPages(response.data.pages);
                  setFolders(response.data.folders);
                  if (pending.folderMove) {
                    setSelectedFolder((current) => {
                      if (
                        current === undefined ||
                        (current !== pending.folderMove!.to &&
                          !current.startsWith(`${pending.folderMove!.to}/`))
                      ) {
                        return current;
                      }
                      return `${pending.folderMove!.from}${current.slice(
                        pending.folderMove!.to.length
                      )}`;
                    });
                  }
                  setMessage(t("app.structureUndone"));
                })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : String(error));
                });
            }}
          >
            {t("app.undo")}
          </button>
        </div>
      )}
    </>
  );
}
