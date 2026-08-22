import type { ReactNode } from "react";
import {
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay
} from "react-aria-components";

import styles from "./dialog.module.css";

/**
 * ダイアログ。**素の`div`で作らない。**
 *
 * `role="dialog"`と`aria-modal`を書くだけでは、焦点の閉じ込め、Escapeで閉じる、
 * 閉じたあと元の位置へ焦点を戻す、背後の読み上げを止める、のいずれも起きない。
 * ここは`react-aria-components`に任せ、画面ごとに書き写さない。
 *
 * 見出しは`Heading slot="title"`が担う。呼ぶ側で`aria-label`を書かない。
 */
export function Dialog(props: {
  isOpen: boolean;
  title: string;
  /** 背景の押下とEscapeで閉じてよいか。作業を失う操作では`false`にする */
  dismissable?: boolean;
  onClose(): void;
  children: ReactNode;
  /** 下端へ右寄せで並べる操作。`DialogActions`を使わずに済ませたい場合は省く */
  actions?: ReactNode;
}) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={props.isOpen}
      isDismissable={props.dismissable ?? true}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Modal className={styles.modal}>
        <AriaDialog className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {props.title}
          </Heading>
          {props.children}
          {props.actions ? <div className={styles.actions}>{props.actions}</div> : null}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
