import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PageSummary } from "@vellym-internal/core";
import { fetchChangeDiff, fetchGitRecent, writeGit, type GitStatus, type GitWriteResult, type GitCommit } from "../shared/api.js";
import { GitDiff } from "../editor/git-diff.js";
import { Button } from "../shared/button.js";
import styles from "./git-changes.module.css";

type Recent = GitCommit & { files: Array<{ path: string; status: string; title?: string }> };
export function GitChanges({ status, pages, unsaved, initialPath, refresh, onHistory }: {
  status: Extract<GitStatus, { available: true }>; pages: PageSummary[]; unsaved: boolean; initialPath?: string;
  refresh(): Promise<void>; onHistory(page: PageSummary, hash: string): void;
}) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<string[]>(status.files.map((f) => f.path));
  const [file, setFile] = useState(initialPath ?? status.files[0]?.path);
  const [diff, setDiff] = useState<string>();
  const [diffError, setDiffError] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"commit" | "push">();
  const busyRef = useRef(false);
  const [error, setError] = useState<Extract<GitWriteResult, { ok: false }>>();
  const [notice, setNotice] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [recentError, setRecentError] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const signature = JSON.stringify(status.files);
  useEffect(() => { setSelected(status.files.map((f) => f.path)); }, [signature]);
  useEffect(() => { if (initialPath) setFile(initialPath); }, [initialPath]);
  useEffect(() => {
    const controller = new AbortController();
    setRecentError(false);
    void fetchGitRecent(30, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted && data.available) { setRecent(data.commits); setOffset(data.nextOffset); }
    }).catch(() => { if (!controller.signal.aborted) setRecentError(true); });
    return () => controller.abort();
  }, [revision, signature]);
  useEffect(() => {
    if (!file || !status.files.some((f) => f.path === file)) { setDiff(""); return; }
    const controller = new AbortController(); setDiff(undefined); setDiffError(false);
    void fetchChangeDiff(file, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted && data.available) setDiff(data.diff);
    }).catch(() => { if (!controller.signal.aborted) setDiffError(true); });
    return () => controller.abort();
  }, [file, signature, revision, status]);
  const title = (path: string) => pages.find((p) => p.relativePath === path)?.title ?? status.files.find((f) => f.path === path)?.title ?? path.split("/").at(-1);
  const kind = (status: string) => status.startsWith("A") ? `＋ ${t("changes.added")}` : status.startsWith("D") ? `− ${t("changes.deleted")}` : status.startsWith("R") ? `→ ${t("changes.moved")}` : `● ${t("changes.modified")}`;
  async function perform(operation: "commit" | "push") {
    if (busyRef.current) return;
    setError(undefined); setNotice("");
    if (operation === "commit" && (!message.trim() || !selected.length)) { setError({ ok: false, code: !message.trim() ? "message" : "selection" }); return; }
    busyRef.current = true; setBusy(operation);
    try {
      const { data } = await writeGit(operation, operation === "commit" ? { message, paths: selected } : {});
      if (!data.ok) setError(data);
      else {
        setNotice(t(operation === "commit" ? "changes.committed" : "changes.pushed", { hash: data.hash?.slice(0, 7) }));
        if (operation === "commit") setMessage("");
        setRevision((n) => n + 1); await refresh();
      }
    } catch { setError({ ok: false, code: "failed" }); }
    finally { busyRef.current = false; setBusy(undefined); }
  }
  return <article className={styles.changes}>
    <h1>{t("changes.title")}</h1>
    <section aria-labelledby="uncommitted-heading">
      <div className={styles.toolbar}><h2 id="uncommitted-heading">{t("changes.uncommitted")}</h2><span>{status.branch} · {t("changes.ahead", { count: status.ahead })}</span>
        {!!status.upstream && status.ahead > 0 && <Button className={styles.write} disabled={!!busy} onClick={() => void perform("push")}>{t(busy === "push" ? "changes.pushing" : "changes.push")}</Button>}
      </div>
      {!status.upstream && <p>{t("changes.noUpstream")}</p>}
      {unsaved && <p className="notice">{t("changes.unsaved")}</p>}
      {status.files.length === 0 ? <p>{t("changes.empty")}</p> : <>
        <Button onClick={() => setSelected(selected.length === status.files.length ? [] : status.files.map((f) => f.path))}>{t(selected.length === status.files.length ? "changes.clearAll" : "changes.selectAll")}</Button>
        <div className={styles.content}><ul className={styles.files}>{status.files.map((item) => <li key={item.path}>
          <input type="checkbox" aria-label={t("changes.select", { title: title(item.path) })} checked={selected.includes(item.path)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, item.path] : old.filter((p) => p !== item.path))} />
          <Button
            aria-pressed={file === item.path}
            style={{
              minHeight: "36px",
              padding: "var(--space-1) var(--space-2)",
              border: 0,
              borderRadius: "var(--radius-lg)",
              background: file === item.path ? "var(--selected-bg)" : "transparent",
              color: file === item.path ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: file === item.path ? 650 : 400
            }}
            onClick={() => setFile(item.path)}
          ><span>{kind(item.status)} · {title(item.path)}</span><small>{item.oldPath ? `${item.oldPath} → ` : ""}{item.path}</small></Button>
        </li>)}</ul><div className={styles.diff}>{diffError ? <p role="alert">{t("git.diffError")}</p> : diff === undefined ? <p>{t("git.loading")}</p> : <GitDiff source={diff} comparison={`${file ?? ""}: HEAD → ${t("git.current")}`} />}</div></div>
      </>}
      <div className={styles.write}><label htmlFor="commit-message">{t("changes.messageLabel")}</label><textarea id="commit-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!busy} />
        <Button tone="primary" disabled={!!busy} onClick={() => void perform("commit")}>{t(busy === "commit" ? "changes.committing" : "changes.commit")}</Button>
      </div>
      {error && <div role="alert">{t(`changes.${error.code}`)}{error.details && <details><summary>{t("changes.details")}</summary><pre>{error.details}</pre></details>}</div>}
      <p role="status" aria-live="polite">{notice}</p>
    </section>
    <section aria-labelledby="recent-heading"><h2 id="recent-heading">{t("changes.recent")}</h2>
      {recent.map((commit) => <details key={commit.hash}><summary><time dateTime={commit.date} title={new Date(commit.date).toLocaleString(i18n.language)}>{new Date(commit.date).toLocaleDateString(i18n.language)}</time> · {commit.author} · {commit.subject} · {commit.hash.slice(0, 7)}</summary>
        <ul>{commit.files.map((item) => { const page = pages.find((p) => p.relativePath === item.path); const label = item.title ?? title(item.path); return <li key={item.path}>{kind(item.status)} · {item.status.startsWith("D") ? <span>{label} {t("changes.deletedSuffix")}</span> : page ? <Button onClick={() => onHistory(page, commit.hash)}>{label}</Button> : <span>{label}</span>}</li>; })}</ul>
      </details>)}
      {recentError && <p role="alert">{t("git.historyError")} <Button onClick={() => setRevision((n) => n + 1)}>{t("git.retry")}</Button></p>}
      {offset !== null && <Button disabled={moreBusy} onClick={() => { setMoreBusy(true); void fetchGitRecent(30, undefined, offset).then(({ data }) => { if (data.available) { setRecent((old) => [...old, ...data.commits]); setOffset(data.nextOffset); } }).catch(() => setRecentError(true)).finally(() => setMoreBusy(false)); }}>{t("git.more")}</Button>}
    </section>
  </article>;
}
