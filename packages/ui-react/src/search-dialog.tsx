import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  type Key
} from "react-aria-components";
import { Icon } from "./icon.js";
import { fetchSearch } from "./api.js";
import styles from "./search-dialog.module.css";
import { errorMessage } from "./error-message.js";

export function SearchDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onSelect(pageId: string, headingId?: string): void;
  locale: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [indexedPages, setIndexedPages] = useState(0);
  const [diagnosticCount, setDiagnosticCount] = useState(0);
  const [state, setState] = useState<
    "initial" | "searching" | "ready" | "error"
  >("initial");
  const [message, setMessage] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.isOpen || !query.trim()) {
      setResults([]);
      setTotal(0);
      setState("initial");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState("searching");
      void fetchSearch(query, controller.signal, props.locale)
        .then((response) => {
          setResults(response.data.results);
          setTotal(response.data.total);
          setIndexedPages(response.data.indexedPages);
          setDiagnosticCount(response.diagnostics.length);
          setState("ready");
          setMessage("");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setState("error");
          setMessage(errorMessage(error, t));
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [props.isOpen, props.locale, query]);

  function openResult(key: Key) {
    const result = results.find((item) => item.pageId === key);
    if (!result) return;
    props.onSelect(result.pageId, result.heading?.id);
    props.onOpenChange(false);
  }

  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      isDismissable
    >
      <Modal className={styles.modal}>
        <Dialog aria-label={t("search.title")} className={styles.dialog}>
          <div className={styles.searchRow}>
            <Icon name="search" size={16} />
            <input
              autoFocus
              aria-label={t("search.open")}
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown") return;
                const first = listRef.current?.querySelector<HTMLElement>(
                  "[role=option]"
                );
                if (!first) return;
                event.preventDefault();
                first.focus();
              }}
            />
            <Button
              className={styles.close}
              aria-label={t("search.close")}
              onPress={() => props.onOpenChange(false)}
            >
              <Icon name="close" size={16} />
            </Button>
          </div>
          <div className={styles.status} aria-live="polite">
            {state === "initial" && t("search.promptEmpty")}
            {state === "searching" && t("search.searching")}
            {state === "ready" &&
              t("search.resultsSummary", { total, pages: indexedPages })}
            {state === "error" && message}
          </div>
          {diagnosticCount > 0 && state === "ready" && (
            <p className={styles.partial}>{t("search.partial")}</p>
          )}
          {state === "ready" && results.length === 0 ? (
            <p className={styles.zero}>{t("search.zero")}</p>
          ) : (
            <ListBox
              ref={listRef}
              aria-label={t("search.results")}
              className={styles.results}
              items={results}
              selectionMode="single"
              onAction={openResult}
            >
              {(result) => (
                <ListBoxItem
                  id={result.pageId}
                  textValue={`${result.title} ${result.snippet}`}
                  className={styles.result}
                >
                  <div className={styles.resultHeading}>
                    <strong>{result.title}</strong>
                    {result.heading && <span>{result.heading.text}</span>}
                  </div>
                  <p className={styles.path}>
                    {[t("nav.documents"), ...result.breadcrumbs].join(" / ")}
                  </p>
                  <p className={styles.snippet}>{result.snippet}</p>
                </ListBoxItem>
              )}
            </ListBox>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
