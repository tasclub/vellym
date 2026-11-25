import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { cliPath, repositoryRoot, test, expect } from "../fixtures.js";

test("runs the workflow build step and loads a subdirectory build", async ({
  project, staticServer, page
}) => {
  test.setTimeout(180_000);
  const workflow = parse(await readFile(path.join(repositoryRoot, "how-to-use/examples/github-pages.yml"), "utf8")) as {
    jobs: Record<string, { steps?: Array<{ run?: string }> }>;
  };
  const runScripts = (workflow.jobs.build?.steps ?? []).flatMap((step) => step.run ? [step.run] : []);
  expect(runScripts.filter((script) => script.trim() === "npm ci")).toHaveLength(1);
  const scriptsToRun = runScripts.filter((script) => script.trim() !== "npm ci");
  expect(scriptsToRun).toHaveLength(1);
  const binRoot = path.join(project.root, "node_modules/.bin");
  await mkdir(binRoot, { recursive: true });
  await symlink(cliPath, path.join(binRoot, "vellym"));
  const outputFile = path.join(project.root, "github-output.txt");
  await writeFile(outputFile, "");
  // Run the workflow verbatim, omitting only npm ci: the built CLI is linked above.
  execFileSync("bash", ["--noprofile", "--norc", "-e", "-u", "-o", "pipefail", "-c", scriptsToRun[0]!], {
    cwd: project.root,
    env: { ...process.env, CI: "1", GITHUB_OUTPUT: outputFile },
    encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024
  });
  const buildOutput = await readFile(outputFile, "utf8");
  const outputDir = buildOutput.match(/^path=(.+)$/m)?.[1];
  expect(outputDir).toBeTruthy();
  const artifactRoot = path.join(project.root, "site", "repo");
  await cp(outputDir!, artifactRoot, { recursive: true });
  const origin = await staticServer(artifactRoot, "/repo");
  const responses: Array<{ url: string; status: number }> = [];
  page.on("response", (response) => responses.push({ url: response.url(), status: response.status() }));
  await page.goto(`${origin}/repo/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("treegrid")).toBeVisible();
  await page.goto(`${origin}/repo/pages/topic/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Fixture topic", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Fixture body");
  expect(responses.filter(({ status }) => status === 404)).toEqual([]);
  expect(responses.every(({ url }) => new URL(url).pathname.startsWith("/repo/"))).toBe(true);
  for (const pattern of [/\/repo\/assets\/[^/]+\.js$/, /\/repo\/assets\/[^/]+\.css$/, /\/repo\/data\/.*\.json$/]) {
    expect(responses.some(({ url, status }) => status === 200 && pattern.test(url))).toBe(true);
  }
  // pageerror and console.error are asserted by the shared page fixture.
});
