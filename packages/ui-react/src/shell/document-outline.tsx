import { useEffect, useRef, useState } from "react";
import type { DocumentHeading } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { Button } from "../shared/button.js";
import { Icon } from "../shared/icon.js";
import styles from "./document-outline.module.css";

export function DocumentOutline(props: {
  headings: DocumentHeading[];
  pageId?: string;
  compact?: boolean;
  onSelect(id: string): void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(props.headings[0]?.id);
  const [copyResult, setCopyResult] = useState<"success" | "failure">();
  const copyTimer = useRef<number | undefined>(undefined);
  const focusedLocation = useRef<string | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  function showCopyResult(result: "success" | "failure") {
    window.clearTimeout(copyTimer.current);
    setCopyResult(result);
    copyTimer.current = window.setTimeout(() => setCopyResult(undefined), 3000);
  }

  async function copyLink() {
    try {
      const url = new URL(window.location.href);
      let hash = url.hash.slice(1);
      try {
        hash = decodeURIComponent(hash);
      } catch {
        // A malformed hash cannot identify a heading.
      }
      const id = props.headings.find((heading) => heading.id === hash)?.id ?? current;
      if (!id) throw new Error("No heading");
      url.hash = id;
      await navigator.clipboard.writeText(url.toString());
      showCopyResult("success");
    } catch {
      showCopyResult("failure");
    }
  }

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

  useEffect(() => {
    // Deep links can load the Page and its heading DOM after the router's
    // initial focus request; focus again once this outline has the headings.
    const encodedHash = new URL(window.location.href).hash.slice(1);
    if (!encodedHash) return;
    let id: string;
    try {
      id = decodeURIComponent(encodedHash);
    } catch {
      return;
    }
    if (!props.headings.some((heading) => heading.id === id)) return;

    const location = `${props.pageId ?? ""}\0${window.location.pathname}${window.location.hash}`;
    if (focusedLocation.current === location) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (!target) return;
      if (document.activeElement !== target) {
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      }
      focusedLocation.current = location;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.headings, props.pageId]);

  const list = props.headings.length ? (
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
  const copyLinkLabel = t("outline.copyLink");
  const contents = (
    <>
      <div className={styles.heading}>
        <h2>{t("outline.title")}</h2>
        <Button
          className={styles.copyButton}
          icon
          aria-label={copyLinkLabel}
          title={copyLinkLabel}
          disabled={!props.headings.length}
          onClick={copyLink}
        >
          <Icon name="link" />
        </Button>
      </div>
      <p className={styles.copyResult} role="status" aria-live="polite">
        {copyResult && t(copyResult === "success" ? "outline.linkCopied" : "outline.copyFailed")}
      </p>
      {list}
    </>
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
      {contents}
    </nav>
  );
}
