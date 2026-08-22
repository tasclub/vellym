import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./shell/app.js";
import { i18next } from "./shared/i18n.js";
import "./styles.css";

// SPAが最初にURLを書き換えた後も、faviconを入口HTMLを基準に読ませる。
// 相対URLのままでは`/pages/<slug>/`を基準に再解決され、存在しない場所を
// 取りに行く。getterが返す絶対URLを書き戻せば、静的・動的の両方で固定できる。
const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
if (icon) icon.setAttribute("href", icon.href);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18next}>
      <App />
    </I18nextProvider>
  </StrictMode>
);
