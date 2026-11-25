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
        localized(folder.description, `${structure.id}/${folder.id}/description`);
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
    if (template.guideText !== undefined) localized(template.guideText, `${template.id}/guideText`);
  }
  for (const resource of catalog.resources) {
    if (typeof resource.pluginId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resource.pluginId) ||
        typeof resource.id !== "string" || !resource.id.startsWith(`${resource.pluginId}:`) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resource.id.slice(resource.pluginId.length + 1)) ||
        typeof resource.kind !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(resource.kind)) fail(`invalid resource: ${resource.id}`);
    for (const key of ["group", "title", "description", "spec", "fileName"] as const) localized(resource[key], `${resource.id}/${key}`);
    for (const language of ["ja", "en"] as const) {
      for (const key of ["group", "title", "description", "fileName"] as const) {
        if (typeof resource[key][language] !== "string") fail(`invalid resource ${key}: ${resource.id}`);
      }
      if (!resource.spec[language] || typeof resource.spec[language] !== "object" || Array.isArray(resource.spec[language])) fail(`invalid resource spec: ${resource.id}`);
      if (!/^[^/\\\0]+\.ya?ml$/i.test(resource.fileName[language]) || resource.fileName[language].startsWith(".")) fail(`invalid resource fileName: ${resource.id}`);
    }
    if (resource.guideText !== undefined) localized(resource.guideText, `${resource.id}/guideText`);
  }
  for (const set of catalog.sets) {
    localized(set.title, `${set.id}/title`);
    localized(set.description, `${set.id}/description`);
    for (const item of set.items) {
      // Resources may belong to a plugin that is not enabled.
      if ("template" in item ? !catalog.templates.some(t => t.id === item.template) : !("resource" in item) || !/^[a-z0-9-]+:[a-z0-9-]+$/.test(item.resource)) fail(`unknown set item: ${set.id}`);
    }
    if (set.repeat) {
      localized(set.repeat.folderName, `${set.id}/repeat`);
      if (!catalog.templates.some(t => t.id === set.repeat!.page)) fail(`unknown repeat page: ${set.id}`);
    }
  }
}
