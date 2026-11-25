import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadRepository, startDevServer } from "@vellym-internal/runtime-node";
import { createRenderContext } from "../packages/ui-react/src/plugin/render-context.js";
import type { PluginViewPayload } from "../packages/ui-react/src/plugin/plugin-list-view.js";
import { buildPluginViewFromSnapshot, type LoadedPlugin } from "../packages/runtime-node/src/plugins.js";

const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const source = (kind: string, name: string, spec: object) =>
  `apiVersion: vellym.tasclub.com/v1\nkind: ${kind}\nmetadata:\n  name: ${name}\n  title: ${name}\nspec: ${JSON.stringify(spec)}\n`;

describe("plugin save baselines", () => {
  it("carries source hashes through cached records and index rows", async () => {
    const root = await mkdtemp("/tmp/opencode/plugin-hash-cache-");
    try {
      const text = source("Example", "example", { value: 1 });
      await writeFile(path.join(root, "example.yaml"), text);
      const options = { knownKinds: new Set(["Example"]) };
      const first = await loadRepository(root, undefined, options);
      const second = await loadRepository(root, first, options);
      expect(second.definitionRecords?.[0]).toBe(first.definitionRecords?.[0]);
      expect(second.pages[0]?.hash).toBe(hash(text));
      expect(second.definitionRecords?.[0]?.hash).toBe(hash(text));
      const indexed = await loadRepository(root, undefined, {
        ...options,
        projections: new Map([["Example", () => () => ({ values: { value: 1 } })]])
      });
      const plugin: LoadedPlugin = {
        id: "example", packageName: "example",
        manifest: { id: "example" }, kinds: [], commands: [],
        projections: new Map(), recordSetValidators: new Map(),
        views: [{ id: "example", static: false, view: {
          type: "detail", id: "example", kind: "Example", fields: [], body: "none"
        } }]
      };
      const payload = buildPluginViewFromSnapshot({
        registry: { plugins: [plugin], kinds: new Map(), diagnostics: [] },
        snapshot: indexed, name: "example", locale: "en", isStatic: false
      });
      expect(payload?.target?.hash).toBe(hash(text));
      expect(payload?.allRows[0]?.hash).toBe(hash(text));
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("rejects stale saves without refetching, returns the next hash, and preserves legacy saves", async () => {
    const project = await mkdtemp("/tmp/opencode/plugin-save-hash-");
    let server: Awaited<ReturnType<typeof startDevServer>> | undefined;
    try {
      const content = path.join(project, "content");
      const uiRoot = path.join(project, "ui");
      await mkdir(content);
      await mkdir(uiRoot);
      await writeFile(path.join(uiRoot, "index.html"), "<h1>UI</h1>");
      await mkdir(path.join(project, "node_modules/@vellym"), { recursive: true });
      await symlink(path.join(process.cwd(), "packages/plugin-design"), path.join(project, "node_modules/@vellym/design"), "dir");
      const specs = [
        ["DesignCanvas", "canvas", { formatVersion: 1, styles: "styles" }],
        ["DesignBoard", "board", { canvas: "canvas", x: 0, y: 0, root: { id: "root", type: "frame", children: [] } }],
        ["DesignComponent", "component", { canvas: "canvas", root: { id: "root", type: "frame", children: [] } }],
        ["DesignStyles", "styles", { styles: {} }]
      ] as const;
      for (const [kind, name, spec] of specs) {
        await writeFile(path.join(content, `${name}.yaml`), source(kind, name, spec));
      }
      const configPath = path.join(project, "vellym.config.yaml");
      await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins:\n  - "@vellym/design"\n');
      const hostVersion = JSON.parse(await readFile("packages/vellym/package.json", "utf8")).version;
      server = await startDevServer({ configPath, uiRoot, hostVersion, port: 0 });
      const bootstrap = await fetch(`${server.url}/api/v1/bootstrap`);
      expect(await bootstrap.text()).not.toContain('"config-error"');
      const realFetch = globalThis.fetch;
      const requests: string[] = [];
      const url = server.url;
      vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
        requests.push(String(input));
        return realFetch(typeof input === "string" ? new URL(input, url) : input, init);
      });
      const response = await fetch("/api/v1/plugins/views/canvas");
      expect(response.status, await response.clone().text()).toBe(200);
      const { data: payload } = await response.json() as { data: PluginViewPayload };
      const data = payload.descriptor.rendererData as {
        canvas: { hash: string }; boards: { hash: string }[];
        components: { hash: string }[]; styles: { hash: string }[];
      };
      for (const [item, name] of [
        [data.canvas, "canvas"], [data.boards[0], "board"],
        [data.components[0], "component"], [data.styles[0], "styles"]
      ] as const) {
        expect(item?.hash).toBe(hash(await readFile(path.join(content, `${name}.yaml`), "utf8")));
      }
      const onSaved = vi.fn();
      const context = createRenderContext({
        payload, locale: "en", projectRoot: project,
        targetKind: "DesignCanvas", targetName: "canvas", targetTitle: "canvas", targetPath: "canvas.yaml",
        onSaved, onOpenResource: async () => ({ ok: true }),
        describeError: (error) => String(error)
      });
      const external = source("DesignBoard", "board", { ...specs[1][2], x: 42 });
      const file = path.join(content, "board.yaml");
      await writeFile(file, external);
      requests.length = 0;
      const stale = await context.save([{ path: ["x"], value: 10 }], { targetName: "board", baseHash: data.boards[0]!.hash });
      expect(stale).toMatchObject({ ok: false, reason: "conflict" });
      expect(requests).toEqual(["/api/v1/pages/board"]);
      expect(await readFile(file, "utf8")).toBe(external);
      expect(onSaved).not.toHaveBeenCalled();
      const saved = await context.save([{ path: ["x"], value: 20 }], { targetName: "board", baseHash: hash(external) });
      expect(saved).toEqual({ ok: true, hash: hash(await readFile(file, "utf8")) });
      if (!saved.ok) throw new Error(saved.message);
      expect(await context.save([{ path: ["x"], value: 30 }], { targetName: "board", baseHash: saved.hash }))
        .toEqual({ ok: true, hash: hash(await readFile(file, "utf8")) });
      requests.length = 0;
      expect(await context.save([{ path: ["x"], value: 40 }], { targetName: "board" }))
        .toEqual({ ok: true, hash: hash(await readFile(file, "utf8")) });
      expect(requests).toEqual(["/api/v1/pages/board/edit", "/api/v1/pages/board"]);
    } finally {
      vi.unstubAllGlobals();
      await server?.close();
      await rm(project, { recursive: true });
    }
  });
});
