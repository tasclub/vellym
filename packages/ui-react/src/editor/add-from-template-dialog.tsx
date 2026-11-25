import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, applyTemplates, previewTemplates, type InitCatalog, type InitCatalogFolder, type TemplateInput, type TemplatePlan } from "../shared/api.js";
import { Button } from "../shared/button.js";
import { Dialog } from "../shared/dialog.js";

export type AddMode = { kind: TemplateInput["kind"]; group?: string };

export function AddFromTemplateDialog(props: {
  mode: AddMode;
  catalog: InitCatalog;
  folder: string;
  language: "ja" | "en";
  onClose(): void;
  onCreated(name?: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [guide, setGuide] = useState(false);
  const [guideAvailable, setGuideAvailable] = useState(false);
  const [plan, setPlan] = useState<TemplatePlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const entries = props.mode.kind === "template" ? props.catalog.templates
    : props.mode.kind === "set" ? props.catalog.sets
      : props.catalog.resources.filter(item => item.group === props.mode.group);
  const entryRoles = (item: typeof entries[number]): string[] => "role" in item ? [item.role]
    : "items" in item ? item.items.flatMap(member => "template" in member
      ? props.catalog.templates.filter(template => template.id === member.template).map(template => template.role) : []) : [];
  const roles = [...new Set(entries.flatMap(entryRoles))];
  const visible = entries.filter(item => !role || entryRoles(item).includes(role));
  function roleLabel(value: string): string {
    for (const structure of props.catalog.structures) {
      const mapping = structure.roleMap[value];
      const id = typeof mapping === "string" ? mapping : mapping?.folderId;
      const find = (folders: InitCatalogFolder[]): string | undefined => {
        for (const folder of folders) {
          if (folder.id === id) return folder.name;
          const nested = find(folder.children ?? []);
          if (nested) return nested;
        }
      };
      const label = find(structure.folders);
      if (label) return label;
    }
    return value;
  }
  const selected = entries.find(item => item.id === id);
  const needsName = props.mode.kind === "template" || (selected && "repeat" in selected && !!selected.repeat);

  useEffect(() => {
    setPlan(undefined);
    setBusy(false);
    if (!id || (needsName && !name.trim())) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    void previewTemplates({
      kind: props.mode.kind, id, folder: props.folder, language: props.language,
      ...(name.trim() ? { name: name.trim() } : {}), guide
    }).then(result => {
      if (!cancelled) {
        setPlan(result.data);
        setGuideAvailable(result.data.guide?.available ?? false);
      }
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof ApiError && cause.status === 409
        ? t("templateAdd.conflict") : t("templateAdd.failed"));
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [id, name, guide, needsName, props.mode.kind, props.folder, props.language, t]);

  async function create() {
    if (!plan || busy || conflict) return;
    setBusy(true);
    setError("");
    try {
      await applyTemplates(plan);
      const created = plan.files.find(file => file.status !== "skip" && file.name && file.kind !== "Folder");
      await props.onCreated(props.mode.kind === "set" ? undefined : created?.name);
      props.onClose();
    } catch (cause) {
      const stale = cause instanceof ApiError && cause.status === 409;
      setConflict(stale);
      setError(t(stale ? "templateAdd.conflict" : "templateAdd.failed"));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog isOpen title={props.mode.kind === "resource"
    ? props.mode.group ?? ""
    : t(props.mode.kind === "set" ? "templateAdd.setAction" : "templateAdd.templateAction")}
    onClose={() => { if (!busy) props.onClose(); }} dismissable={!busy}
    actions={<>
      <Button onClick={props.onClose} disabled={busy}>{t("templateAdd.cancel")}</Button>
      <Button tone="primary" data-testid="template-add-create" onClick={() => void create()}
        disabled={!plan || busy || conflict}>{t("templateAdd.create")}</Button>
    </>}>
    <div data-testid="template-add-dialog" style={{ display: "grid", gap: "var(--space-4)" }}>
      {roles.length > 0 && <label>{t("templateAdd.role")}
        <select data-testid="template-add-role" value={role} onChange={event => {
          setRole(event.target.value); setId(""); setPlan(undefined); setName(""); setGuide(false);
        }}>
          <option value="">{t("templateAdd.allRoles")}</option>
          {roles.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}
        </select>
      </label>}
      <fieldset disabled={busy || conflict}>
        <legend>{t("templateAdd.choose")}</legend>
        <div style={{ maxHeight: "30vh", overflow: "auto" }}>
          {visible.map(item => <label key={item.id} style={{ display: "block", paddingBlock: "var(--space-2)" }}>
            <input type="radio" name="add-definition" data-testid={`template-add-option-${item.id}`}
              checked={id === item.id} onChange={() => {
                setId(item.id); setName(""); setGuide(false); setPlan(undefined);
              }} /> {item.title}
            <small style={{ display: "block" }}>{item.description}</small>
          </label>)}
        </div>
      </fieldset>
      {needsName && <label style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "var(--space-3)" }}>
        {t("templateAdd.name")}
        <input data-testid="template-add-name" value={name} disabled={conflict}
          onChange={event => { setName(event.target.value); setPlan(undefined); }} />
      </label>}
      {guideAvailable && <label>
        <input type="checkbox" data-testid="template-add-guide" checked={guide} disabled={busy || conflict}
          onChange={event => { setGuide(event.target.checked); setPlan(undefined); }} />
        {t("templateAdd.guide")}
      </label>}
      {plan && <section aria-label={t("templateAdd.preview")} data-testid="template-add-preview" style={{ overflowWrap: "anywhere" }}>
        <h3>{t("templateAdd.preview")}</h3>
        <ul>{plan.files.map(file => <li key={file.relativePath}>
          <strong>{t(`templateAdd.${file.status === "create" ? "createStatus" : file.status}`)}</strong>: {file.relativePath}
          {file.reason && <> — {file.reason.message[props.language]}</>}
        </li>)}</ul>
      </section>}
      {busy && <p role="status">{t("templateAdd.busy")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
