import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { startDevServer } from "@vellym-internal/runtime-node";

export async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "vellym-path-security-"));
  const project = path.join(dir, "project"), content = path.join(project, "content");
  const marker = `OUTSIDE-MARKER-${randomUUID()}`;
  await mkdir(path.join(content, "section"), { recursive: true });
  await mkdir(path.join(project, "assets"));
  await mkdir(path.join(project, "node_modules/file-kind"), { recursive: true });
  await mkdir(path.join(dir, "outside"));
  for (const file of ["outside.yaml", "outside.png", "outside.tokens.json"]) await writeFile(path.join(dir, file), marker);
  await writeFile(path.join(dir, "outside/marker.yaml"), marker);
  await writeFile(path.join(content, "page.yaml"), "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: example\n  title: Example\nspec:\n  blocks: []\n");
  await writeFile(path.join(content, "section/_index.yaml"), "title: Section\n");
  await writeFile(path.join(project, "assets/image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  await writeFile(path.join(project, "index.html"), "<h1>UI</h1>");
  await writeFile(path.join(project, "node_modules/file-kind/package.json"), JSON.stringify({ name: "file-kind", type: "module", main: "index.mjs", engines: { vellym: ">=0.3.0-beta" }, vellym: { id: "file-kind", contributes: { kinds: [{ kind: "Canvas" }] } } }));
  await writeFile(path.join(project, "node_modules/file-kind/index.mjs"), 'export function activate(host) { host.registerKind({kind: "Canvas"}); host.registerFileKind({id: "tokens", pattern: "*.tokens.json", format: "json", maxBytes: 1024}); }');
  const configPath = path.join(project, "vellym.config.yaml");
  await writeFile(configPath, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: output\nui: { language: en }\nplugins: [file-kind]\n');
  if (process.platform !== "win32") {
    await symlink(path.join(dir, "outside.yaml"), path.join(content, "link.yaml"));
    await symlink(path.join(dir, "outside.png"), path.join(project, "assets/link.png"));
    await symlink(path.join(dir, "outside.tokens.json"), path.join(content, "link.tokens.json"));
    await symlink(path.join(dir, "outside"), path.join(content, "link-dir"));
    await symlink(path.join(dir, "outside"), path.join(project, "link-dir"));
  }
  const exec = promisify(execFile);
  const git = (...args: string[]) => exec("git", args, { cwd: project });
  await git("init", "-q"); await git("add", ".");
  await git("-c", "user.name=Tester", "-c", "user.email=test@example.test", "-c", "commit.gpgSign=false", "commit", "-qm", "initial");
  const revision = (await git("rev-parse", "HEAD")).stdout.trim();
  await writeFile(path.join(content, "page.yaml"), "apiVersion: vellym.tasclub.com/v1\nkind: Page\nmetadata:\n  name: example\n  title: Changed\nspec:\n  blocks: []\n");
  const server = await startDevServer({ configPath, uiRoot: project, port: 0, hostVersion: "0.6.0" });
  async function outsideSnapshot() {
    async function walk(folder: string, prefix = ""): Promise<string[]> {
      const result: string[] = [];
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!prefix && entry.name === "project") continue;
        const name = path.join(prefix, entry.name), file = path.join(folder, entry.name);
        if (entry.isDirectory()) result.push(`dir:${name}`, ...await walk(file, name));
        else result.push(`${name}:${createHash("sha256").update(await readFile(file)).digest("hex")}`);
      }
      return result.sort();
    }
    return walk(dir);
  }
  return { dir, project, marker, revision, server, outsideSnapshot, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }); } };
}
