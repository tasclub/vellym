import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { formatWikiLink, type PageSummary } from "@vellym-internal/core";
import styles from "./link-dialog.module.css";

// Milkdown側も適用時にサニタイズするが、明らかに危険なスキームはここでも弾く。
// このダイアログのURL欄は外部リンク（http(s)・mailto・相対path・見出しアンカー）
// 専用であり、内部Pageリンクは下のPage選択から`[[...]]`として挿入する。
export function isValidLinkHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (/^(javascript|data|vbscript):/i.test(href)) return false;
  if (/^(https?:|mailto:)/i.test(href)) return true;
  // 相対pathとページ内アンカー。
  return /^[#./]/.test(href) || !href.includes(":");
}

export function LinkDialog(props: {
  isOpen: boolean;
  initialHref: string;
  isActive: boolean;
  pages: PageSummary[];
  onSubmit(href: string): void;
  /** 内部Pageリンクを`[[metadata.name|表示名]]`のテキストとして挿入する。 */
  onInsertPageLink(markdown: string): void;
  onRemove(): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const [href, setHref] = useState(props.initialHref);
  const [touched, setTouched] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageLabel, setPageLabel] = useState("");

  useEffect(() => {
    if (props.isOpen) {
      setHref(props.initialHref);
      setTouched(false);
      setPageId("");
      setPageLabel("");
    }
  }, [props.isOpen, props.initialHref]);

  // Pageを選んでいる間はwiki linkの挿入、選んでいなければURLリンクの適用。
  const pageMode = pageId !== "";
  const valid = pageMode ? true : isValidLinkHref(href);
  const submit = () => {
    if (pageMode) {
      const label = pageLabel.trim();
      props.onInsertPageLink(
        formatWikiLink({ target: pageId, ...(label ? { label } : {}) })
      );
      return;
    }
    if (!valid) {
      setTouched(true);
      return;
    }
    props.onSubmit(href.trim());
  };

  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      isDismissable
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <Heading slot="title">
            {props.isActive ? t("link.editTitle") : t("link.insertTitle")}
          </Heading>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {props.pages.length > 0 && (
              <label className={styles.field}>
                <span>{t("link.pageLabel")}</span>
                <select
                  value={pageId}
                  onChange={(event) => {
                    const selected = event.target.value;
                    setPageId(selected);
                    // 表示名の既定値は選択時点のtitle。以後は自動同期しない。
                    setPageLabel(
                      props.pages.find((page) => page.name === selected)?.title ?? ""
                    );
                  }}
                >
                  <option value="">{t("link.pagePlaceholder")}</option>
                  {props.pages.map((page) => (
                    <option key={page.name} value={page.name}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pageMode ? (
              <label className={styles.field}>
                <span>{t("link.pageTextLabel")}</span>
                <input
                  value={pageLabel}
                  placeholder={t("link.pageTextPlaceholder")}
                  onChange={(event) => setPageLabel(event.target.value)}
                />
              </label>
            ) : (
              <label className={styles.field}>
                <span>{t("link.urlLabel")}</span>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  value={href}
                  inputMode="url"
                  placeholder="https://example.com"
                  onChange={(event) => {
                    setHref(event.target.value);
                    setTouched(true);
                  }}
                />
              </label>
            )}
            {touched && !valid && (
              <p className={styles.error} role="alert">
                {t("link.invalid")}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                className={styles.secondary}
                onPress={props.onCancel}
              >
                {t("link.cancel")}
              </Button>
              {props.isActive && (
                <Button className={styles.danger} onPress={props.onRemove}>
                  {t("link.remove")}
                </Button>
              )}
              <Button
                className={styles.primary}
                isDisabled={!valid}
                onPress={submit}
              >
                {props.isActive ? t("link.update") : t("link.insert")}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
