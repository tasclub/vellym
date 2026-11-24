import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRepository } from "../packages/runtime-node/src/repository.js";

const cli = path.resolve("packages/vellym/dist/cli.mjs");
const referenceCodes = [
  "BROKEN_PAGE_REFERENCE",
  "BROKEN_HEADING_REFERENCE",
  "AMBIGUOUS_PAGE_REFERENCE"
];

interface Fixture {
  root: string;
  contentRoot: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-relations-validate-"));
  const contentRoot = path.join(root, "content");
  await mkdir(contentRoot);
  await writeFile(
    path.join(root, "vellym.config.yaml"),
    `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: ja
plugins: []
`
  );
  await writeFile(
    path.join(contentRoot, "source.yaml"),
    `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: source-page
  title: Source
spec:
  locale: ja
  blocks:
    - id: intro
      type: rich-text
      format: commonmark
      content: Start
    - id: body
      type: rich-text
      format: commonmark
      content: |
        [[missing-page]] and [[missing-page]].
        [[target-page#Absent heading]]
        [[Duplicate title]]
  translations:
    en:
      visibility: published
      title: Source
      blocks:
        - id: translated-intro
          type: rich-text
          format: commonmark
          content: Translation
        - id: translated-body
          type: rich-text
          format: commonmark
          content: "[[published-missing]]"
    fr:
      visibility: draft
      title: Source FR
      blocks:
        - id: draft-body
          type: rich-text
          format: commonmark
          content: "[[draft-missing]]"
`
  );
  await writeFile(
    path.join(contentRoot, "target.yaml"),
    `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: target-page
  title: Target
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: This page has no headings.
`
  );
  for (const [name, file] of [
    ["duplicate-one", "duplicate-one.yaml"],
    ["duplicate-two", "duplicate-two.yaml"]
  ] as const) {
    await writeFile(
      path.join(contentRoot, file),
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata:
  name: ${name}
  title: Duplicate title
spec:
  blocks: []
`
    );
  }
  await writeFile(
    path.join(contentRoot, "ticket-source.yaml"),
    `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ticket-source
  title: Ticket source
spec:
  blocks:
    - id: ticket-intro
      type: rich-text
      format: commonmark
      content: Start
    - id: ticket-body
      type: rich-text
      format: commonmark
      content: "[[ticket-missing]]"
`
  );
  return { root, contentRoot };
}

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8"
  });
}

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

describe("repository reference diagnostics in validate and dev", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  });

  it("reports Page and Ticket reference issues with localized diagnostic details", async () => {
    const snapshot = await loadRepository(fixture.contentRoot, undefined, {
      knownKinds: new Set(["Ticket"])
    });
    const diagnostics = snapshot.diagnostics.filter(({ code }) =>
      referenceCodes.includes(code)
    );

    expect(diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(referenceCodes));
    expect(diagnostics).toHaveLength(5);
    expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(true);
    expect(diagnostics.some(({ message }) => JSON.stringify(message).includes("draft-missing"))).toBe(false);

    const missingPage = diagnostics.find(({ file, code, path: itemPath }) =>
      file === "source.yaml" &&
      code === "BROKEN_PAGE_REFERENCE" &&
      itemPath === "/spec/blocks/1"
    );
    expect(missingPage).toBeDefined();
    expect(missingPage?.message).toMatchObject({
      ja: expect.stringContaining("source-page"),
      en: expect.stringContaining("source-page")
    });
    for (const message of Object.values(missingPage?.message ?? {})) {
      expect(message).toContain("source.yaml");
      expect(message).toContain("body");
      expect(message).toContain("[[missing-page]]");
    }

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "source.yaml",
        path: "/spec/blocks/1",
        code: "BROKEN_HEADING_REFERENCE",
        severity: "warning",
        message: {
          ja: expect.stringContaining("[[target-page#Absent heading]]"),
          en: expect.stringContaining("[[target-page#Absent heading]]")
        }
      }),
      expect.objectContaining({
        file: "source.yaml",
        path: "/spec/blocks/1",
        code: "AMBIGUOUS_PAGE_REFERENCE",
        severity: "warning",
        message: {
          ja: expect.stringContaining("Duplicate title"),
          en: expect.stringContaining("Duplicate title")
        }
      }),
      expect.objectContaining({
        file: "source.yaml",
        path: "/spec/translations/en/blocks/1",
        code: "BROKEN_PAGE_REFERENCE",
        message: {
          ja: expect.stringContaining("[[published-missing]]"),
          en: expect.stringContaining("[[published-missing]]")
        }
      }),
      expect.objectContaining({
        file: "ticket-source.yaml",
        path: "/spec/blocks/1",
        code: "BROKEN_PAGE_REFERENCE",
        message: {
          ja: expect.stringContaining("ticket-source"),
          en: expect.stringContaining("ticket-source")
        }
      })
    ]));
  });

  it("includes link warnings in validate --json and fails only in strict mode", () => {
    const regular = runCli(
      ["validate", "--json"],
      fixture.root
    );
    expect(regular.error).toBeUndefined();
    expect(regular.status, regular.stderr).toBe(0);
    const regularDiagnostics = JSON.parse(regular.stdout).diagnostics as Array<{
      code: string;
      message: string;
    }>;
    expect(regularDiagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(referenceCodes)
    );
    expect(regularDiagnostics.some(({ message }) => message.includes("draft-missing"))).toBe(false);

    const strict = runCli(["validate", "--strict", "--json"], fixture.root);
    expect(strict.error).toBeUndefined();
    expect(strict.status, strict.stderr).toBe(1);
    const strictDiagnostics = JSON.parse(strict.stdout).diagnostics as Array<{
      code: string;
      message: string;
    }>;
    expect(strictDiagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(referenceCodes)
    );
  });

  it("exposes the same warning diagnostics from dev's repository API", async () => {
    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [cli, "dev", "--port", String(port)], {
      cwd: fixture.root
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    try {
      let payload:
        | { diagnostics: Array<{ code: string; severity: string }> }
        | undefined;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        try {
          const response = await fetch(`${origin}/api/v1/repository`);
          if (response.ok) {
            payload = await response.json() as typeof payload;
            break;
          }
        } catch {
          // The dev server is still starting.
        }
        if (child.exitCode !== null) throw new Error(`dev exited: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(payload, stderr).toBeDefined();
      const diagnostics = payload!.diagnostics.filter(({ code }) =>
        referenceCodes.includes(code)
      );
      expect(diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining(referenceCodes)
      );
      expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
  }, 20000);
});
