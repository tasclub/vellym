import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer } from "@vellym-internal/runtime-node";

const exec = promisify(execFile);
const operations = ["history", "diff", "content", "change-diff"] as const;
let project: string;
let revision: string;
let server: Awaited<ReturnType<typeof startDevServer>>;

describe("Git path argument injection", () => {
  beforeAll(async () => {
    project = await mkdtemp(path.join(tmpdir(), "vellym-git-arguments-"));
    const git = async (...args: string[]) => (await exec("git", args, { cwd: project })).stdout.trim();
    await mkdir(path.join(project, "content"));
    await writeFile(path.join(project, "content/page.yaml"), "metadata:\n  name: page\n  title: Page\n");
    await writeFile(path.join(project, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
    await git("init", "-q");
    await git("add", ".");
    await git("-c", "user.name=Tester", "-c", "user.email=test@example.test", "-c", "commit.gpgSign=false", "commit", "-qm", "initial");
    revision = await git("rev-parse", "HEAD");
    await writeFile(path.join(project, "content/page.yaml"), "metadata:\n  name: page\n  title: Changed\n");
    server = await startDevServer({ configPath: path.join(project, "vellym.config.yaml"), uiRoot: project, port: 0 });
  });
  afterAll(async () => {
    if (server) await server.close();
    if (project) await rm(project, { recursive: true, force: true });
  });

  async function request(operation: typeof operations[number], file: string) {
    const query = new URLSearchParams({ path: file, ...(operation === "content" ? { revision } : {}) });
    return fetch(`${server.url}/api/v1/git/${operation}?${query}`);
  }

  it.each(operations)("%s accepts a valid path", async operation => {
    expect((await request(operation, "page.yaml")).status).toBe(200);
  });

  it.each(operations.flatMap(operation => ["output", "-p", "--help"].map(attack => [operation, attack] as const)))(
    "%s treats %s as a path, not an option",
    async (operation, attack) => {
      const output = path.join(project, "x");
      const response = await request(operation, attack === "output" ? `--output=${output}` : attack);
      if (response.status >= 400 && response.status < 500) {
        expect(response.status).toBeLessThan(500);
      } else {
        expect(response.status).toBe(200);
        const { data } = await response.json();
        if (operation === "history") expect(data.commits).toEqual([]);
        else if (operation === "content") expect(data.source ?? "").toBe("");
        else expect(data.diff ?? "").toBe("");
      }
      await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );
});
