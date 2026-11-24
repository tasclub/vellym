import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { tmpdir } from "node:os";
import { loadConfig } from "../packages/runtime-node/src/config.js";
import { planAdd, applyAdd, type AddRequest } from "../packages/runtime-node/src/setup-add.js";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";
import type { LoadedConfig } from "../packages/runtime-node/src/types.js";

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
    const plan = await planAdd(config, request({ kind: "tracker", id: "work", folder: "backlog", name: "Our work" }));
    expect(plan.files.at(-1)).toMatchObject({ relativePath: "backlog/work.yaml", kind: "TicketTracker" });
    await applyAdd(config, plan);
    const tracker = parse(await fs.readFile(path.join(config.contentRoot, "backlog/work.yaml"), "utf8"));
    expect(tracker.kind).toBe("TicketTracker");
    expect(tracker.spec).toEqual(loadCatalog().trackers.find(item => item.id === "work")!.spec.en);
  });

  it("requires repeat names and creates separate folders even with the same name", async () => {
    await expect(planAdd(config, request({ kind: "set", id: "sprint" }))).rejects.toMatchObject({ status: 400 });
    const input = request({ kind: "set", id: "sprint", name: "Sprint 1", folder: "iterations" });
    const first = await planAdd(config, input);
    await applyAdd(config, first);
    const second = await planAdd(config, input);
    expect(second.files.every(file => file.relativePath.startsWith("iterations/sprint-1-2/"))).toBe(true);
    await applyAdd(config, second);
    expect(await entries()).toContain("iterations/sprint-1-2/work.yaml");
    expect(await entries()).toContain("iterations/sprint-1/decision.yaml");
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
    const plan = await planAdd(config, request({ kind: "tracker", id: "work" }));
    expect(plan.files.at(-1)!.relativePath).toBe("00_project-management/work.yaml");
  });

  it("routes ordinary set items independently, unless folder overrides all roles", async () => {
    const plan = await planAdd(config, request({ kind: "set", id: "start" }));
    expect(plan.files.filter(file => file.kind === "Page").map(file => file.relativePath)).toEqual([
      "requirements/functional-requirements.yaml", "architecture/decisions/decision.yaml"
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
