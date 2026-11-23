import type {
  Diagnostic,
  PageSummary
} from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { resolveLocalizedText } from "@vellym/plugin-api";
import { Button } from "../shared/button.js";

export function Sidebar(props: {
  pages: PageSummary[];
  diagnostics: Diagnostic[];
  selected?: string;
  onSelect(name: string): void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">D</span>
        <div>
          <strong>Vellym</strong>
          <small>{t("sidebar.projectDocuments")}</small>
        </div>
      </div>
      <nav aria-label={t("nav.documents")}>
        {props.pages.map((page) => (
          <Button
            className={props.selected === page.name ? "page-link active" : "page-link"}
            key={page.name}
            onClick={() => props.onSelect(page.name)}
          >
            <span>{page.title}</span>
            <small>{page.relativePath}</small>
          </Button>
        ))}
      </nav>
      <div className="diagnostics">
        <strong>{t("sidebar.diagnosticsCount", { count: props.diagnostics.length })}</strong>
        {props.diagnostics.slice(0, 5).map((item, index) => (
          <p key={`${item.file}-${item.code}-${index}`}>
            {item.file}: {resolveLocalizedText(item.message, i18n.language)}
          </p>
        ))}
      </div>
    </aside>
  );
}
