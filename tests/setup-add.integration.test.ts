import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { tmpdir } from "node:os";
import { loadConfig } from "../packages/runtime-node/src/config.js";
import { planAdd, applyAdd, type AddRequest } from "../packages/runtime-node/src/setup-add.js";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";
import type { LoadedConfig } from "../packages/runtime-node/src/types.js";
import work from "../packages/plugin-tickets/templates/work.json";
import review from "../packages/plugin-tickets/templates/review.json";
const group = { ja: "チケット管理を作る", en: "Create ticket management" };
// The repeated "phase" set holds the review resource; "start" holds only documents.
const resources = [{ ...work, id: "tickets:work", pluginId: "tickets", group },
  { ...review, id: "tickets:review", pluginId: "tickets", group }];

const faults = vi.hoisted(() => ({ renames: 0, failRename: 0, failWrite: false, race: "", freeze: false }));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: (size: number) => faults.freeze && size === 10 ? Buffer.alloc(size) : actual.randomBytes(size) };
});
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      faults.renames++;
      if (faults.renames === faults.failRename) throw new Error("injected rename failure");
      return actual.rename(...args);
    }),
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      if (String(args[0]) === faults.race) {
        faults.race = "";
        await actual.writeFile(args[0], "external file", { flag: "wx" });
      }
      const handle = await actual.open(...args);
      if (faults.failWrite && String(args[0]).endsWith(".tmp")) {
        vi.spyOn(handle, "writeFile").mockRejectedValueOnce(new Error("injected write failure"));
      }
      return handle;
    })
  };
});

let root: string;
let config: LoadedConfig;
const request = (overrides: Partial<AddRequest> = {}): AddRequest => ({
  kind: "template", id: "decision", language: "en", ...overrides
});
const entries = async () => (await fs.readdir(config.contentRoot, { recursive: true })).sort();
async function structure(id: string) {
  await fs.writeFile(config.configPath, stringify({ schemaVersion: "1.0", contentRoot: "content", outputDir: "dist", ui: { language: "en" }, plugins: [], setup: { structure: id } }));
  config = await loadConfig(config.configPath);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "vellym-add-"));
  await fs.mkdir(path.join(root, "content"));
  await fs.writeFile(path.join(root, "vellym.config.yaml"), stringify({ schemaVersion: "1.0", contentRoot: "content", outputDir: "dist", ui: { language: "en" }, plugins: [] }));
  config = await loadConfig(path.join(root, "vellym.config.yaml"));
  Object.assign(faults, { renames: 0, failRename: 0, failWrite: false, race: "", freeze: false });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("setup add planning and execution", () => {
  it("routes by role, creates Folder metadata, and makes preview read-only", async () => {
    const plan = await planAdd(config, request({ guide: true }));
    expect(await entries()).toEqual([]);
    expect(plan.guide).toEqual({ append: true });
    expect(plan.files.map(file => file.relativePath)).toEqual([
      "architecture/_index.yaml", "architecture/decisions/_index.yaml", "architecture/decisions/decision.yaml"
    ]);
    await applyAdd(config, JSON.parse(JSON.stringify(plan)));
    const page = parse(await fs.readFile(path.join(config.contentRoot, "architecture/decisions/decision.yaml"), "utf8"));
    expect(page.metadata.name).toMatch(/^page-[0-9a-hjkmnp-tv-z]{26}$/);
    expect(page.spec.blocks[0].content).toBe(loadCatalog().templates.find(item => item.id === "decision")!.body.en);
    expect(await entries()).not.toContain("VELLYM.md");
  });

  it("uses an explicit folder, name slug and language", async () => {
    const plan = await planAdd(config, request({ folder: "custom/deep", name: "Ｆｉｘ API!", language: "ja" }));
    expect(plan.files.at(-1)).toMatchObject({ relativePath: "custom/deep/fix-api.yaml", title: "Ｆｉｘ API!" });
    await applyAdd(config, plan);
    expect(parse(await fs.readFile(path.join(config.contentRoot, "custom/deep/fix-api.yaml"), "utf8")).spec.locale).toBe("ja");
  });

  it("skips existing paths without changing their bytes", async () => {
    await fs.mkdir(path.join(config.contentRoot, "custom"));
    await fs.writeFile(path.join(config.contentRoot, "custom/decision.yaml"), "user contents");
    const plan = await planAdd(config, request({ folder: "custom" }));
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.status).toBe("skip");
    expect(plan.files[0]!.reason?.code).toBe("EXISTS");
    await applyAdd(config, plan);
    expect(await fs.readFile(path.join(config.contentRoot, "custom/decision.yaml"), "utf8")).toBe("user contents");
  });

  it("renames colliding identities with the first available suffix", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1800000000000);
    faults.freeze = true;
    const first = await planAdd(config, request());
    await fs.writeFile(path.join(config.contentRoot, "existing.yaml"), stringify({ metadata: { name: first.identities[0] } }));
    await fs.writeFile(path.join(config.contentRoot, "existing-2.yaml"), stringify({ metadata: { name: `${first.identities[0]}-2` } }));
    const renamed = await planAdd(config, request());
    expect(renamed.files.at(-1)).toMatchObject({ status: "rename", name: `${first.identities[0]}-3` });
    await applyAdd(config, renamed);
  });

  it("creates Tracker spec directly beneath the chosen folder", async () => {
    const plan = await planAdd(config, request({ kind: "resource", id: "tickets:work", folder: "backlog", name: "Our work" }), { resources });
    expect(plan.files.at(-1)).toMatchObject({ relativePath: "backlog/work.yaml", kind: "TicketTracker" });
    await applyAdd(config, plan, { resources });
    const tracker = parse(await fs.readFile(path.join(config.contentRoot, "backlog/work.yaml"), "utf8"));
    expect(tracker.kind).toBe("TicketTracker");
    expect(tracker.spec).toEqual(work.spec.en);
  });

  it("requires repeat names and creates separate folders even with the same name", async () => {
    await expect(planAdd(config, request({ kind: "set", id: "phase" }))).rejects.toMatchObject({ status: 400 });
    const input = request({ kind: "set", id: "phase", name: "Phase 1", folder: "iterations" });
    const first = await planAdd(config, input, { resources });
    await applyAdd(config, first, { resources });
    const second = await planAdd(config, input, { resources });
    expect(second.files.every(file => file.relativePath.startsWith("iterations/phase-1-2/"))).toBe(true);
    await applyAdd(config, second, { resources });
    expect(await entries()).toContain("iterations/phase-1/review.yaml");
    expect(await entries()).toContain("iterations/phase-1-2/review.yaml");
    expect(await entries()).toContain("iterations/phase-1/phase.yaml");
  });

  it("routes by-feature roles only when a feature name or folder exists", async () => {
    await structure("by-feature");
    const template = loadCatalog().templates.find(item => item.role === "requirements")!;
    await expect(planAdd(config, request({ id: template.id }))).rejects.toMatchObject({ status: 400 });
    const named = await planAdd(config, request({ id: template.id, name: "Login" }));
    expect(named.files.at(-1)!.relativePath).toBe("features/login/login.yaml");
    await applyAdd(config, named);
    await applyAdd(config, await planAdd(config, request({ id: template.id, folder: "chosen" })));
  });

  it("uses the numbered phase role mapping", async () => {
    await structure("by-phase");
    const plan = await planAdd(config, request({ id: "functional-requirements" }));
    expect(plan.files.at(-1)!.relativePath).toBe("01_requirements/functional-requirements.yaml");
  });
  it("requires resource folders rather than routing resources by a document role", async () => {
    await expect(planAdd(config, request({ kind: "resource", id: "tickets:work" }), { resources })).rejects.toMatchObject({ status: 400 });
    await expect(planAdd(config, request({ kind: "resource", id: "missing:work", folder: "" }))).rejects.toMatchObject({ status: 400 });
  });
  it("creates arbitrary plugin kinds and opaque localized specs", async () => {
    const opaque = [{ ...resources[0]!, id: "example:sample", pluginId: "example", kind: "ExampleData",
      fileName: { ja: "sample-ja.yaml", en: "sample.yaml" },
      spec: { ja: { custom: ["日本語"] }, en: { custom: ["English"] } } }];
    const plan = await planAdd(config, request({ kind: "resource", id: "example:sample", folder: "", language: "ja" }), { resources: opaque });
    await applyAdd(config, plan, { resources: opaque });
    expect(parse(await fs.readFile(path.join(config.contentRoot, "sample-ja.yaml"), "utf8"))).toMatchObject({
      kind: "ExampleData", spec: { custom: ["日本語"] }
    });
  });
  it("skips unavailable set resources with a localized reason", async () => {
    const plan = await planAdd(config, request({ kind: "set", id: "phase", name: "Phase 1", folder: "iterations" }));
    expect(plan.files.find(file => file.relativePath.endsWith("/review.yaml"))).toMatchObject({ relativePath: "iterations/phase-1/review.yaml", status: "skip",
      reason: { code: "PLUGIN_NOT_ENABLED", message: { ja: expect.any(String), en: expect.any(String) } } });
    await applyAdd(config, plan);
    expect(await entries()).not.toContain("iterations/phase-1/review.yaml");
    expect(await entries()).toContain("iterations/phase-1/phase.yaml");
  });
  it("rejects changed, removed or newly enabled resource definitions at apply time", async () => {
    const input = request({ kind: "set", id: "phase", name: "Phase 1", folder: "iterations" });
    const plan = await planAdd(config, input, { resources });
    const changed = structuredClone(resources);
    changed[1]!.spec.ja.statuses[0]!.label = "Changed unselected locale";
    for (const options of [{ resources: changed }, {}]) {
      await expect(applyAdd(config, plan, options)).rejects.toMatchObject({ status: 409 });
    }
    const missing = await planAdd(config, input);
    await expect(applyAdd(config, missing, { resources })).rejects.toMatchObject({ status: 409 });
    expect(await entries()).toEqual([]);
  });

  it("routes ordinary set items independently, unless folder overrides all roles", async () => {
    const plan = await planAdd(config, request({ kind: "set", id: "start" }));
    expect(plan.files.filter(file => file.kind === "Page").map(file => file.relativePath)).toEqual([
      "overview/project-charter.yaml", "overview/background-and-problem.yaml",
      "overview/stakeholders.yaml", "overview/glossary.yaml"
    ]);
    await applyAdd(config, plan);
    const override = await planAdd(config, request({ kind: "set", id: "start", folder: "custom" }));
    expect(override.files.every(file => file.relativePath.startsWith("custom/"))).toBe(true);
    await applyAdd(config, override);
  });

  it.each(["existing", "target", "ancestor", "config", "name"])("rejects stale %s state with 409 and creates nothing", async change => {
    await fs.writeFile(path.join(config.contentRoot, "existing.yaml"), "old");
    const before = await planAdd(config, request());
    if (change === "existing") await fs.writeFile(path.join(config.contentRoot, "existing.yaml"), "new");
    if (change === "target") {
      await fs.mkdir(path.join(config.contentRoot, "architecture"));
      await fs.writeFile(path.join(config.contentRoot, "architecture/_index.yaml"), "external");
    }
    if (change === "config") await fs.appendFile(config.configPath, "\n# changed\n");
    if (change === "ancestor") await fs.writeFile(path.join(config.contentRoot, "architecture"), "not a directory");
    if (change === "name") await fs.writeFile(path.join(config.contentRoot, "new.yaml"), stringify({ metadata: { name: before.identities[0] } }));
    const snapshot = await entries();
    await expect(applyAdd(config, before)).rejects.toMatchObject({ status: 409 });
    expect(await entries()).toEqual(snapshot);
  });

  it.each(["write", "rename"])("rolls back all staged and published files after a %s failure", async failure => {
    const plan = await planAdd(config, request());
    faults.failWrite = failure === "write";
    faults.failRename = failure === "rename" ? 2 : 0;
    await expect(applyAdd(config, plan)).rejects.toThrow("injected");
    expect(await entries()).toEqual([]);
  });

  it("never overwrites a file created after revalidation and rolls back other files", async () => {
    const plan = await planAdd(config, request());
    faults.race = path.join(config.contentRoot, plan.files.at(-1)!.relativePath);
    await expect(applyAdd(config, plan)).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(path.join(config.contentRoot, plan.files.at(-1)!.relativePath), "utf8")).toBe("external file");
    expect((await entries()).filter(entry => entry.endsWith(".tmp") || entry.endsWith("_index.yaml"))).toEqual([]);
  });

  it("rejects unsafe folders, escaping symlinks and tampered plans without writing", async () => {
    for (const folder of ["../outside", "/absolute", "a/../b", "a\\b", ".hidden"]) {
      await expect(planAdd(config, request({ folder }))).rejects.toMatchObject({ status: 400 });
    }
    await fs.symlink(root, path.join(config.contentRoot, "escape"));
    await expect(planAdd(config, request({ folder: "escape" }))).rejects.toMatchObject({ code: "PATH_BOUNDARY" });
    const plan = await planAdd(config, request());
    plan.files.at(-1)!.source = "tampered";
    await expect(applyAdd(config, plan)).rejects.toMatchObject({ status: 409 });
    expect(await fs.readdir(config.contentRoot)).toEqual(["escape"]);
  });

  it("checks real paths again when an ancestor changes to an escaping symlink", async () => {
    const plan = await planAdd(config, request());
    await fs.symlink(root, path.join(config.contentRoot, "architecture"));
    await expect(applyAdd(config, plan)).rejects.toMatchObject({ status: 409 });
    expect(await fs.readdir(root)).toEqual(["content", "vellym.config.yaml"]);
    expect(await fs.readdir(config.contentRoot)).toEqual(["architecture"]);
  });

  it("allows an internal symlink destination without overwriting existing folder metadata", async () => {
    await fs.mkdir(path.join(config.contentRoot, "actual"));
    await fs.writeFile(path.join(config.contentRoot, "actual/_index.yaml"), "existing folder");
    await fs.symlink(path.join(config.contentRoot, "actual"), path.join(config.contentRoot, "alias"));
    const plan = await planAdd(config, request({ folder: "alias" }));
    await applyAdd(config, plan);
    expect(await fs.readFile(path.join(config.contentRoot, "actual/_index.yaml"), "utf8")).toBe("existing folder");
    expect(parse(await fs.readFile(path.join(config.contentRoot, "actual/decision.yaml"), "utf8")).kind).toBe("Page");
  });
});
