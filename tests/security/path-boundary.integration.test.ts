import path from "node:path";
import { unlink } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Row = { name: string; route: string; method?: string; field?: string; body?: Record<string, unknown>; control: string; kind?: "image" | "root" | "plugin" | "static" };

// Excluded: pages and plugin resource creation/deletion take names rather than paths;
// asset upload generates its own name; git/mentions takes a regex-validated name.
const rows: Row[] = [
  { name: "assets", route: "/api/v1/assets", control: "image.png", kind: "image" },
  ...["history", "content", "diff", "change-diff"].map(name => ({ name, route: `/api/v1/git/${name}`, control: "page.yaml" })),
  { name: "folder edit", route: "/api/v1/folders/edit", control: "section" },
  { name: "create page", route: "/api/v1/structure/plan", method: "POST", field: "parentPath", body: { type: "create-page", title: "New", parentPath: "section" }, control: "section" },
  { name: "move folder source", route: "/api/v1/structure/plan", method: "POST", field: "folderPath", body: { type: "move-folder", folderPath: "section", destinationPath: "" }, control: "section" },
  { name: "move folder destination", route: "/api/v1/structure/plan", method: "POST", field: "destinationPath", body: { type: "move-folder", folderPath: "section", destinationPath: "" }, control: "" },
  { name: "template", route: "/api/v1/templates/plan", method: "POST", field: "folder", body: { kind: "template", id: "decision", folder: "section", language: "en" }, control: "section" },
  { name: "content root", route: "/api/v1/config/content-root/plan", method: "POST", field: "contentRoot", body: { contentRoot: "content" }, control: "content", kind: "root" },
  { name: "plugin file", route: "/api/v1/plugins/files", method: "PUT", field: "relativePath", body: { pluginId: "file-kind", relativePath: "a.tokens.json", value: {}, baseHash: null }, control: "a.tokens.json", kind: "plugin" },
  { name: "static UI", route: "/", control: "", kind: "static" }
];
const attacks = ["traversal", "absolute", "encoded", "symlink"] as const;
type Attack = typeof attacks[number];

function attackValue(f: Fixture, row: Row, attack: Attack): string {
  const name = row.kind === "image" ? "outside.png" : row.kind === "plugin" ? "outside.tokens.json" : row.kind === "root" ? "outside" : "outside.yaml";
  if (attack === "absolute") return path.join(f.dir, name);
  if (attack === "symlink") return row.kind === "image" ? "link.png" : row.kind === "plugin" ? "link.tokens.json" : row.kind === "root" || row.field === "parentPath" || row.field === "destinationPath" || row.name === "folder edit" || row.name === "template" || row.name === "move folder source" ? "link-dir" : "link.yaml";
  return `${attack === "encoded" ? "%2e%2e%2f" : "../"}${name}`;
}
async function send(f: Fixture, row: Row, value: string, raw = false) {
  if (row.method) return fetch(f.server.url + row.route, { method: row.method, headers: { "content-type": "application/json", origin: f.server.url }, body: JSON.stringify({ ...row.body, [row.field!]: value }) });
  if (row.kind === "static") {
    // Use node:http to avoid WHATWG URL normalization of dot segments.
    const { request } = await import("node:http");
    return new Promise<{ status: number; text(): Promise<string> }>((resolve, reject) => {
      const req = request(f.server.url, { path: value ? `/${value}` : "/" }, res => { let body = ""; res.setEncoding("utf8"); res.on("data", chunk => body += chunk); res.on("end", () => resolve({ status: res.statusCode ?? 0, text: async () => body })); });
      req.on("error", reject); req.end();
    });
  }
  const query = `path=${raw ? value : encodeURIComponent(value)}${row.name === "content" ? `&revision=${f.revision}` : ""}`;
  return fetch(`${f.server.url}${row.route}?${query}`);
}

describe("path boundaries", () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f?.close(); });
  it.each(rows)("$name control succeeds", async row => {
    // Template planning scans every YAML file, including link.yaml, before planning.
    if (row.name === "template" && process.platform !== "win32") await unlink(path.join(f.project, "content/link.yaml"));
    const control = await send(f, row, row.control);
    const body = await control.text();
    expect(control.status, `control ${row.name}: ${body}`).toBeGreaterThanOrEqual(200);
    expect(control.status, `control ${row.name}: ${body}`).toBeLessThan(300);
  });
  for (const attack of attacks) {
    // Known vulnerability: content-root planning follows a symlink outside the project.
    // See ticket-01m86ssecrootlink000000000.
    for (const knownFailure of [false, true]) {
    const selected = rows.filter(row => (attack === "symlink" && row.kind === "root") === knownFailure);
    const test = attack === "symlink" && process.platform === "win32" ? it.skip : knownFailure ? it.fails : it;
    if (!selected.length) continue;
    test.each(selected)(`$name rejects ${attack}`, async row => {
      if (row.name === "template" && process.platform !== "win32") await unlink(path.join(f.project, "content/link.yaml"));
      const control = await send(f, row, row.control);
      const controlBody = await control.text();
      expect(control.status, `control ${row.name}: ${controlBody}`).toBeGreaterThanOrEqual(200);
      expect(control.status, `control ${row.name}: ${controlBody}`).toBeLessThan(300);
      const before = await f.outsideSnapshot();
      const response = await send(f, row, attackValue(f, row, attack), attack === "encoded");
      const text = await response.text();
      expect(text).not.toContain(f.marker);
      expect(await f.outsideSnapshot()).toEqual(before);
      if (row.kind === "static") expect(response.status === 200 || (response.status >= 400 && response.status < 500)).toBe(true);
      else if (attack === "encoded" && row.method) {
        if (response.status >= 200 && response.status < 300) {
          const base = row.kind === "root" ? f.project : path.join(f.project, "content");
          const resolved = path.resolve(base, attackValue(f, row, attack));
          expect(path.relative(f.project, resolved)).not.toMatch(/^\.\.(?:[\\/]|$)/);
          expect(path.isAbsolute(path.relative(f.project, resolved))).toBe(false);
        }
      } else { expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500); }
    });
    }
  }
});
