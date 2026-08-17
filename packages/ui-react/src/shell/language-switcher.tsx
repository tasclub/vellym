import { localeDisplayName } from "@vellym-internal/core";
import type { PageView } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { documentPagePath } from "./routing.js";

export function LanguageSwitcher(props: {
  page: PageView;
  currentLocale: string;
  uiLocale: string;
  slug: string;
  heading?: string;
}) {
  const { t } = useTranslation();
  const locales = props.page.availableLocales ?? [];
  if (locales.length <= 1) return null;
  return (
    <nav className="language-switcher" aria-label={t("language.label")}>
      {locales.map((locale) => {
        const current = locale === props.currentLocale;
        return (
          <a
            key={locale}
            href={documentPagePath(locale, props.slug, props.heading)}
            hrefLang={locale}
            lang={locale}
            aria-current={current ? "page" : undefined}
            data-translation="available"
          >
            {localeDisplayName(locale, props.uiLocale)}
          </a>
        );
      })}
    </nav>
  );
}
