import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startDevServer } from "@vellym-internal/runtime-node";

describe("plugin resource deletion", () => {
  it("requires origin, ownership and current hash, then reloads the repository", async () => {
    const project = await mkdtemp("/tmp/opencode/plugin-delete-");
    let server: Awaited<ReturnType<typeof startDevServer>> | undefined;
    try {
      const content = path.join(project, "content");
      const uiRoot = path.join(project, "ui");
      await mkdir(content);
      await mkdir(uiRoot);
      await writeFile(path.join(uiRoot, "index.html"), "UI");
      await mkdir(path.join(project, "node_modules/@vellym"), { recursive: true });
      await symlink(path.join(process.cwd(), "packages/plugin-design"), path.join(project, "node_modules/@vellym/design"), "dir");
      const source = 'apiVersion: vellym.tasclub.com/v1\nkind: DesignBoard\nmetadata:\n  name: board\n  title: Board\nspec:\n  canvas: canvas\n  x: 0\n  y: 0\n  root: { id: root, type: frame, children: [] }\n';
      const file = path.join(content, "board.yaml");
      await writeFile(file, source);
      const configPath = path.join(project, "vellym.config.yaml");
      await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins:\n  - "@vellym/design"\n');
      const hostVersion = JSON.parse(await readFile("packages/vellym/package.json", "utf8")).version;
      server = await startDevServer({ configPath, uiRoot, hostVersion, port: 0 });
      const baseHash = createHash("sha256").update(source).digest("hex");
      const request = (pluginId: string, hash: string, origin?: string) => fetch(`${server!.url}/api/v1/plugins/resources/board`, {
        method: "DELETE", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify({ pluginId, baseHash: hash })
      });
      expect((await request("design", baseHash)).status).toBe(403);
      expect((await request("design", baseHash, "http://example.com")).status).toBe(403);
      expect((await request("other", baseHash, server.url)).status).toBe(403);
      expect((await request("design", "0".repeat(64), server.url)).status).toBe(409);
      expect(await readFile(file, "utf8")).toBe(source);
      const result = await request("design", baseHash, server.url);
      expect(result.status, await result.text()).toBe(200);
      await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await request("design", baseHash, server.url)).status).toBe(404);
    } finally {
      await server?.close();
      await rm(project, { recursive: true });
    }
  });
});
