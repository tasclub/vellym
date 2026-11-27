import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { planInit, applyInit, type InitRequest } from "../packages/runtime-node/src/setup-init.js";
import { loadCatalog } from "../packages/runtime-node/src/catalog/load.js";
import { loadConfig } from "../packages/runtime-node/src/config.js";

const faults = vi.hoisted(() => ({ renames: 0, failAt: 0, failWrite: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual,
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      faults.renames++;
      if (faults.renames === faults.failAt) throw new Error("injected rename");
      return actual.rename(...args);
    }),
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (faults.failWrite && String(args[0]).endsWith(".tmp")) {
        vi.spyOn(handle, "writeFile").mockRejectedValueOnce(new Error("injected write"));
      }
      return handle;
    })
  };
});
let root: string;
const request = (overrides: Partial<InitRequest> = {}): InitRequest => ({
  root: "docs", structure: "by-type", numbered: false, language: "en", plugins: [], ...overrides
});
const read = (relative: string) => fs.readFile(path.join(root, relative), "utf8");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "vellym-init-"));
  Object.assign(faults, { renames: 0, failAt: 0, failWrite: false });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("init planning and execution", () => {
  for (const structure of ["by-type", "by-phase", "by-feature"] as const) {
    for (const location of ["docs", "vellym", "."] as const) {
      it(`creates only the shell for ${structure} in ${location}`, async () => {
        const plan = await planInit(root, request({ structure, root: location }));
        expect(await fs.readdir(root)).toEqual([]);
        const prefix = location === "." ? "" : `${location}/`;
        expect(plan.files.every(file => file.status === "create")).toBe(true);
        const folders = plan.files.filter(file => file.relativePath.endsWith("/_index.yaml"));
        expect(folders.length).toBeGreaterThan(5);
        expect(plan.files.filter(file => file.relativePath.endsWith(".yaml") && !file.relativePath.endsWith("_index.yaml")))
          .toHaveLength(2);
        await applyInit(JSON.parse(JSON.stringify(plan)));
        const config = parse(await read(`${prefix}vellym.config.yaml`));
        expect(config).toEqual({
          schemaVersion: "1.0", ui: { language: "en" }, plugins: [],
          setup: { structure, numbered: false }
        });
        const loaded = await loadConfig(path.join(root, prefix, "vellym.config.yaml"));
        expect(loaded.contentRoot).toBe(path.join(root, location === "." ? "" : location));
        expect(await read(`${prefix}.gitignore`)).toBe("dist/\n");
        expect(await read(`${prefix}VELLYM.md`)).toContain("Document map");
        const index = parse(await read(`${prefix}index.yaml`));
        expect(index.kind).toBe("Page");
        expect(index.spec.blocks[0].content).toContain("Create from template");
        expect(parse(await read(folders[0]!.relativePath)).kind).toBe("Folder");
        expect(JSON.parse(await read("package.json")).devDependencies.vellym).toMatch(/^\^/);
      });
    }
  }
  it("uses Japanese, numbering, custom folder labels and the guide supplement", async () => {
    const plan = await planInit(root, request({
      language: "ja", numbered: true, folderNames: { architecture: "構想" }, supplementGuide: true,
      plugins: [{ name: "@vellym/tickets", version: "0.3.0-beta", id: "tickets" }]
    }));
    expect(plan.files.some(file => file.relativePath.startsWith("docs/構想/"))).toBe(true);
    expect(plan.files.some(file => /docs\/00_/.test(file.relativePath))).toBe(true);
    const supplement = loadCatalog().structures.find(item => item.supplement)!;
    const guideLabel = `${String(0).padStart(2, "0")}_${supplement.folders[0]!.name.ja}`;
    expect(plan.files.some(file => file.relativePath.startsWith(`docs/${guideLabel}/`))).toBe(true);
    await applyInit(plan);
    expect(parse(await read("docs/vellym.config.yaml")).setup.folderNames).toEqual({ architecture: "構想" });
    expect(await read("docs/VELLYM.md")).toContain("構想/");
    expect(await read("docs/VELLYM.md")).toContain(`${guideLabel}/`);
    expect(JSON.parse(await read("package.json")).dependencies).toEqual({ "@vellym/tickets": "^0.3.0-beta" });
  });
  it("skips existing files and preserves their exact contents on repeated init", async () => {
    const first = await planInit(root, request());
    await applyInit(first);
    await fs.writeFile(path.join(root, "docs/index.yaml"), "user source");
    const plan = await planInit(root, request());
    expect(plan.files.filter(file => file.relativePath !== "package.json").every(file => file.status === "skip")).toBe(true);
    await applyInit(plan);
    expect(await read("docs/index.yaml")).toBe("user source");
    expect((await fs.readdir(path.join(root, "docs"))).some(name => name.endsWith(".tmp"))).toBe(false);
  });
  it("only adds missing dependencies and preserves the user's package data and versions", async () => {
    const original = { name: "custom", scripts: { test: "keep" }, custom: [1],
      dependencies: { vellym: "old", "@vellym/tickets": "pinned", other: "1" }, devDependencies: { test: "2" } };
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(original));
    const plan = await planInit(root, request({ plugins: ["@vellym/tickets", { name: "@vellym/kanban", version: "0.3.0-beta" }] }));
    expect(plan.files.at(-1)!.status).toBe("update");
    await applyInit(plan);
    expect(JSON.parse(await read("package.json"))).toEqual({
      ...original, dependencies: { ...original.dependencies, "@vellym/kanban": "^0.3.0-beta" }
    });
  });
  it("leaves an up-to-date package.json byte for byte", async () => {
    const source = '{\n    "name": "four",\n    "devDependencies": { "vellym": "^0.1.0" },\n    "dependencies": { "@vellym/tickets": "1" }\n}\n';
    await fs.writeFile(path.join(root, "package.json"), source);
    const plan = await planInit(root, request({ plugins: ["@vellym/tickets"] }));
    expect(plan.files.find(file => file.relativePath === "package.json")).toMatchObject({ status: "skip", reason: "up-to-date" });
    await applyInit(plan);
    expect(await read("package.json")).toBe(source);
  });
  it("updates a four-space package.json that lacks the dependencies", async () => {
    await fs.writeFile(path.join(root, "package.json"), '{\n    "name": "four"\n}\n');
    const plan = await planInit(root, request());
    expect(plan.files.find(file => file.relativePath === "package.json")!.status).toBe("update");
    await applyInit(plan);
    expect(JSON.parse(await read("package.json"))).toMatchObject({ name: "four", devDependencies: { vellym: expect.stringMatching(/^\^/) } });
  });
  it("skips package.json on the second init", async () => {
    await applyInit(await planInit(root, request({ plugins: ["@vellym/tickets"] })));
    const before = await read("package.json");
    const plan = await planInit(root, request({ plugins: ["@vellym/tickets"] }));
    expect(plan.files.find(file => file.relativePath === "package.json")).toMatchObject({ status: "skip", reason: "up-to-date" });
    expect(plan.files.every(file => file.status === "skip")).toBe(true);
    await applyInit(plan);
    expect(await read("package.json")).toBe(before);
  });
  it.each(["{broken", "null", "[]", '{"dependencies":false}'])("skips malformed package.json: %s", async source => {
    await fs.writeFile(path.join(root, "package.json"), source);
    const plan = await planInit(root, request());
    expect(plan.files.find(file => file.relativePath === "package.json")).toMatchObject({ status: "skip", reason: "unreadable-json" });
    await applyInit(plan);
    expect(await read("package.json")).toBe(source);
  });
  it.each(["new", "existing", "package", "ancestor", "tampered"])("rejects a changed preview (%s) before writing", async scenario => {
    if (scenario === "existing") {
      await fs.mkdir(path.join(root, "docs"));
      await fs.writeFile(path.join(root, "docs/index.yaml"), "first");
    }
    const plan = await planInit(root, request());
    if (scenario === "new") {
      await fs.mkdir(path.join(root, "docs"));
      await fs.writeFile(path.join(root, "docs/index.yaml"), "other writer");
    } else if (scenario === "existing") await fs.writeFile(path.join(root, "docs/index.yaml"), "changed");
    else if (scenario === "package") await fs.writeFile(path.join(root, "package.json"), "{}");
    else if (scenario === "ancestor") await fs.writeFile(path.join(root, "docs"), "file");
    else plan.files[0]!.source += "tamper";
    const before = await fs.readdir(root, { recursive: true });
    await expect(applyInit(plan)).rejects.toMatchObject({ status: 409 });
    expect(await fs.readdir(root, { recursive: true })).toEqual(before);
  });
  it.each(["rename", "write"])("cleans up after a mid-transaction %s failure", async failure => {
    await fs.writeFile(path.join(root, "package.json"), '{"name":"keep"}\n');
    const plan = await planInit(root, request());
    if (failure === "rename") faults.failAt = 3;
    else faults.failWrite = true;
    await expect(applyInit(plan)).rejects.toThrow("injected");
    expect(await fs.readdir(root)).toEqual(["package.json"]);
    expect(await read("package.json")).toBe('{"name":"keep"}\n');
  });
  it("rejects escaping paths, duplicate folders and invalid inputs without writes", async () => {
    const invalidRequests: Partial<InitRequest>[] = [
      { folderNames: { architecture: "../outside" } },
      { folderNames: { architecture: "same", management: "same" } },
      { folderNames: { unknown: "custom" } },
      { plugins: ["../outside"] }
    ];
    for (const overrides of invalidRequests) await expect(planInit(root, request(overrides))).rejects.toMatchObject({ status: 400 });
    await fs.symlink(path.dirname(root), path.join(root, "docs"));
    await expect(planInit(root, request())).rejects.toMatchObject({ status: 422 });
    expect(await fs.readdir(root)).toEqual(["docs"]);
  });
});
