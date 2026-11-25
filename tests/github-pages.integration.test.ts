import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type WorkflowStep = {
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};
type Workflow = { jobs: Record<string, { steps?: WorkflowStep[] }> };
type GuidePage = {
  spec: {
    blocks: Array<{ content: string }>;
    translations?: { en?: { blocks: Array<{ content: string }> } };
  };
};
const repositoryRoot = process.cwd();

async function readWorkflow(): Promise<{ source: string; workflow: Workflow }> {
  const source = await readFile(path.join(repositoryRoot, "how-to-use/examples/github-pages.yml"), "utf8");
  return { source, workflow: parse(source) as Workflow };
}

describe("GitHub Pages guide example", () => {
  it("keeps the Japanese and English guide copies identical to the canonical workflow", async () => {
    const [{ source }, guideSource] = await Promise.all([
      readWorkflow(), readFile(path.join(repositoryRoot, "how-to-use/content/self-hosting.yaml"), "utf8")
    ]);
    const guide = parse(guideSource) as GuidePage;
    const codeBlock = `\`\`\`yaml\n${source.trimEnd()}\n\`\`\``;
    expect(guide.spec.blocks[0]?.content).toContain(codeBlock);
    expect(guide.spec.translations?.en?.blocks[0]?.content).toContain(codeBlock);
  });

  it("pins workflow actions and connects the uploaded artifact to the build output", async () => {
    const { workflow } = await readWorkflow();
    const buildSteps = workflow.jobs.build?.steps ?? [];
    const uses = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).flatMap((step) => step.uses ? [step.uses] : [])
    );
    expect(uses).toEqual([
      "actions/checkout@v4", "actions/setup-node@v4",
      "actions/upload-pages-artifact@v3", "actions/deploy-pages@v4"
    ]);
    expect(uses.every((action) => /@v\d+$/.test(action))).toBe(true);
    expect(buildSteps.find((step) => step.uses === "actions/upload-pages-artifact@v3")?.with?.path)
      .toBe("${{ steps.build.outputs.path }}");
    const runScripts = buildSteps.flatMap((step) => step.run ? [step.run] : []);
    expect(runScripts.filter((script) => script.trim() === "npm ci")).toHaveLength(1);
    expect(runScripts.filter((script) => script.trim() !== "npm ci")).toHaveLength(1);
  });
});
