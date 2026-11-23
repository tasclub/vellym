import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../shared/button.js";
import { ChoiceControl } from "../shared/choice-control.js";
import { DEVICE_SCOPE, HOST_OWNER, userSettingsKey } from "../shared/user-settings.js";
import { foldDiff, parseGitDiff, type DiffLine } from "./git-diff-model.js";
import styles from "./git-history.module.css";

const layoutKey = userSettingsKey(DEVICE_SCOPE, HOST_OWNER, "git.diff.layout");
export function GitDiff({ source, comparison }: { source: string; comparison: string }) {
  const { t } = useTranslation();
  const lines = useMemo(() => parseGitDiff(source), [source]);
  const chunks = useMemo(() => foldDiff(lines), [lines]);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const container = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    // Two 400px text columns, two 20px number columns and 8px cell padding.
    const observer = new ResizeObserver(([entry]) => { if (entry) setWide(entry.contentRect.width >= 848); });
    observer.observe(node);
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  const [layout, setLayout] = useState<string | undefined>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem(layoutKey) ?? "null"); return value === "unified" || value === "split" ? value : undefined; }
    catch { return undefined; }
  });
  const added = lines.filter((line) => line.kind === "add").length;
  const split = !mobile && (layout ? layout === "split" : wide);
  const removed = lines.filter((line) => line.kind === "remove").length;
  const cell = (line: DiffLine) => <><span className="visually-hidden">{line.kind === "add" ? t("git.added") : line.kind === "remove" ? t("git.removed") : ""}</span><span aria-hidden="true">{line.kind === "add" ? "+ " : line.kind === "remove" ? "− " : "  "}</span>{line.text}</>;
  return <section ref={container} className={styles.diff} aria-label={t("git.diff")} data-layout={split ? "split" : "unified"}>
    <p>{comparison} <strong aria-label={t("git.counts", { added, removed })}>+{added} −{removed}</strong></p>
    {!added && !removed ? <p>{t("git.noDiff")}</p> : <>
      <div className={styles.layoutChoice}><ChoiceControl mode="segmented" aria-label={t("git.layout")} value={split ? "split" : "unified"} options={[{ value: "split", label: t("git.split") }, { value: "unified", label: t("git.unified") }]} onChange={(value) => { setLayout(value); try { localStorage.setItem(layoutKey, JSON.stringify(value)); } catch { /* Optional preference. */ } }} /></div>
      {lines.length > 2000 && !confirmed ? <Button onClick={() => setConfirmed(true)}>{t("git.large", { count: lines.length })}</Button> :
        <table className={`${styles.table} ${split ? styles.split : ""}`}>
          <caption className="visually-hidden">{comparison}</caption>
          <colgroup><col style={{ width: "20px" }} />{split && <col />}<col style={{ width: "20px" }} /><col /></colgroup>
          <tbody>{chunks.map((chunk) => chunk.folded && !expanded.includes(chunk.start)
            ? <tr key={chunk.start}><td colSpan={split ? 4 : 3}><button
                type="button"
                style={{
                  appearance: "none",
                  display: "block",
                  width: "100%",
                  padding: "var(--space-1) var(--space-2)",
                  border: 0,
                  borderRadius: 0,
                  background: "transparent",
                  color: "var(--text-muted)",
                  textAlign: "start",
                  cursor: "pointer"
                }}
                onClick={() => setExpanded([...expanded, chunk.start])}
              >{t("git.unchanged", { count: chunk.lines.length })}</button></td></tr>
            : chunk.lines.map((line, index) => <tr key={chunk.start + index} className={styles[line.kind]}>
              <th scope="row">{line.old ?? ""}</th>{split && <td className={styles.old}>{line.kind !== "add" ? cell(line) : ""}</td>}
              <th scope="row">{line.next ?? ""}</th><td className={styles.next}>{line.kind === "remove" ? <span className={styles.unifiedRemoved}>{cell(line)}</span> : cell(line)}</td>
            </tr>))}</tbody>
        </table>}
    </>}
  </section>;
}
