import type { DocumentNavigationFolder } from "@vellym-internal/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchInitCatalog, type InitCatalog } from "../shared/api.js";
import type { AddMode } from "./add-from-template-dialog.js";
import { Icon } from "../shared/icon.js";
import { KindIcon } from "../shared/kind-icon.js";
import { Button } from "../shared/button.js";
import styles from "./folder-view.module.css";

export function FolderView(props: {
  folder?: DocumentNavigationFolder;
  onSelectPage(name: string): void;
  onSelectFolder(path: string): void;
  onCreatePage?(): void;
  language?: "ja" | "en";
  onAdd?(mode: AddMode, catalog: InitCatalog): void;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<InitCatalog>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!props.onAdd) return;
    const controller = new AbortController();
    setCatalog(undefined);
    setFailed(false);
    void fetchInitCatalog(props.language ?? "en", controller.signal)
      .then(result => setCatalog(result.data))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [!!props.onAdd, props.language]);
  const actions = props.onAdd && <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
    <Button data-testid="folder-add-template" disabled={!catalog}
      onClick={() => catalog && props.onAdd?.({ kind: "template" }, catalog)}>{t("templateAdd.templateAction")}</Button>
    {[...new Set(catalog?.resources.map(item => item.group) ?? [])].map(group =>
      <Button key={group} data-testid="folder-add-resource"
        onClick={() => catalog && props.onAdd?.({ kind: "resource", group }, catalog)}>
        {group}
      </Button>)}
    <Button data-testid="folder-add-set" disabled={!catalog}
      onClick={() => catalog && props.onAdd?.({ kind: "set" }, catalog)}>{t("templateAdd.setAction")}</Button>
    {failed && <p role="alert">{t("templateAdd.failed")}</p>}
  </div>;
  if (!props.folder) {
    return (
      <section className={styles.empty} aria-labelledby="empty-title">
        <p>{t("folder.empty.kicker")}</p>
        <h1 id="empty-title">{t("folder.empty.title")}</h1>
        {actions}
        {props.onCreatePage && (
          <Button
            className={styles.emptyCta}
            onClick={props.onCreatePage}
          >
            {t("folder.empty.createFirst")}
          </Button>
        )}
      </section>
    );
  }
  return (
    <section className={styles.folder} aria-labelledby="folder-title">
      <header>
        <p>{t("folder.kicker")}</p>
        <h1 id="folder-title">{props.folder.title}</h1>
      </header>
      {actions}
      {props.folder.children.length === 0 ? (
        <p className={styles.emptyRow}>{t("folder.emptyRow")}</p>
      ) : (
        <ul>
          {props.folder.children.map((child) => (
            <li key={child.kind === "folder" ? child.path : child.name}>
              <Button onClick={() => child.kind === "folder"
                ? props.onSelectFolder(child.path)
                : props.onSelectPage(child.name)}>
                <span className={styles.icon}>
                  {child.kind === "folder" ? (
                    <Icon name="folder" size={18} />
                  ) : (
                    <KindIcon resourceKind={child.resourceKind} size={18} />
                  )}
                </span>
                <strong>{child.title}</strong>
                <small>
                  {child.kind === "folder"
                    ? t("folder.kindFolder")
                    : t("folder.kindPage")}
                </small>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
