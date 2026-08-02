import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { PageSummary } from "@vellym-internal/core";
import styles from "./link-dialog.module.css";

// Milkdown側も適用時にサニタイズするが、明らかに危険なスキームはここでも弾く。
// 絶対URL・mailto・アプリ内ハッシュリンク(#page=slug)・相対pathを許可する。
export function isValidLinkHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (/^(javascript|data|vbscript):/i.test(href)) return false;
  if (/^(https?:|mailto:)/i.test(href)) return true;
  // 相対pathとページ内／アプリ内アンカー。
  return /^[#./]/.test(href) || !href.includes(":");
}

export function LinkDialog(props: {
  isOpen: boolean;
  initialHref: string;
  isActive: boolean;
  pages: PageSummary[];
  onSubmit(href: string): void;
  onRemove(): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const [href, setHref] = useState(props.initialHref);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (props.isOpen) {
      setHref(props.initialHref);
      setTouched(false);
    }
  }, [props.isOpen, props.initialHref]);

  const valid = isValidLinkHref(href);
  const submit = () => {
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
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setHref(`#page=${event.target.value}`);
                    setTouched(true);
                  }}
                >
                  <option value="">{t("link.pagePlaceholder")}</option>
                  {props.pages.map((page) => (
                    <option key={page.name} value={page.slug ?? page.name}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
