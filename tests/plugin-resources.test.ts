import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginResource } from "../packages/runtime-node/src/plugin-resources.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("plugin resource creation", () => {
  it("checks each folder before creating anything beyond an outside symlink", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "vellym-resource-"));
    roots.push(base);
    const root = path.join(base, "content");
    const outside = path.join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, path.join(root, "link"));
    await expect(createPluginResource(root, {
      kind: "Page", name: "example", title: "Example", spec: {}, folder: "link/new/deep"
    })).rejects.toMatchObject({ code: "PATH_BOUNDARY" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("creates nested folders and refuses an existing name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-resource-"));
    roots.push(root);
    const draft = { kind: "Page", name: "example", title: "Example", spec: {}, folder: "one/two" };
    await expect(createPluginResource(root, draft)).resolves.toEqual({
      name: "example", relativePath: "one/two/example.yaml"
    });
    const file = path.join(root, "one/two/example.yaml");
    expect(await readFile(file, "utf8")).toContain("name: example");
    await writeFile(file, "original");
    await expect(createPluginResource(root, draft)).rejects.toMatchObject({
      status: 409, code: "RESOURCE_CREATE_CONFLICT"
    });
    expect(await readFile(file, "utf8")).toBe("original");
  });
});
