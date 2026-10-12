import type { InputHTMLAttributes } from "react";
import styles from "./input-control.module.css";

/** Host-styled native input for plugin-owned forms and toolbars. */
export function InputControl({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const classes = [styles.input, type === "checkbox" ? styles.checkbox : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <input type={type} className={classes} {...props} />;
}
