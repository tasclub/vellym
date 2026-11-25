import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startDevServer } from "../packages/runtime-node/src/server.js";
import type { InitInput, InitPlan, TemplatePlan } from "../packages/ui-react/src/shared/api.js";
import type { AddPlan } from "../packages/runtime-node/src/setup-add.js";

let root: string;
let server: Awaited<ReturnType<typeof startDevServer>>;
const init: InitInput = {
  root: "docs", structure: "by-type", numbered: false, language: "en", plugins: []
};
const add = { kind: "template", id: "decision", language: "en" };
const hostVersion = JSON.parse(await readFile("packages/vellym/package.json", "utf8")).version;

async function post(route: string, body: unknown, origin?: string) {
  return fetch(`${server.url}/api/v1/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body)
  });
}
async function preview<T>(route: string, input: unknown): Promise<T> {
  const response = await post(`${route}/plan`, input);
  expect(response.status).toBe(200);
  return (await response.json()).data;
}
async function initialize(input = init) {
  const plan = await preview<InitPlan>("setup", input);
  expect((await post("setup/apply", plan)).status).toBe(200);
  return plan;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vellym-setup-api-"));
  const ui = path.join(root, "ui");
  await mkdir(ui);
  await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>");
  // Deliberately absent: the selected management root must replace this path.
  server = await startDevServer({
    configPath: path.join(root, "vellym.config.yaml"), uiRoot: ui, hostVersion, port: 0
  });
});
afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe("setup and template HTTP APIs", () => {
  it.each(["docs", "vellym", "."])("initializes %s and activates its configuration", async selectedRoot => {
    const before = await readdir(root);
    const plan = await preview<InitPlan>("setup", { ...init, root: selectedRoot });
    expect(await readdir(root)).toEqual(before);
    expect(plan.configPath).toBe(path.join(root, selectedRoot, "vellym.config.yaml"));
    expect((await post("setup/apply", plan)).status).toBe(200);
    const bootstrap = await (await fetch(`${server.url}/api/v1/bootstrap`)).json();
    expect(bootstrap.data).toMatchObject({
      state: "ready",
      project: { configPath: path.relative(root, plan.configPath), resolvedContentRoot: path.dirname(plan.configPath) },
      capabilities: { setup: false, repository: true }
    });
    expect((await fetch(`${server.url}/api/v1/repository`)).status).toBe(200);
    expect((await post("setup/plan", init)).status).toBe(409);
    expect((await post("setup/apply", plan)).status).toBe(409);
  });

  it("localizes the complete catalog, removes profiles and gates additions", async () => {
    const en = (await (await fetch(`${server.url}/api/v1/setup/catalog?language=en`)).json()).data;
    const ja = (await (await fetch(`${server.url}/api/v1/setup/catalog?language=ja`)).json()).data;
    expect(en.structures.find((item: { id: string }) => item.id === "by-type")).toMatchObject({
      numberedByDefault: false, folders: expect.arrayContaining([expect.objectContaining({ id: "overview", name: "overview" })])
    });
    expect(ja.structures.find((item: { id: string }) => item.id === "by-type").folders[0].name).toBe("概要");
    // The catalog also includes a companion document for a repeating set.
    expect(en.templates).toHaveLength(39);
    expect(en.templates.find((item: { id: string }) => item.id === "decision")).toMatchObject({
      role: "decisions", title: expect.any(String), description: expect.any(String)
    });
    expect(en.resources).toEqual([]);
    expect(en.sets).toHaveLength(10);
    expect((await fetch(`${server.url}/api/v1/setup/profiles`)).status).toBe(404);
    expect((await post("templates/plan", add)).status).toBe(409);
    expect((await post("templates/apply", {})).status).toBe(409);
  });

  it("rejects changed initialization previews without writing", async () => {
    const plan = await preview<InitPlan>("setup", init);
    await writeFile(path.join(root, "package.json"), '{"name":"external"}\n');
    expect((await post("setup/apply", plan)).status).toBe(409);
    expect(await readdir(root)).not.toContain("docs");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toContain("external");
  });

  it("adds, reloads, skips existing files, and appends an opted-in guide only once", async () => {
    await initialize();
    const guidePath = path.join(root, "docs/VELLYM.md");
    const original = await readFile(guidePath, "utf8");
    const plan = await preview<AddPlan>("templates", { ...add, guide: true });
    expect(plan.guide).toMatchObject({ available: true, append: true });
    expect(await readFile(guidePath, "utf8")).toBe(original);
    const events = await fetch(`${server.url}/api/v1/events`, { signal: AbortSignal.timeout(5000) });
    const reader = events.body!.getReader();
    try {
      expect((await post("templates/apply", plan)).status).toBe(200);
      let messages = "";
      while (!messages.includes('"kind":"template-add"')) {
        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        messages += new TextDecoder().decode(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const updated = await readFile(guidePath, "utf8");
    expect(updated.startsWith(original)).toBe(true);
    expect(updated).toContain("<!-- vellym:guide:add-template-decision -->");
    const repository = await (await fetch(`${server.url}/api/v1/repository`)).json();
    expect(JSON.stringify(repository.data)).toContain(plan.files.at(-1)!.name);
    const again = await preview<AddPlan>("templates", { ...add, guide: true });
    expect(again.files.at(-1)!.status).toBe("skip");
    expect((await post("templates/apply", again)).status).toBe(200);
    expect(await readFile(guidePath, "utf8")).toBe(updated);
    const noGuide = await preview<AddPlan>("templates", { ...add, name: "another", guide: false });
    expect((await post("templates/apply", noGuide)).status).toBe(200);
    expect(await readFile(guidePath, "utf8")).toBe(updated);
  });

  it("reports guide availability at the configuration root, not the content folder", async () => {
    await initialize();
    const plan = await preview<TemplatePlan>("templates", add);
    expect(plan.guide).toEqual({ available: true });
    expect((await post("templates/apply", plan)).status).toBe(200);
    await unlink(path.join(root, "docs/VELLYM.md"));
    const absent = await preview<TemplatePlan>("templates", { ...add, name: "without guide", guide: true });
    expect(absent.guide).toEqual({ available: false, append: true });
    expect((await post("templates/apply", absent)).status).toBe(200);
    expect(await readdir(path.join(root, "docs"))).not.toContain("VELLYM.md");
  });

  it("rejects stale or tampered addition previews", async () => {
    await initialize();
    const plan = await preview<AddPlan>("templates", add);
    const edited = structuredClone(plan);
    edited.files.at(-1)!.source = "untrusted";
    expect((await post("templates/apply", edited)).status).toBe(409);
    await writeFile(path.join(root, "docs/index.yaml"), "external change");
    expect((await post("templates/apply", plan)).status).toBe(409);
    expect(await readdir(path.join(root, "docs/architecture/decisions"))).toEqual(["_index.yaml"]);
  });

  it("plans and applies a repeating set through the same addition API", async () => {
    await initialize();
    const catalog = (await (await fetch(`${server.url}/api/v1/setup/catalog?language=en`)).json()).data;
    const definition = catalog.sets.find((item: { repeat?: unknown }) => item.repeat);
    const input = { kind: "set", id: definition.id, name: "Iteration one", language: "en" };
    const first = await preview<AddPlan>("templates", input);
    expect(first.files.some(file => file.status === "create")).toBe(true);
    expect((await post("templates/apply", first)).status).toBe(200);
    const second = await preview<AddPlan>("templates", input);
    expect(second.files.at(-1)!.relativePath).not.toBe(first.files.at(-1)!.relativePath);
    expect((await post("templates/apply", second)).status).toBe(200);
  });

  it("loads enabled plugin templates with localized groups and creates their opaque resources", async () => {
    await mkdir(path.join(root, "node_modules/@vellym"), { recursive: true });
    for (const [name, directory] of [["tickets", "plugin-tickets"], ["plugin-api", "plugin-api"]]) {
      await symlink(path.join(process.cwd(), "packages", directory!), path.join(root, "node_modules/@vellym", name!), "dir");
    }
    await initialize({ ...init, plugins: ["@vellym/tickets"] });
    const catalog = (await (await fetch(`${server.url}/api/v1/setup/catalog?language=en`)).json()).data;
    expect(catalog.resources).toHaveLength(8);
    expect(catalog.resources[0]).toMatchObject({ pluginId: "tickets", group: expect.any(String), title: expect.any(String) });
    const plan = await preview<AddPlan>("templates", {
      kind: "resource", id: "tickets:work", folder: "work", language: "en", guide: true
    });
    expect((await post("templates/apply", plan)).status).toBe(200);
    expect(await readFile(path.join(root, "docs", plan.files.at(-1)!.relativePath), "utf8")).toContain("kind: TicketTracker");
    expect(await readFile(path.join(root, "docs/VELLYM.md"), "utf8")).toContain("vellym:guide:add-template-tickets:work");
  });

  it("checks Origin on every write route before processing input", async () => {
    for (const route of ["setup/plan", "setup/apply", "templates/plan", "templates/apply"]) {
      expect((await post(route, {}, "https://external.example")).status).toBe(403);
    }
    expect((await post("setup/plan", null)).status).toBe(400);
    expect((await post("setup/apply", {})).status).toBe(400);
    await initialize();
    expect((await post("templates/plan", {})).status).toBe(400);
    expect((await post("templates/apply", {})).status).toBe(400);
  });
});
