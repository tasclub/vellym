import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = path.resolve("packages/vellym/dist/cli.mjs");

type EnvelopeBody = {
  apiSchemaVersion: string;
  data: unknown;
  diagnostics: Array<{ code: string; severity: string; message: string }>;
};

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
  return address.port;
}

// 応答の契約を検査する2つの一時プロジェクト: プラグイン無しとtickets有り。
// 作るのはYAML直接（initの引数に依存しない）。起動の仕方は
// relations-validate.integration.test.tsのdev API検査に倣う（そのファイルは変えない）。
async function createProject(withTickets: boolean): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-plugin-view-route-"));
  const content = path.join(root, "content");
  await mkdir(content);
  if (withTickets) {
    // workspaceのnode_modules/@vellym（pluginパッケージへのlink）を解決させる。
    await mkdir(path.join(root, "node_modules"));
    await symlink(
      path.resolve("node_modules/@vellym"),
      path.join(root, "node_modules/@vellym"),
      "dir"
    );
  }
  await writeFile(
    path.join(root, "vellym.config.yaml"),
    [
      'schemaVersion: "1.0"',
      "contentRoot: content",
      "outputDir: dist",
      "ui:",
      "  language: en",
      "i18n:",
      "  defaultLocale: en",
      withTickets ? 'plugins: ["@vellym/tickets"]' : "plugins: []"
    ].join("\n") + "\n"
  );
  await writeFile(
    path.join(content, "topic.yaml"),
    [
      "apiVersion: vellym.tasclub.com/v1",
      "kind: Page",
      "metadata:",
      "  name: topic",
      "  title: Topic page",
      "  slug: topic",
      "spec:",
      "  locale: en",
      "  blocks:",
      "    - id: body",
      "      type: rich-text",
      "      format: commonmark",
      "      content: Body",
      ""
    ].join("\n")
  );
  if (withTickets) {
    await writeFile(
      path.join(content, "tracker.yaml"),
      [
        "apiVersion: vellym.tasclub.com/v1",
        "kind: TicketTracker",
        "metadata:",
        "  name: tracker",
        "  title: Fixture tracker",
        "spec:",
        "  statuses:",
        "    - id: todo",
        "      label: Todo",
        "      category: open",
        "  fields:",
        "    - id: parent",
        "      label: Parent",
        "      type: reference",
        "  hierarchy:",
        "    parentField: parent",
        ""
      ].join("\n")
    );
    await mkdir(path.join(content, "+tickets"));
    await writeFile(
      path.join(content, "+tickets", "one.yaml"),
      [
        "apiVersion: vellym.tasclub.com/v1",
        "kind: Ticket",
        "metadata:",
        "  name: one",
        "  title: Fixture ticket",
        "spec:",
        "  status: todo",
        "  fields: {}",
        "  blocks: []",
        ""
      ].join("\n")
    );
  }
  return root;
}

async function startDev(root: string): Promise<{ origin: string; child: ChildProcess }> {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [cli, "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)], {
    cwd: root
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        const response = await fetch(`${origin}/api/v1/bootstrap`, { signal: AbortSignal.timeout(1_000) });
        await response.arrayBuffer();
        if (response.status === 200) return { origin, child };
      } catch {
        // The dev server is still starting.
      }
      if (child.exitCode !== null) throw new Error(`dev exited: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`dev did not become ready in 30s: ${stderr}`);
  } catch (error) {
    await stopDev(child);
    throw error;
  }
}

async function stopDev(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

describe("plugin view route response contract", () => {
  const servers: Array<{ root: string; origin: string; child: ChildProcess }> = [];

  async function fetchView(origin: string, name: string): Promise<{ status: number; body: EnvelopeBody }> {
    const response = await fetch(`${origin}/api/v1/plugins/views/${name}`);
    return { status: response.status, body: await response.json() as EnvelopeBody };
  }

  beforeAll(async () => {
    for (const withTickets of [false, true]) {
      const root = await createProject(withTickets);
      try {
        servers.push({ root, ...(await startDev(root)) });
      } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
      }
    }
  }, 90_000);

  afterAll(async () => {
    for (const server of servers) {
      await stopDev(server.child);
      await rm(server.root, { recursive: true, force: true });
    }
  });

  it("returns 200 with data null when the resource exists but has no view", async () => {
    const plain = servers[0]!;
    const { status, body } = await fetchView(plain.origin, "topic");
    expect(status).toBe(200);
    expect(body.data).toBeNull();
  });

  it("returns 404 NOT_FOUND only when the resource itself is missing", async () => {
    const plain = servers[0]!;
    const { status, body } = await fetchView(plain.origin, "absent-resource");
    expect(status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.diagnostics.map(({ code }) => code)).toContain("NOT_FOUND");
  });

  it("returns 200 with the view payload for a resource whose kind has a view", async () => {
    const withTickets = servers[1]!;
    const { status, body } = await fetchView(withTickets.origin, "one");
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      pluginId: "tickets",
      viewId: "ticket-detail",
      target: expect.objectContaining({ name: "one" })
    });
  }, 20_000);
});
