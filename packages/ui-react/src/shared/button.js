import { jsx as _jsx } from "react/jsx-runtime";
import styles from "./button.module.css";
/**
 * ボタン。**画面ごとにクラス名の文字列を書き写さない。**
 *
 * `type`の既定を`"button"`にしてある。省略したボタンがフォームを送信して
 * しまう事故を、部品側で塞ぐ。
 *
 * 見た目の差は`tone`で選ぶ。`className`も受け取れるが、それは配置のための
 * ものであり、色や大きさをここで上書きしない。
 */
export function Button({ tone = "default", icon, className, type, ...rest }) {
    const classes = [
        styles.button,
        tone === "primary" ? styles.primary : "",
        tone === "danger" ? styles.danger : "",
        icon ? styles.icon : "",
        className ?? ""
    ]
        .filter(Boolean)
        .join(" ");
    return _jsx("button", { type: type ?? "button", className: classes, ...rest });
}
//# sourceMappingURL=button.js.map