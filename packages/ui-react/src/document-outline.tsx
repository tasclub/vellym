import { useEffect, useState } from "react";
import type { DocumentHeading } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import styles from "./document-outline.module.css";

export function DocumentOutline(props: {
  headings: DocumentHeading[];
  pageId?: string;
  compact?: boolean;
  onSelect(id: string): void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(props.headings[0]?.id);

  useEffect(() => {
    setCurrent(props.headings[0]?.id);
    let frame = 0;
    function update() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        let active = props.headings[0]?.id;
        for (const heading of props.headings) {
          const element = document.getElementById(heading.id);
          if (element && element.getBoundingClientRect().top <= 150) {
            active = heading.id;
          }
        }
        setCurrent(active);
      });
    }
    update();
    const scrollRoot = document.getElementById("document-content");
    scrollRoot?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scrollRoot?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [props.headings]);

  const contents = props.headings.length ? (
    <ol className={styles.list}>
      {props.headings.map((heading) => (
        <li
          key={heading.id}
          className={styles.item}
          data-depth={heading.depth}
          data-current={current === heading.id || undefined}
        >
          <a
            href={`#${heading.id}`}
            aria-current={current === heading.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              props.onSelect(heading.id);
            }}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  ) : (
    <p className={styles.empty}>{t("outline.empty")}</p>
  );

  if (props.compact) {
    return (
      <details className={styles.compact}>
        <summary>{t("outline.compactSummary")}</summary>
        {contents}
      </details>
    );
  }
  return (
    <nav className={styles.outline} aria-label={t("outline.compactSummary")}>
      <h2>{t("outline.title")}</h2>
      {contents}
    </nav>
  );
}
