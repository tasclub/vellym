import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
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
export function Dialog(props) {
    return (_jsx(ModalOverlay, { className: styles.overlay, isOpen: props.isOpen, isDismissable: props.dismissable ?? true, onOpenChange: (open) => {
            if (!open)
                props.onClose();
        }, children: _jsx(Modal, { className: styles.modal, children: _jsxs(AriaDialog, { className: styles.dialog, children: [_jsx(Heading, { slot: "title", className: styles.title, children: props.title }), props.children, props.actions ? _jsx("div", { className: styles.actions, children: props.actions }) : null] }) }) }));
}
//# sourceMappingURL=dialog.js.map