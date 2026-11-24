import { ROLES, type Catalog, type FolderDef } from "./types.js";

export function validateCatalog(catalog: Catalog): void {
  const fail = (message: string): never => { throw new Error(`catalog: ${message}`); };
  const localized = (value: unknown, label: string): void => {
    if (!value || typeof value !== "object" || !("ja" in value) || !("en" in value) ||
        !(value as { ja: unknown }).ja || !(value as { en: unknown }).en) fail(`missing locale: ${label}`);
  };
  for (const [kind, definitions] of Object.entries(catalog)) {
    const ids = new Set<string>();
    for (const def of definitions) {
      if (!def.id || ids.has(def.id)) fail(`duplicate or missing ${kind} id: ${def.id}`);
      ids.add(def.id);
    }
  }
  for (const structure of catalog.structures) {
    const folders = new Set<string>();
    const visit = (nodes: FolderDef[]): void => {
      for (const folder of nodes) {
        if (!folder.id || folders.has(folder.id)) fail(`duplicate folder id: ${folder.id}`);
        folders.add(folder.id);
        localized(folder.name, `${structure.id}/${folder.id}`);
        if (folder.role && !ROLES.includes(folder.role)) fail(`unknown role: ${folder.role}`);
        if (folder.children) visit(folder.children);
      }
    };
    visit(structure.folders);
    if (!structure.supplement) for (const role of ROLES) {
      const target = structure.roleMap[role];
      if (!target || !folders.has(typeof target === "string" ? target : target.folderId)) fail(`missing role mapping: ${structure.id}/${role}`);
    }
  }
  for (const template of catalog.templates) {
    if (!ROLES.includes(template.role)) fail(`unknown template role: ${template.role}`);
    for (const key of ["title", "fileName", "body", "description"] as const) localized(template[key], `${template.id}/${key}`);
  }
  for (const tracker of catalog.trackers) for (const key of ["title", "description", "spec"] as const) localized(tracker[key], `${tracker.id}/${key}`);
  for (const set of catalog.sets) {
    localized(set.title, `${set.id}/title`);
    localized(set.description, `${set.id}/description`);
    for (const item of set.items) {
      if ("template" in item ? !catalog.templates.some(t => t.id === item.template) : !catalog.trackers.some(t => t.id === item.tracker)) fail(`unknown set item: ${set.id}`);
    }
    if (set.repeat) {
      localized(set.repeat.folderName, `${set.id}/repeat`);
      if (!catalog.templates.some(t => t.id === set.repeat!.page)) fail(`unknown repeat page: ${set.id}`);
    }
  }
}
