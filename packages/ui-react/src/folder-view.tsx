import type { DocumentNavigationFolder } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { Icon } from "./icon.js";
import styles from "./folder-view.module.css";

export function FolderView(props: {
  folder?: DocumentNavigationFolder;
  onSelectPage(name: string): void;
  onSelectFolder(path: string): void;
  onCreatePage?(): void;
}) {
  const { t } = useTranslation();
  if (!props.folder) {
    return (
      <section className={styles.empty} aria-labelledby="empty-title">
        <p>{t("folder.empty.kicker")}</p>
        <h1 id="empty-title">{t("folder.empty.title")}</h1>
        <span>{t("folder.empty.hint")}</span>
        {props.onCreatePage && (
          <button
            type="button"
            className={styles.emptyCta}
            onClick={props.onCreatePage}
          >
            {t("folder.empty.createFirst")}
          </button>
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
      {props.folder.children.length === 0 ? (
        <p className={styles.emptyRow}>{t("folder.emptyRow")}</p>
      ) : (
        <ul>
          {props.folder.children.map((child) => (
            <li key={child.kind === "folder" ? child.path : child.name}>
              <button type="button" onClick={() => child.kind === "folder"
                ? props.onSelectFolder(child.path)
                : props.onSelectPage(child.name)}>
                <span className={styles.icon}>
                  <Icon name={child.kind === "folder" ? "folder" : "page"} size={18} />
                </span>
                <strong>{child.title}</strong>
                <small>
                  {child.kind === "folder"
                    ? t("folder.kindFolder")
                    : t("folder.kindPage")}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
