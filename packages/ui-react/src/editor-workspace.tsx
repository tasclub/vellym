import { useEffect, useRef, useState } from "react";
import type {
  BlockEditAssessment,
  PageSummary,
  PageView,
  RichTextBlock
} from "@vellym-internal/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  VellymEditorAdapter,
  EditorCommand,
  EditorStateSnapshot
} from "./editor-adapter.js";
import { MilkdownBlockEditor } from "./milkdown-block-editor.js";
import { LinkDialog } from "./link-dialog.js";
import type {
  SaveState,
  WatchConnection
} from "./save-state.js";
import { draftCopyText } from "./save-state.js";
import { DocumentView } from "./view.js";

const FORMAT_ACTIONS: {
  command: EditorCommand;
  labelKey: string;
  text: string;
}[] = [
  { command: "heading-2", labelKey: "editor.heading2", text: "H2" },
  { command: "heading-3", labelKey: "editor.heading3", text: "H3" },
  { command: "heading-4", labelKey: "editor.heading4", text: "H4" },
  { command: "strong", labelKey: "editor.strong", text: "B" },
  { command: "emphasis", labelKey: "editor.emphasis", text: "I" },
  { command: "strikethrough", labelKey: "editor.strikethrough", text: "S" },
  { command: "blockquote", labelKey: "editor.blockquote", text: "“”" },
  { command: "bullet-list", labelKey: "editor.bulletList", text: "•" },
  { command: "ordered-list", labelKey: "editor.orderedList", text: "1." },
  { command: "inline-code", labelKey: "editor.inlineCode", text: "</>" },
  { command: "code-block", labelKey: "editor.codeBlock", text: "{ }" },
  { command: "link", labelKey: "editor.link", text: "↗" },
  { command: "table", labelKey: "editor.table", text: "▦" },
  { command: "hr", labelKey: "editor.hr", text: "―" }
];

// よく使う書式だけをバーに残し、残りはオーバーフローメニューへ畳んで、
// ツールバーが何段にも折り返さないようにする。
const PRIMARY_COMMANDS = new Set<EditorCommand>([
  "heading-2",
  "heading-3",
  "strong",
  "emphasis",
  "bullet-list",
  "ordered-list",
  "link"
]);
const PRIMARY_ACTIONS = FORMAT_ACTIONS.filter((action) =>
  PRIMARY_COMMANDS.has(action.command)
);
const MORE_ACTIONS = FORMAT_ACTIONS.filter(
  (action) => !PRIMARY_COMMANDS.has(action.command)
);

// カーソルが表の中にあるときだけ表示する、ラベル付きの明示的な表操作。
const TABLE_ACTIONS: {
  command: EditorCommand;
  labelKey: string;
  text: string;
}[] = [
  { command: "table-row-add", labelKey: "editor.tableRowAdd", text: "＋行" },
  { command: "table-row-remove", labelKey: "editor.tableRowRemove", text: "−行" },
  { command: "table-col-add", labelKey: "editor.tableColAdd", text: "＋列" },
  { command: "table-col-remove", labelKey: "editor.tableColRemove", text: "−列" },
  { command: "table-remove", labelKey: "editor.tableRemove", text: "表を削除" }
];

function Notices(props: {
  view: PageView;
  draft: PageView;
  conflictView?: PageView;
  editing: boolean;
  editReasons: string[];
  externalChange: boolean;
  message: string;
  saveState: SaveState;
  saveError: string;
  savedAt?: number;
  copyMessage: string;
  watchConnection: WatchConnection;
  watchMessage: string;
  onRetry(): void;
  onCopy(): void;
  onKeepDraft(): void;
  onReload(): void;
}) {
  const { t } = useTranslation();
  const savedTime = props.savedAt
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(props.savedAt)
    : "";
  const confirmedTime = props.watchConnection.lastConfirmedAt
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(props.watchConnection.lastConfirmedAt)
    : t("editor.watchUnconfirmed");
  return (
    <>
      {props.saveState === "success" && (
        <div className="notice success" role="status" aria-live="polite">
          {t("editor.savedAt", { time: savedTime })}
        </div>
      )}
      {props.saveState === "failure" && (
        <div className="notice warning save-problem" role="alert">
          <strong>{t("editor.saveFailedTitle")}</strong>
          <span>{props.saveError}</span>
          <div className="notice-actions">
            <button type="button" onClick={props.onRetry}>
              {t("editor.retrySave")}
            </button>
            <button type="button" onClick={props.onCopy}>
              {t("editor.copyDraft")}
            </button>
          </div>
        </div>
      )}
      {props.saveState === "conflict" && (
        <div className="notice warning save-problem" role="alert">
          <strong>{t("editor.conflictTitle")}</strong>
          <span>{t("editor.conflictBody")}</span>
          {props.conflictView && (
            <details className="conflict-details">
              <summary>{t("editor.conflictCompare")}</summary>
              <div className="conflict-comparison">
                <section>
                  <h3>{t("editor.conflictDraftHeading")}</h3>
                  <pre>
                    {draftCopyText(
                      props.draft.page.metadata.title,
                      props.draft.knownBlocks
                    )}
                  </pre>
                </section>
                <section>
                  <h3>{t("editor.conflictYamlHeading")}</h3>
                  <pre>
                    {draftCopyText(
                      props.conflictView.page.metadata.title,
                      props.conflictView.knownBlocks
                    )}
                  </pre>
                </section>
              </div>
            </details>
          )}
          <div className="notice-actions">
            <button type="button" onClick={props.onCopy}>
              {t("editor.copyDraft")}
            </button>
            {props.conflictView && (
              <button type="button" onClick={props.onKeepDraft}>
                {t("editor.keepDraft")}
              </button>
            )}
            <button type="button" onClick={props.onReload}>
              {t("editor.useYaml")}
            </button>
          </div>
        </div>
      )}
      {props.copyMessage && (
        <div className="notice success" role="status" aria-live="polite">
          {props.copyMessage}
        </div>
      )}
      {(props.watchConnection.state === "disconnected" ||
        props.watchConnection.state === "error") && (
        <div className="notice warning watch-problem" role="status">
          <strong>
            {props.watchConnection.state === "error"
              ? t("editor.watchError")
              : t("editor.watchDisconnected")}
          </strong>
          <span>{t("editor.watchLastConfirmed", { time: confirmedTime })}</span>
        </div>
      )}
      {props.watchMessage && (
        <div className="notice success" role="status" aria-live="polite">
          {props.watchMessage}
        </div>
      )}
      {!props.editing && props.editReasons.length > 0 && (
        <div className="notice">
          {t("editor.readOnly", { reasons: props.editReasons.join("、") })}
        </div>
      )}
      {props.externalChange && props.saveState !== "conflict" && (
        <div className="notice warning">
          {t("editor.externalChange")}
          <button type="button" onClick={props.onReload}>
            {t("editor.reload")}
          </button>
        </div>
      )}
      {props.message && (
        <div className="notice warning">{props.message}</div>
      )}
    </>
  );
}

export function EditorWorkspace(props: {
  view?: PageView;
  draft?: PageView;
  conflictView?: PageView;
  title: string;
  slug: string;
  blocks: RichTextBlock[];
  pages: PageSummary[];
  editing: boolean;
  canEdit: boolean;
  editReasons: string[];
  blockAssessments: BlockEditAssessment[];
  saveState: SaveState;
  hasUnsavedChanges: boolean;
  message: string;
  saveError: string;
  savedAt?: number;
  copyMessage: string;
  watchConnection: WatchConnection;
  watchMessage: string;
  externalChange: boolean;
  onStartEdit(): void;
  onCancel(): void;
  onTitleChange(value: string): void;
  onSlugChange(value: string): void;
  onBlockChange(index: number, value: string): void;
  onSave(): void;
  onRetry(): void;
  onCopy(): void;
  onKeepDraft(): void;
  onReload(): void;
  onRenameFile(fileName: string): Promise<void>;
}) {
  const adapters = useRef(new Map<number, VellymEditorAdapter>());
  const activeAdapter = useRef<VellymEditorAdapter | undefined>(undefined);
  const [editorState, setEditorState] = useState<EditorStateSnapshot>({
    canUndo: false,
    canRedo: false,
    activeCommands: []
  });
  const [fileName, setFileName] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // アプリ内リンク編集の状態。linkAdapterはダイアログが操作対象とするエディタで、
  // ダイアログを開いた時点で捕捉し、フォーカスがダイアログへ移っても対象を見失わない。
  const [linkDialog, setLinkDialog] = useState<{
    href: string;
    active: boolean;
  } | null>(null);
  const linkAdapter = useRef<VellymEditorAdapter | undefined>(undefined);
  const { t }: { t: TFunction } = useTranslation();

  useEffect(() => {
    const basename = props.view?.relativePath
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/\.ya?ml$/i, "");
    setFileName(basename ?? "");
    setFileError("");
  }, [props.view?.relativePath]);

  if (!props.view || !props.draft) {
    return (
      <section className="workspace">
        <div className="empty">{t("editor.loading")}</div>
      </section>
    );
  }

  const run = (command: EditorCommand) => {
    const adapter =
      activeAdapter.current ?? adapters.current.values().next().value;
    if (!adapter) return;
    adapter.focus();
    adapter.run(command);
  };
  const runHistory = (direction: "undo" | "redo") => {
    const adapter =
      activeAdapter.current ?? adapters.current.values().next().value;
    if (!adapter) return;
    adapter.focus();
    if (direction === "undo") adapter.undo();
    else adapter.redo();
  };
  const openLinkDialog = () => {
    const adapter =
      activeAdapter.current ?? adapters.current.values().next().value;
    if (!adapter) return;
    adapter.focus();
    linkAdapter.current = adapter;
    const context = adapter.linkContext();
    setLinkDialog({ href: context.href, active: context.active });
  };
  const closeLinkDialog = () => {
    setLinkDialog(null);
    linkAdapter.current?.focus();
  };

  if (!props.editing) {
    return (
      <section className="workspace browse-workspace">
        <Notices {...props} view={props.view} draft={props.draft} />
        <div className="document-paper">
          <DocumentView
            view={props.view}
            headerActions={
              props.canEdit ? (
                <button
                  type="button"
                  className="edit-page-button"
                  onClick={props.onStartEdit}
                >
                  {t("editor.edit")}
                </button>
              ) : undefined
            }
          />
        </div>
      </section>
    );
  }

  return (
    <section className="workspace edit-workspace">
      <div className="edit-desktop">
        <div className="edit-toolbar" role="toolbar" aria-label={t("editor.toolbarLabel")}>
          <div className="history-actions" role="group" aria-label={t("editor.historyGroup")}>
            <button
              type="button"
              aria-label={t("editor.undo")}
              disabled={!editorState.canUndo}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runHistory("undo")}
            >
              ↶
            </button>
            <button
              type="button"
              aria-label={t("editor.redo")}
              disabled={!editorState.canRedo}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runHistory("redo")}
            >
              ↷
            </button>
          </div>
          <div className="format-actions" role="group" aria-label={t("editor.formatGroup")}>
            {PRIMARY_ACTIONS.map((action) => (
              <button
                key={action.command}
                type="button"
                aria-label={t(action.labelKey)}
                aria-pressed={editorState.activeCommands.includes(
                  action.command
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  action.command === "link"
                    ? openLinkDialog()
                    : run(action.command)
                }
              >
                {action.text}
              </button>
            ))}
            <details className="more-actions">
              <summary
                aria-label={t("editor.moreFormats")}
                title={t("editor.moreFormats")}
              >
                ⋯
              </summary>
              <div
                className="more-menu"
                role="group"
                aria-label={t("editor.moreFormats")}
              >
                {MORE_ACTIONS.map((action) => (
                  <button
                    key={action.command}
                    type="button"
                    aria-pressed={editorState.activeCommands.includes(
                      action.command
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      const menu = event.currentTarget.closest("details");
                      if (menu) menu.open = false;
                      if (action.command === "link") openLinkDialog();
                      else run(action.command);
                    }}
                  >
                    <span className="more-icon" aria-hidden="true">
                      {action.text}
                    </span>
                    <span>{t(action.labelKey)}</span>
                  </button>
                ))}
              </div>
            </details>
          </div>
          {editorState.activeCommands.includes("table") && (
            <div
              className="table-actions"
              role="group"
              aria-label={t("editor.tableGroup")}
            >
              {TABLE_ACTIONS.map((action) => (
                <button
                  key={action.command}
                  type="button"
                  aria-label={t(action.labelKey)}
                  title={t(action.labelKey)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(action.command)}
                >
                  {action.text}
                </button>
              ))}
            </div>
          )}
          <span className={`status ${props.saveState}`} aria-live="polite">
            {props.saveState === "dirty"
              ? t("editor.statusDirty")
              : props.saveState === "saving"
                ? t("editor.statusSaving")
                : props.saveState === "failure"
                  ? t("editor.statusFailure")
                  : props.saveState === "conflict"
                    ? t("editor.statusConflict")
                    : t("editor.statusClean")}
          </span>
          <button
            type="button"
            className="secondary-button"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            {t("editor.pageSettings")}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={props.saveState === "saving"}
            onClick={props.onCancel}
          >
            {t("editor.cancel")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              !props.hasUnsavedChanges ||
              props.saveState === "saving" ||
              props.saveState === "conflict"
            }
            onClick={props.onSave}
          >
            {t("editor.save")}
          </button>
        </div>
        <Notices {...props} view={props.view} draft={props.draft} />
        {settingsOpen && (
          <div
            className="page-settings-panel"
            role="group"
            aria-label={t("editor.pageSettings")}
          >
            <label className="slug-editor">
              <span>{t("editor.slugLabel")}</span>
              <input
                value={props.slug}
                maxLength={120}
                pattern="[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*"
                onChange={(event) => props.onSlugChange(event.target.value)}
              />
              <small>{t("editor.slugHint")}</small>
            </label>
            <div className="file-name-field">
              <label>
                <span>{t("editor.fileNameLabel")}</span>
                <input
                  value={fileName}
                  onChange={(event) => {
                    setFileName(event.target.value);
                    setFileError("");
                  }}
                />
                <small>{t("editor.fileNameHint")}</small>
              </label>
              {fileError && <p role="alert">{fileError}</p>}
              <button
                type="button"
                disabled={
                  fileBusy || props.hasUnsavedChanges || !fileName.trim()
                }
                onClick={() => {
                  setFileBusy(true);
                  setFileError("");
                  void props.onRenameFile(fileName)
                    .catch((error) => {
                      setFileError(
                        error instanceof Error ? error.message : String(error)
                      );
                    })
                    .finally(() => setFileBusy(false));
                }}
              >
                {fileBusy ? t("editor.renaming") : t("editor.renameFile")}
              </button>
            </div>
          </div>
        )}
        <div className="page-editor-surface">
          <label className="title-editor">
            <span className="visually-hidden">{t("editor.pageTitle")}</span>
            <input
              value={props.title}
              onChange={(event) => props.onTitleChange(event.target.value)}
            />
          </label>
          {(props.blockAssessments.some((block) => !block.supported) ||
            props.view.page.spec.blocks.length > props.blocks.length) && (
            <div className="notice" role="note">
              {t("editor.preservedBlocks")}
            </div>
          )}
          {props.blocks.map((block, index) => {
            const assessment = props.blockAssessments.find(
              (item) => item.id === block.id
            );
            if (assessment && !assessment.supported) {
              // 安全に編集できない内容を持つブロックは読み取り専用にし、保存時に
              // ソースをそのまま保持する。
              return (
                <section
                  key={block.id}
                  className="locked-block"
                  aria-label={t("editor.bodyLabel", { index: index + 1 })}
                >
                  <p className="locked-block-reason notice" role="note">
                    {t("editor.blockReadOnly", {
                      reasons: assessment.reasons.join("、")
                    })}
                  </p>
                  <div className="document-paper">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {block.content}
                    </ReactMarkdown>
                  </div>
                </section>
              );
            }
            return (
            <MilkdownBlockEditor
              key={block.id}
              label={t("editor.bodyLabel", { index: index + 1 })}
              value={block.content}
              onChange={(content) => props.onBlockChange(index, content)}
              onFocus={(adapter) => {
                activeAdapter.current = adapter;
                setEditorState(adapter.state());
              }}
              onReady={(adapter) => {
                if (adapter) {
                  adapters.current.set(index, adapter);
                  activeAdapter.current ??= adapter;
                  if (activeAdapter.current === adapter) {
                    setEditorState(adapter.state());
                  }
                } else {
                  const removed = adapters.current.get(index);
                  adapters.current.delete(index);
                  if (activeAdapter.current === removed) {
                    activeAdapter.current = adapters.current.values().next().value;
                    setEditorState(
                      activeAdapter.current?.state() ?? {
                        canUndo: false,
                        canRedo: false,
                        activeCommands: []
                      }
                    );
                  }
                }
              }}
              onStateChange={(adapter, state) => {
                if (activeAdapter.current === adapter) setEditorState(state);
              }}
            />
            );
          })}
        </div>
      </div>
      <div className="edit-mobile-fallback">
        <p className="notice">{t("editor.mobileUnavailable")}</p>
        <div className="document-paper">
          <DocumentView view={props.view} />
        </div>
      </div>
      <LinkDialog
        isOpen={linkDialog !== null}
        initialHref={linkDialog?.href ?? ""}
        isActive={linkDialog?.active ?? false}
        pages={props.pages}
        onSubmit={(href) => {
          linkAdapter.current?.setLink(href);
          closeLinkDialog();
        }}
        onRemove={() => {
          linkAdapter.current?.unsetLink();
          closeLinkDialog();
        }}
        onCancel={closeLinkDialog}
      />
    </section>
  );
}
