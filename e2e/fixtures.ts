import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test as base, expect } from "@playwright/test";
import { stringify } from "yaml";

export const repositoryRoot = path.resolve(import.meta.dirname, "..");
export const cliPath = path.join(repositoryRoot, "packages/vellym/dist/cli.mjs");

type Project = { root: string; config: string; content: string; pageFile: string };
type Fixtures = {
  resources: Array<() => Promise<void>>;
  plugins: string[];
  project: Project;
  server: string;
  staticServer: (root: string, prefix: string) => Promise<string>;
};

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("No allocated port");
  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

export const test = base.extend<Fixtures>({
  plugins: [[], { option: true }],
  resources: async ({ project }, use) => {
    // Shared dependency: servers outlive page error assertions, but not the project.
    // Referencing project here also keeps its files until server shutdown completes.
    const cleanups: Array<() => Promise<void>> = [];
    try {
      await use(cleanups);
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
    }
  },
  project: async ({ plugins }, use) => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-e2e-"));
    try {
      const content = path.join(root, "content");
      const config = path.join(root, "vellym.config.yaml");
      const pageFile = path.join(content, "topic.yaml");
      await mkdir(content);
      if (plugins.length) {
        await mkdir(path.join(root, "node_modules"));
        await symlink(path.join(repositoryRoot, "node_modules/@vellym"), path.join(root, "node_modules/@vellym"));
      }
      await writeFile(config, stringify({
        schemaVersion: "1.0", contentRoot: "content", outputDir: "dist",
        ui: { language: "en" }, i18n: { defaultLocale: "en" },
        plugins: plugins.map((plugin) => `@vellym/${plugin}`)
      }));
      await writeFile(pageFile, stringify({
        apiVersion: "vellym.tasclub.com/v1", kind: "Page",
        metadata: { name: "topic", title: "Fixture topic", slug: "topic" },
        spec: { locale: "en", blocks: [
          { id: "body", type: "rich-text", format: "commonmark", content: "Fixture body" }
        ] }
      }));
      await use({ root, config, content, pageFile });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  server: async ({ project, resources }, use) => {
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [cliPath, "dev", "--config", project.config, "--port", String(port)], {
      cwd: project.root, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let failure: Error | undefined;
    child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
    child.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
    child.on("error", (error) => { failure = error; });
    resources.push(() => stop(child));
    const deadline = Date.now() + 30_000;
    while (true) {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Dev server exited:\n${output}`);
      }
      try {
        const response = await fetch(`${origin}/api/v1/bootstrap`, { signal: AbortSignal.timeout(1_000) });
        await response.arrayBuffer();
        if (response.status === 200) break;
      } catch { /* Startup may not yet have bound the port. */ }
      if (Date.now() >= deadline) throw new Error(`Dev server startup exceeded 30s:\n${output}`);
      await delay(100);
    }
    await use(origin);
  },
  staticServer: async ({ resources }, use) => {
    const servers: ReturnType<typeof createServer>[] = [];
    resources.push(async () => {
      for (const server of servers) {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
    await use(async (root, prefix) => {
      const server = createServer(async (request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
          response.writeHead(404).end();
          return;
        }
        let relative = pathname.slice(prefix.length).replace(/^\/+/, "");
        if (!relative || relative.endsWith("/")) relative += "index.html";
        const file = path.resolve(root, relative);
        if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) {
          response.writeHead(404).end();
          return;
        }
        try {
          const body = await readFile(file);
          const types: Record<string, string> = {
            ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"
          };
          response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
        } catch {
          response.writeHead(404).end();
        }
      });
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Static server did not bind");
      return `http://127.0.0.1:${address.port}`;
    });
  },
  page: async ({ page, resources }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`);
    });
    try {
      await use(page);
    } finally {
      await page.close();
      expect(errors, "Browser pageerror and console.error").toEqual([]);
    }
  }
});

export { expect } from "@playwright/test";
