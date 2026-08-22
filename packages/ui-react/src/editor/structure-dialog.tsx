import { useEffect, useMemo, useState } from "react";
import type { FolderSummary, PageSummary } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  applyStructure,
  fetchFolderEdit,
  patchFolder,
  previewStructure,
  type StructureApplyResult,
  type StructureInput,
  type StructurePlan
} from "../shared/api.js";
import { FolderLanguageControls } from "./folder-language-controls.js";
import {
  createFolderEditSession,
  folderEditPatch,
  folderEditSessionDirty,
  type FolderEditSession
} from "./folder-edit-session.js";
import styles from "./structure-dialog.module.css";
import { errorMessage } from "../shared/error-message.js";

export type StructureAction =
  | { type: "create-page"; parentPath: string; chooseParent?: boolean }
  | { type: "create-folder"; parentPath: string; chooseParent?: boolean }
  | { type: "update-folder"; folderPath: string }
  | { type: "move-page"; pageId: string }
  | { type: "move-folder"; folderPath: string }
  | { type: "archive-page"; pageId: string }
  | { type: "archive-folder"; folderPath: string };

// 移動先の「未選択」を表す番兵。root フォルダの path は "" なので、"" を
// 未選択の代用にできない（root への移動が正当な操作のため）。
const UNSELECTED_DESTINATION = "\u0000";

const titleKeys: Record<StructureAction["type"], string> = {
  "create-page": "structure.title.createPage",
  "create-folder": "structure.title.createFolder",
  "update-folder": "structure.title.updateFolder",
  "move-page": "structure.title.movePage",
  "move-folder": "structure.title.moveFolder",
  "archive-page": "structure.title.archivePage",
  "archive-folder": "structure.title.archiveFolder"
};

export function StructureActionDialog(props: {
  action?: StructureAction;
  pages: PageSummary[];
  folders: FolderSummary[];
  uiLocale?: string;
  onOpenChange(open: boolean): void;
  onApplied(plan: StructurePlan, result: StructureApplyResult): void;
  onFolderApplied?(folder: FolderSummary): void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // RELUX-03: 作成は「確認→作成」の2段階にする。preview があるときだけ
  // ファイルを作る（確定するまで作らない）。入力が変わったら破棄する。
  const [preview, setPreview] = useState<StructurePlan>();
  const [folderSession, setFolderSession] = useState<FolderEditSession>();
  const action = props.action;
  const selectedPage = action && "pageId" in action
    ? props.pages.find((page) => page.name === action.pageId)
    : undefined;
  const selectedPageParent = selectedPage?.relativePath
    .replaceAll("\\", "/")
    .split("/")
    .slice(0, -1)
    .join("/");
  const selectedFolder = action && "folderPath" in action
    ? props.folders.find((folder) => folder.path === action.folderPath)
    : undefined;
  const affectedPages = action?.type === "archive-page"
    ? 1
    : action?.type === "archive-folder"
      ? props.pages.filter((page) =>
          page.relativePath.startsWith(`${action.folderPath}/`)
        ).length
      : 0;
  const folderOptions = useMemo(
    () => [...props.folders].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    [props.folders]
  );

  useEffect(() => {
    if (!action) return;
    setError("");
    setTitle(
      action.type === "update-folder"
        ? props.folders.find((folder) => folder.path === action.folderPath)?.title ?? ""
        : ""
    );
    setDescription(
      action.type === "update-folder"
        ? props.folders.find((folder) => folder.path === action.folderPath)?.description ?? ""
        : ""
    );
    setParentPath("parentPath" in action ? action.parentPath : "");
    setPreview(undefined);
    setFolderSession(undefined);
    // RELUX-06: 移動先の既定を「未選択」にして選択を必須にする（現在地の隣の
    // フォルダへ黙って移す事故を防ぐ）。現在地は下の説明で示す。
    if (action.type === "move-folder" || action.type === "move-page") {
      setDestinationPath(UNSELECTED_DESTINATION);
    } else {
      setDestinationPath("");
    }
  }, [action, props.folders, props.pages]);

  useEffect(() => {
    if (action?.type !== "update-folder") return;
    let active = true;
    setBusy(true);
    void fetchFolderEdit(action.folderPath)
      .then(({ data }) => {
        if (!active) return;
        setFolderSession(createFolderEditSession(data));
        setError(data.readOnly ? data.readOnlyReasons.join("、") : "");
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught, t));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [action]);

  // RELUX-03: 作成の入力が変わったら確認済みプレビューを破棄する。
  useEffect(() => {
    setPreview(undefined);
  }, [title, parentPath]);

  function folderLabel(folder: FolderSummary, t: TFunction): string {
    return folder.path
      ? `${folder.title}（${folder.path}）`
      : t("structure.rootFolder");
  }

  function input(): StructureInput {
    if (!action) throw new Error("action is required");
    switch (action.type) {
      case "create-page":
        return { type: action.type, title, parentPath };
      case "create-folder":
        return { type: action.type, name: title, parentPath };
      case "update-folder":
        return {
          type: action.type,
          folderPath: action.folderPath,
          title,
          description
        };
      case "move-page":
        return {
          type: action.type,
          pageId: action.pageId,
          destinationPath
        };
      case "move-folder":
        return {
          type: action.type,
          folderPath: action.folderPath,
          destinationPath
        };
      case "archive-page":
        return { type: action.type, pageId: action.pageId };
      case "archive-folder":
        return { type: action.type, folderPath: action.folderPath };
    }
  }

  async function apply() {
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      if (action.type === "update-folder" && folderSession) {
        const saved = (await patchFolder(folderEditPatch(folderSession))).data;
        props.onFolderApplied?.(saved);
        props.onOpenChange(false);
        return;
      }
      const plan = (await previewStructure(input())).data;
      if (!plan.executable) {
        setError(plan.conflict ?? t("structure.applyFailed"));
        return;
      }
      const result = (await applyStructure(plan)).data;
      props.onApplied(plan, result);
      props.onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  // RELUX-03: 作成の1段階目。プレビューを取得するだけで、ファイルは作らない。
  async function reviewCreate() {
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      setPreview((await previewStructure(input())).data);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  // RELUX-03: 作成の2段階目。確認したプレビューをそのまま適用する。
  async function confirmCreate() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = (await applyStructure(preview)).data;
      props.onApplied(preview, result);
      props.onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  const isArchive = action?.type.startsWith("archive");
  const isMove = action?.type === "move-page" || action?.type === "move-folder";
  const isCreate =
    action?.type === "create-page" || action?.type === "create-folder";
  // 移動元の現在地（RELUX-06 の「現在地表示」用）。
  const currentLocationPath =
    action?.type === "move-page"
      ? selectedPageParent ?? ""
      : action?.type === "move-folder"
        ? selectedFolder?.path.split("/").slice(0, -1).join("/") ?? ""
        : "";
  const currentLocationFolder = props.folders.find(
    (folder) => folder.path === currentLocationPath
  );
  const currentLocationLabel = currentLocationFolder
    ? folderLabel(currentLocationFolder, t)
    : t("structure.rootFolder");
  // 作成プレビューの生成先（file path・ファイル名・slug）を導く。
  const createDestination = preview?.changes.find(
    (change) => change.operation === "create"
  )?.destination;
  const createFileName = createDestination?.split("/").pop() ?? "";
  const createSlug = createFileName.replace(/\.[^.]+$/, "");

  return (
    <ModalOverlay
      isOpen={Boolean(action)}
      onOpenChange={props.onOpenChange}
      isDismissable={!busy}
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <Dialog
          aria-label={action ? t(titleKeys[action.type]) : t("structure.fallbackLabel")}
          className={styles.dialog}
        >
          <div className={styles.header}>
            <div>
              <h2>{action ? t(titleKeys[action.type]) : ""}</h2>
              {isArchive && <p>{t("structure.noRestore")}</p>}
            </div>
            <Button
              className={styles.close}
              aria-label={t("structure.close")}
              onPress={() => props.onOpenChange(false)}
            >
              ×
            </Button>
          </div>
          <div className={styles.form}>
            {(action?.type === "create-page" ||
              action?.type === "create-folder") && (
              <>
                <label className={styles.field}>
                  <span>
                    {action.type === "create-page"
                      ? t("structure.pageTitleLabel")
                      : t("structure.folderNameLabel")}
                  </span>
                  <input
                    autoFocus
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                {action.chooseParent && (
                  <label className={styles.field}>
                    <span>{t("structure.destinationFolder")}</span>
                    <select
                      value={parentPath}
                      onChange={(event) => setParentPath(event.target.value)}
                    >
                      {folderOptions.map((folder) => (
                        <option key={folder.path || "root"} value={folder.path}>
                          {folderLabel(folder, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {action?.type === "update-folder" && (
              folderSession ? (
                <FolderLanguageControls
                  session={folderSession}
                  uiLocale={props.uiLocale ?? "ja"}
                  disabled={busy}
                  onChange={setFolderSession}
                />
              ) : <p role="status">{t("editor.loading")}</p>
            )}
            {isMove && action && (
              <label className={styles.field}>
                <span>{t("structure.moveDestination")}</span>
                <p className={styles.hint}>
                  {t("structure.currentLocation", {
                    location: currentLocationLabel
                  })}
                </p>
                <select
                  autoFocus
                  value={destinationPath}
                  onChange={(event) => setDestinationPath(event.target.value)}
                >
                  <option value={UNSELECTED_DESTINATION} disabled>
                    {t("structure.chooseDestination")}
                  </option>
                  {folderOptions
                    .filter((folder) =>
                      action.type === "move-folder"
                        ? folder.path !== action.folderPath &&
                          !folder.path.startsWith(`${action.folderPath}/`)
                        : folder.path !== selectedPageParent
                    )
                    .map((folder) => (
                      <option key={folder.path || "root"} value={folder.path}>
                        {folderLabel(folder, t)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {isArchive && (
              <div className={styles.preview}>
                <strong>
                  {selectedPage?.title ?? selectedFolder?.title}
                </strong>
                {affectedPages > 0 && (
                  <span>{t("structure.affectedPages", { count: affectedPages })}</span>
                )}
                <span>{t("structure.archiveNote")}</span>
              </div>
            )}
            {isCreate && preview && (
              <div className={styles.preview}>
                <div>
                  <span>{t("structure.previewPath")}</span>
                  <strong>{createDestination}</strong>
                </div>
                <div>
                  <span>{t("structure.previewFileName")}</span>
                  <strong>{createFileName}</strong>
                </div>
                <div>
                  <span>{t("structure.previewSlug")}</span>
                  <strong>{createSlug}</strong>
                </div>
                {preview.executable ? (
                  <span>{t("structure.previewNoConflict")}</span>
                ) : (
                  <span className={styles.error}>
                    {preview.conflict ?? t("structure.applyFailed")}
                  </span>
                )}
                {preview.warnings.map((warning, index) => (
                  <span key={index}>▲ {warning}</span>
                ))}
              </div>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <Button
                className={styles.secondary}
                isDisabled={busy}
                onPress={() => props.onOpenChange(false)}
              >
                {t("structure.cancel")}
              </Button>
              {isCreate ? (
                preview ? (
                  <Button
                    className={styles.primary}
                    isDisabled={busy || !preview.executable}
                    onPress={() => void confirmCreate()}
                  >
                    {busy ? t("structure.saving") : t("structure.confirmCreate")}
                  </Button>
                ) : (
                  <Button
                    className={styles.primary}
                    isDisabled={busy || !title.trim()}
                    onPress={() => void reviewCreate()}
                  >
                    {busy ? t("structure.checking") : t("structure.reviewCreate")}
                  </Button>
                )
              ) : (
                <Button
                  className={isArchive ? styles.danger : styles.primary}
                  isDisabled={
                    busy ||
                    (action?.type === "update-folder" && (
                      !folderSession ||
                      !folderEditSessionDirty(folderSession) ||
                      folderSession.locales.some((item) => !item.removed && !item.title.trim())
                    )) ||
                    (isMove && destinationPath === UNSELECTED_DESTINATION)
                  }
                  onPress={() => void apply()}
                >
                  {busy
                    ? t("structure.saving")
                    : isArchive
                      ? t("structure.archiveAction")
                      : t("structure.save")}
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
