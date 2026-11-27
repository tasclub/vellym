import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stringify } from "yaml";

// The baseline predates the files created in A06/A07, just as in the manual flow.
export async function createCoreWorkspace(ctx) {
  const root = await ctx.temporary("core-workspace");
  const contentRoot = "docs";
  const result = ctx.cli(root, "init", "--language", "ja");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await ctx.write(root, `${contentRoot}/_index.yaml`, "apiVersion: vellym.tasclub.com/v1\nkind: Folder\nmetadata:\n  title: 文書\nspec:\n  locale: ja\n  order: []\n");
  ctx.git(root, "init", "-q");
  ctx.git(root, "config", "user.name", "Acceptance");
  ctx.git(root, "config", "user.email", "acceptance@example.invalid");
  ctx.git(root, "config", "commit.gpgSign", "false");
  ctx.git(root, "add", ".");
  ctx.git(root, "commit", "-qm", "manual acceptance baseline");

  const parent = "manual-acceptance/level-2/level-3/level-4";
  for (const directory of [parent, "manual-destination", "manual-archive-target"]) {
    await ctx.fs.mkdir(ctx.path.join(root, contentRoot, directory), { recursive: true });
  }
  async function pageFile(directory, title) {
    const name = `page-${randomUUID()}`;
    const relativePath = `${directory}/${name}.yaml`;
    const document = {
      apiVersion: "vellym.tasclub.com/v1", kind: "Page",
      metadata: { name, title },
      spec: { locale: "ja", blocks: [{ id: "body", type: "rich-text", format: "commonmark", content: "受入確認の本文\n" }] }
    };
    await ctx.write(root, `${contentRoot}/${relativePath}`, stringify(document));
    return { name, title, relativePath };
  }
  const editPage = await pageFile(parent, "Core受入・編集対象 更新後");
  const archivePages = [];
  for (const title of ["削除確認1", "削除確認2"]) archivePages.push(await pageFile("manual-archive-target", title));
  const server = await ctx.start(root);
  const page = await ctx.page(server.origin);
  const generated = await ctx.json(server.origin, "repository");
  return { root, contentRoot, editPage, archivePages, page, generated, ...server };
}
