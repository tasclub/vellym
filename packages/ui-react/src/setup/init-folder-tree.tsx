import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { InitCatalogFolder } from "../shared/api.js";
import styles from "./setup.module.css";

/** All branches stay expanded: this is a preview with editable names, not a
 * selection widget. Arrow navigation is on rows; inputs retain native editing. */
export function InitFolderTree(props: {
  folders: InitCatalogFolder[];
  numbered: boolean;
  names: Record<string, string>;
  onRename(id: string, value: string): void;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState("");
  const flat = props.folders.flatMap(function flatten(folder): InitCatalogFolder[] {
    return [folder, ...(folder.children ?? []).flatMap(flatten)];
  });
  function navigate(event: KeyboardEvent<HTMLLIElement>, folder: InitCatalogFolder, parent?: string) {
    if (event.target !== event.currentTarget) return;
    const index = flat.findIndex(item => item.id === folder.id);
    let target: string | undefined;
    if (event.key === "ArrowDown") target = flat[Math.min(flat.length - 1, index + 1)]?.id;
    if (event.key === "ArrowUp") target = flat[Math.max(0, index - 1)]?.id;
    if (event.key === "Home") target = flat[0]?.id;
    if (event.key === "End") target = flat.at(-1)?.id;
    if (event.key === "ArrowRight") target = folder.children?.[0]?.id;
    if (event.key === "ArrowLeft") target = parent;
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      event.currentTarget.querySelector("input")?.focus();
    }
    if (target) {
      event.preventDefault();
      const tree = event.currentTarget.closest('[role="tree"]');
      tree?.querySelector<HTMLElement>(`[data-folder-id="${target}"]`)?.focus();
    }
  }
  function nodes(folders: InitCatalogFolder[], level = 1, parent?: string) {
    return folders.map((folder, index) => {
      const name = props.names[folder.id] ?? `${props.numbered ? `${String(folder.id === "guide" ? 0 : index).padStart(2, "0")}_` : ""}${folder.name}`;
      return <li key={folder.id} role="treeitem" aria-level={level}
        aria-expanded={folder.children?.length ? true : undefined} aria-label={name}
        data-folder-id={folder.id} tabIndex={(focused || flat[0]?.id) === folder.id ? 0 : -1}
        onFocus={event => { if (event.target === event.currentTarget) setFocused(folder.id); }}
        onKeyDown={event => navigate(event, folder, parent)}>
        <label className={styles["init-folder"]}>
          <span>{t("init.folderName")}</span>
          <input data-testid={`setup-folder-${folder.id}`} value={name}
            onChange={event => props.onRename(folder.id, event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") { event.preventDefault(); event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus(); }
            }} />
        </label>
        {folder.children?.length ? <ul role="group">{nodes(folder.children, level + 1, folder.id)}</ul> : null}
      </li>;
    });
  }
  return <ul role="tree" aria-label={t("init.folderTree")} className={styles["init-tree"]}>{nodes(props.folders)}</ul>;
}
