import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { SupportedLanguage } from "@vellym-internal/core";
import ja from "../locales/ja.json";
import en from "../locales/en.json";

void i18next.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en }
  },
  lng: "ja",
  fallbackLng: "ja",
  // 翻訳キーは入れ子ではなくドット区切りの平坦な識別子（例 "wizard.step.intro"）なので、
  // i18next既定の"."によるキー入れ子解釈を無効にする。
  keySeparator: false,
  interpolation: { escapeValue: false }
});

export function setUiLanguage(language: SupportedLanguage): void {
  void i18next.changeLanguage(language);
}

export { i18next };
