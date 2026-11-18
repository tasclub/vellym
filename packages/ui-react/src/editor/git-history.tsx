import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalizedPageProjection, PageView } from "@vellym-internal/core";
import { useTranslation } from "react-i18next";
import { fetchGitContent, fetchGitDiff, fetchGitHistory, isStaticApp, type GitHistoryData } from "../shared/api.js";
import { ChoiceControl } from "../shared/choice-control.js";
import { DocumentView } from "./view.js";
import { GitDiff } from "./git-diff.js";
import styles from "./git-history.module.css";

/**
 * A historical projection is deliberately not mixed into the live editor or its relations.
 * The server validates and projects the old version, so the browser never bundles the Ajv compiler.
 */
export function historicalPage(projected: LocalizedPageProjection | undefined, current: PageView): PageView | undefined {
  if (!projected) return;
  return { ...projected, relativePath: current.relativePath, hash: "", readOnly: true, readOnlyReasons: [] };
}

type History = GitHistoryData & { shallow: boolean };
export function HistoryDocument({ view, headerActions, beforeBody, onNavigatePage, onOpenChanges }: {
  view: PageView; headerActions?: ReactNode; beforeBody?: ReactNode;
  onNavigatePage?(pageId: string, heading?: string): void;
  onOpenChanges?(): void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(() => !isStaticApp() && new URLSearchParams(window.location.search).has("history"));
  const [requestedCommit, setRequestedCommit] = useState(() => new URLSearchParams(window.location.search).get("commit"));
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState("previous");
  const [version, setVersion] = useState(false);
  const [diff, setDiff] = useState<string>();
  const [diffError, setDiffError] = useState(false);
  const [past, setPast] = useState<PageView>();
  const [pastLoading, setPastLoading] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const entry = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const path = view.relativePath;
  useEffect(() => {
    const restore = () => { setOpen(!isStaticApp() && new URLSearchParams(window.location.search).has("history")); setRequestedCommit(new URLSearchParams(window.location.search).get("commit")); setVersion(false); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (isStaticApp()) return;
    const controller = new AbortController();
    setHistory(undefined); setError(false); setSelected(0); setVersion(false); setMode("previous");
    void (async () => {
      let { data } = await fetchGitHistory(path, 50, controller.signal);
      const requested = requestedCommit;
      while (requested && data.available && !data.commits.some((c) => c.hash === requested) && data.nextOffset !== null) {
        const next = await fetchGitHistory(path, 50, controller.signal, data.nextOffset);
        if (!next.data.available) break;
        data = { ...data, commits: [...data.commits, ...next.data.commits], nextOffset: next.data.nextOffset };
      }
      return { data };
    })().then(({ data }) => {
      if (controller.signal.aborted) return;
      if (data.available && (data.tracked || data.uncommitted)) {
        setHistory(data);
        const requested = requestedCommit;
        const index = data.commits.findIndex((c) => c.hash === requested);
        if (index >= 0) setSelected(index + (data.uncommitted ? 1 : 0));
      }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [path, view.hash, attempt, requestedCommit]);
  useEffect(() => { if (open && history && !version) list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); }, [open, !!history, version]);
  const rows = history ? [...(history.uncommitted ? [undefined] : []), ...history.commits] : [];
  const commit = rows[selected];
  const previous = rows[selected + 1];
  useEffect(() => {
    if (!open || !history) return;
    if (!rows.length) { setDiff(""); return; }
    const controller = new AbortController();
    setDiff(undefined); setDiffError(false);
    // The extra page is needed when selecting the last row of a non-final batch.
    if (commit && mode === "previous" && !previous && history.nextOffset !== null) {
      void fetchGitHistory(path, 50, controller.signal, history.nextOffset).then(({ data }) => {
        if (!controller.signal.aborted && data.available) setHistory((old) => old && ({ ...old, commits: [...old.commits, ...data.commits], nextOffset: data.nextOffset }));
      }).catch(() => { if (!controller.signal.aborted) setDiffError(true); });
    } else {
      const from = !commit ? undefined : mode === "current" ? commit.hash : previous?.hash ?? "";
      const to = commit && mode === "previous" ? commit.hash : undefined;
      void fetchGitDiff(path, from, to, controller.signal, "all").then(({ data }) => {
        if (controller.signal.aborted) return;
        if (data.available) setDiff(data.diff); else setDiffError(true);
      }).catch(() => { if (!controller.signal.aborted) setDiffError(true); });
    }
    return () => controller.abort();
  }, [open, history, selected, mode, path]);
  useEffect(() => {
    if (!version || !commit) return;
    const controller = new AbortController();
    setPast(undefined); setPastLoading(true);
    void fetchGitContent(path, commit.hash, controller.signal, view.locale ?? view.baseLocale ?? "en", view.baseLocale ?? "en").then(({ data }) => {
      if (!controller.signal.aborted && data.available) setPast(historicalPage(data.view, view));
    }).catch(() => { /* Unreadable versions keep their diff available. */ }).finally(() => { if (!controller.signal.aborted) setPastLoading(false); });
    return () => controller.abort();
  }, [version, commit?.hash, path, view.locale]);
  const navigate = (value: boolean) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("history", ""); else { url.searchParams.delete("history"); url.searchParams.delete("commit"); }
    window.history.pushState(null, "", url);
    setOpen(value); setVersion(false);
    if (!value) setRequestedCommit(null);
    if (!value) requestAnimationFrame(() => entry.current?.focus());
  };
  const relativeDate = (date: string) => {
    const days = Math.round((new Date(date).getTime() - Date.now()) / 86400000);
    return new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }).format(days, "day");
  };
  if (!open || (!history && !error)) return <DocumentView view={view} beforeBody={beforeBody} onNavigatePage={onNavigatePage} headerActions={<>{headerActions}{onOpenChanges && <button onClick={onOpenChanges}>{t("changes.documentChanged")}</button>}{history && <button ref={entry} onClick={() => navigate(true)}>{t("git.history")}</button>}</>} />;
  const comparison = !commit ? `${history?.commits[0]?.hash.slice(0, 7) ?? "∅"} → ${t("git.current")}` : `${mode === "previous" ? previous?.hash.slice(0, 7) ?? "∅" : commit.hash.slice(0, 7)} → ${mode === "previous" ? commit.hash.slice(0, 7) : t("git.current")}`;
  return <div className={styles.history}>
    <div className={styles.toolbar}><h1>{view.page.metadata.title} — {t("git.history")}</h1><button onClick={() => navigate(false)}>{t("git.back")}</button></div>
    {error ? <div role="alert">{t("git.historyError")} <button onClick={() => setAttempt(attempt + 1)}>{t("git.retry")}</button></div> : version && commit ? <>
      <div className="notice" role="status">{t("git.reading", { date: new Date(commit.date).toLocaleString(i18n.language), hash: commit.hash.slice(0, 7) })}
        <div className={styles.toolbar}><button onClick={() => navigate(false)}>{t("git.currentVersion")}</button><button onClick={() => { setVersion(false); setMode("current"); }}>{t("git.versionDiff")}</button></div>
      </div>
      {pastLoading ? <p role="status">{t("git.loading")}</p> : past ? <DocumentView view={past} onNavigatePage={onNavigatePage} /> : <p>{t("git.unreadable")}</p>}
    </> : <div className={styles.content}>
      <section>
        {!history?.commits.length && <p>{t("git.noHistory")}</p>}
        <div className={styles.commits} ref={list} role="listbox" aria-label={t("git.commits")}>
          {rows.map((row, index) => <div key={row?.hash ?? "working"} className={styles.option} role="option" aria-selected={selected === index} tabIndex={index === selected ? 0 : -1}
            onClick={() => { setSelected(index); setMode("previous"); }} onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0)));
              setSelected(next); setMode("previous");
              (list.current?.children[next] as HTMLElement | undefined)?.focus();
            }}>
            {row ? <><time dateTime={row.date} title={new Date(row.date).toLocaleString(i18n.language)}>{relativeDate(row.date)}</time> · {row.author}<div>{row.subject}</div><span>{row.hash.slice(0, 7)}</span>{row.rename && <small>{t("git.rename", row.rename)}</small>}</> : t("git.uncommitted")}
          </div>)}
        </div>
        {commit && <button onClick={() => { void navigator.clipboard?.writeText(commit.hash).catch(() => {}); }}>{t("git.copyHash", { hash: commit.hash.slice(0, 7) })}</button>}
        {history?.nextOffset !== null && history?.nextOffset !== undefined && <button disabled={moreBusy} onClick={() => {
          setMoreBusy(true); setMoreError(false);
          void fetchGitHistory(path, 50, undefined, history.nextOffset!).then(({ data }) => {
            if (data.available) setHistory((old) => old && ({ ...old, commits: [...old.commits, ...data.commits], nextOffset: data.nextOffset }));
          }).catch(() => setMoreError(true)).finally(() => setMoreBusy(false));
        }}>{t("git.more")}</button>}
        {moreError && <p role="alert">{t("git.historyError")}</p>}
        {history?.shallow && history.nextOffset === null && <p>{t("git.shallow")}</p>}
      </section>
      <section className={styles.diff}>
        {commit && <div className={styles.toolbar}><ChoiceControl mode="segmented" aria-label={t("git.compare")} value={mode} options={[{ value: "previous", label: t("git.previous") }, { value: "current", label: t("git.withCurrent") }]} onChange={setMode} /><button onClick={() => setVersion(true)}>{t("git.showVersion")}</button></div>}
        {diffError ? <p role="alert">{t("git.diffError")} <button onClick={() => setAttempt(attempt + 1)}>{t("git.retry")}</button></p> : diff === undefined ? <p role="status">{t("git.loading")}</p> : <GitDiff key={`${commit?.hash}:${mode}:${diff}`} source={diff} comparison={comparison} />}
      </section>
    </div>}
  </div>;
}
