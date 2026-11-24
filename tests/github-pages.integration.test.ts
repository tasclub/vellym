import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type WorkflowStep = {
  id?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};

type Workflow = {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
};

type GuidePage = {
  spec: {
    blocks: Array<{ content: string }>;
    translations?: { en?: { blocks: Array<{ content: string }> } };
  };
};

const repositoryRoot = process.cwd();
const workflowPath = path.join(repositoryRoot, "how-to-use/examples/github-pages.yml");
const guidePath = path.join(repositoryRoot, "how-to-use/content/self-hosting.yaml");

async function readWorkflow(): Promise<{ source: string; workflow: Workflow }> {
  const source = await readFile(workflowPath, "utf8");
  return { source, workflow: parse(source) as Workflow };
}

describe("GitHub Pages guide example", () => {
  it("keeps the Japanese and English guide copies identical to the canonical workflow", async () => {
    const [{ source }, guideSource] = await Promise.all([
      readWorkflow(),
      readFile(guidePath, "utf8")
    ]);
    const guide = parse(guideSource) as GuidePage;
    const codeBlock = `\`\`\`yaml\n${source.trimEnd()}\n\`\`\``;

    expect(guide.spec.blocks[0]?.content).toContain(codeBlock);
    expect(guide.spec.translations?.en?.blocks[0]?.content).toContain(codeBlock);
  });

  it("runs the workflow build step and loads a subdirectory build in Playwright", async () => {
    const { workflow } = await readWorkflow();
    const buildSteps = workflow.jobs.build?.steps ?? [];
    const uses = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).flatMap((step) => step.uses ? [step.uses] : [])
    );

    expect(uses).toEqual([
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "actions/upload-pages-artifact@v3",
      "actions/deploy-pages@v4"
    ]);
    expect(uses.every((action) => /@v\d+$/.test(action))).toBe(true);
    expect(
      buildSteps.find((step) => step.uses === "actions/upload-pages-artifact@v3")?.with?.path
    ).toBe("${{ steps.build.outputs.path }}");

    const runScripts = buildSteps.flatMap((step) => step.run ? [step.run] : []);
    expect(runScripts.filter((script) => script.trim() === "npm ci")).toHaveLength(1);
    const scriptsToRun = runScripts.filter((script) => script.trim() !== "npm ci");
    expect(scriptsToRun).toHaveLength(1);

    const tempRoot = await mkdtemp(path.join(tmpdir(), "vellym-github-pages-"));
    let server: Server | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      const projectRoot = path.join(tempRoot, "project");
      const contentRoot = path.join(projectRoot, "content");
      const binRoot = path.join(projectRoot, "node_modules/.bin");
      const outputFile = path.join(tempRoot, "github-output.txt");
      await mkdir(contentRoot, { recursive: true });
      await mkdir(binRoot, { recursive: true });
      await symlink(
        path.join(repositoryRoot, "packages/vellym/dist/cli.mjs"),
        path.join(binRoot, "vellym")
      );
      await writeFile(
        path.join(projectRoot, "vellym.config.yaml"),
        [
          'schemaVersion: "1.0"',
          "contentRoot: content",
          "outputDir: dist",
          "ui:",
          "  language: en",
          "i18n:",
          "  defaultLocale: en",
          "plugins: []"
        ].join("\n") + "\n",
        "utf8"
      );
      await writeFile(
        path.join(contentRoot, "github-pages-topic.yaml"),
        [
          "apiVersion: vellym.tasclub.com/v1alpha1",
          "kind: Page",
          "metadata:",
          "  name: github-pages-topic",
          "  title: GitHub Pages topic fixture",
          "  slug: github-pages-topic",
          "spec:",
          "  locale: en",
          "  blocks:",
          "    - id: body",
          "      type: rich-text",
          "      format: commonmark",
          "      content: Subdirectory fixture body"
        ].join("\n") + "\n",
        "utf8"
      );
      await writeFile(outputFile, "", "utf8");

      // Execute the workflow's run step verbatim, omitting only `npm ci` because the
      // test uses the built CLI linked into the temporary project's local bin.
      execFileSync(
        "bash",
        ["--noprofile", "--norc", "-e", "-u", "-o", "pipefail", "-c", scriptsToRun[0]!],
        {
          cwd: projectRoot,
          env: { ...process.env, CI: "1", GITHUB_OUTPUT: outputFile },
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024
        }
      );

      const buildOutput = await readFile(outputFile, "utf8");
      const outputDir = buildOutput.match(/^path=(.+)$/m)?.[1];
      expect(outputDir).toBeTruthy();
      const artifactRoot = path.join(tempRoot, "site", "repo");
      await cp(outputDir!, artifactRoot, { recursive: true });

      const responses: Array<{ url: string; status: number }> = [];
      const pageErrors: string[] = [];
      server = createServer(async (request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname !== "/repo" && !pathname.startsWith("/repo/")) {
          response.writeHead(404).end();
          return;
        }
        let relative = pathname.slice("/repo".length).replace(/^\/+/, "");
        if (!relative || relative.endsWith("/")) relative += "index.html";
        const filePath = path.resolve(artifactRoot, relative);
        if (!filePath.startsWith(`${path.resolve(artifactRoot)}${path.sep}`)) {
          response.writeHead(404).end();
          return;
        }
        try {
          const body = await readFile(filePath);
          const contentType = filePath.endsWith(".html")
            ? "text/html; charset=utf-8"
            : filePath.endsWith(".js")
              ? "text/javascript; charset=utf-8"
              : filePath.endsWith(".css")
                ? "text/css; charset=utf-8"
                : filePath.endsWith(".json")
                  ? "application/json; charset=utf-8"
                  : "application/octet-stream";
          response.writeHead(200, { "content-type": contentType }).end(body);
        } catch {
          response.writeHead(404).end();
        }
      });
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Static server did not bind");

      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      page.on("response", (response) => {
        responses.push({ url: response.url(), status: response.status() });
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const origin = `http://127.0.0.1:${address.port}`;

      await page.goto(`${origin}/repo/`, { waitUntil: "networkidle" });
      await page.locator("#root > *").waitFor({ state: "attached" });

      await page.goto(`${origin}/repo/pages/github-pages-topic/`, {
        waitUntil: "networkidle"
      });
      await page.getByText("Subdirectory fixture body").waitFor({ state: "visible" });

      expect(responses.filter(({ status }) => status === 404)).toEqual([]);
      expect(
        responses.every(({ url }) => new URL(url).pathname.startsWith("/repo/"))
      ).toBe(true);
      expect(
        responses.some(({ url, status }) => status === 200 && /\/repo\/assets\/[^/]+\.js$/.test(url))
      ).toBe(true);
      expect(
        responses.some(({ url, status }) => status === 200 && /\/repo\/assets\/[^/]+\.css$/.test(url))
      ).toBe(true);
      expect(
        responses.some(({ url, status }) => status === 200 && /\/repo\/data\/.*\.json$/.test(url))
      ).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser?.close();
      if (server?.listening) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
    // ビルドの手順に120秒まで待つので、テスト自体の上限はそれより長くする（既定の5秒ではCIで切れる）。
  }, 180_000);
});
