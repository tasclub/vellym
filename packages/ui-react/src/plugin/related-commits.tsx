import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../shared/button.js";
import { fetchGitMentions, type GitCommit } from "../shared/api.js";
import styles from "./plugin.module.css";

/**
 * Commits whose message names this resource (ticket-01m6sy034fzn60bv6ayw7sbg2n). Loaded after
 * the detail is shown so a large history never delays it; live mode only.
 */
export function RelatedCommits(props: { name: string; locale: string }) {
  const { t } = useTranslation();
  const [commits, setCommits] = useState<GitCommit[]>();
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const load = (offset: number, signal?: AbortSignal) => fetchGitMentions(props.name, 20, signal, offset)
    .then(({ data }) => {
      if (signal?.aborted) return;
      if (!data.available) { setState("unavailable"); return; }
      setCommits((current) => offset === 0 ? data.commits : [...(current ?? []), ...data.commits]);
      setNextOffset(data.nextOffset);
      setState("ready");
    })
    .catch(() => { if (!signal?.aborted) setState("error"); });
  useEffect(() => {
    const controller = new AbortController();
    setState("loading"); setCommits(undefined);
    void load(0, controller.signal);
    return () => controller.abort();
  }, [props.name]);
  const date = new Intl.DateTimeFormat(props.locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section className={styles["plugin-detail-referenced"]} aria-labelledby="plugin-related-commits">
      <h2 id="plugin-related-commits">{t("plugin.relatedCommits")}</h2>
      {state === "loading" ? <p role="status">{t("git.loading")}</p>
        : state === "unavailable" ? <p>{t("plugin.relatedCommitsUnavailable")}</p>
        : state === "error" ? <p role="alert">{t("plugin.relatedCommitsError")}</p>
        : !commits?.length ? <p>{t("plugin.relatedCommitsNone")} {t("plugin.relatedCommitsHint", { name: props.name })}</p>
        : <>
          <ul>
            {commits.map((commit) => (
              <li key={commit.hash}>
                <span>{commit.subject}</span>
                <span className={styles["plugin-detail-note"]}>
                  {commit.author} · <time dateTime={commit.date}>{date.format(new Date(commit.date))}</time> ·{" "}
                  <Button className={styles["plugin-detail-referenced-link"]}
                    aria-label={t("git.copyHash", { hash: commit.hash.slice(0, 7) })}
                    onClick={() => void navigator.clipboard?.writeText(commit.hash)}>
                    <code>{commit.hash.slice(0, 7)}</code>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {nextOffset !== null ? <Button onClick={() => void load(nextOffset)}>{t("git.more")}</Button> : null}
        </>}
    </section>
  );
}
