import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Catalog, DocumentTemplateDef, ResourceTemplateDef } from "./types.js";
import { validateCatalog } from "./validate.js";

let cached: Catalog | undefined;
export function loadCatalog(resources: ResourceTemplateDef[] = []): Catalog {
  if (cached) {
    if (!resources.length) return cached;
    const catalog = { ...cached, resources };
    validateCatalog(catalog);
    return catalog;
  }
  // In the bundled CLI import.meta.url is dist/cli.mjs; source execution uses catalog/load.ts.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = here.endsWith(`${path.sep}catalog`)
    ? path.join(here, "../setup-packs/v3")
    : path.join(here, "setup-packs/v3");
  const read = (folder: string): any[] => readdirSync(path.join(root, folder))
    .filter(name => name.endsWith(".json")).sort()
    .map(name => JSON.parse(readFileSync(path.join(root, folder, name), "utf8")));
  const templates: DocumentTemplateDef[] = read("templates").map(template => ({
    ...template,
    body: {
      ja: readFileSync(path.join(root, "templates", `${template.id}.ja.md`), "utf8"),
      en: readFileSync(path.join(root, "templates", `${template.id}.en.md`), "utf8")
    }
  }));
  const catalog: Catalog = { structures: read("structures"), templates, resources: [], sets: read("sets") };
  validateCatalog(catalog);
  cached = catalog;
  return loadCatalog(resources);
}
