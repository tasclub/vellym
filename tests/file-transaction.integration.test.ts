import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { applyFileTransaction, fileHash } from "../packages/runtime-node/src/file-transaction.js";

const faults = vi.hoisted(() => ({ renames: 0, failAt: 0, mutate: "" }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
    faults.renames++;
    if (faults.renames === faults.failAt) throw new Error("injected failure");
    if (faults.mutate) {
      const target = faults.mutate;
      faults.mutate = "";
      await actual.writeFile(target, "external change");
    }
    return actual.rename(...args);
  }) };
});
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "vellym-transaction-"));
  Object.assign(faults, { renames: 0, failAt: 0, mutate: "" });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("file transactions", () => {
  it("creates nested files and updates existing files", async () => {
    await fs.writeFile(path.join(root, "old"), "before");
    await applyFileTransaction(root, [
      { type: "create", path: "nested/new", content: "new" },
      { type: "update", path: "old", content: "after", expectedHash: fileHash("before") }
    ]);
    expect(await fs.readFile(path.join(root, "old"), "utf8")).toBe("after");
    expect(await fs.readdir(root, { recursive: true })).toEqual(["nested", "old", "nested/new"]);
  });
  it("checks all update hashes before any write", async () => {
    await fs.writeFile(path.join(root, "old"), "before");
    await expect(applyFileTransaction(root, [
      { type: "create", path: "nested/new", content: "new" },
      { type: "update", path: "old", content: "after", expectedHash: fileHash("stale") }
    ])).rejects.toMatchObject({ status: 409 });
    expect(await fs.readdir(root)).toEqual(["old"]);
    expect(await fs.readFile(path.join(root, "old"), "utf8")).toBe("before");
  });
  it.each([1, 2, 3])("restores updates and removes all created files/directories on rename failure %i", async failAt => {
    await fs.writeFile(path.join(root, "old"), "before");
    faults.failAt = failAt;
    await expect(applyFileTransaction(root, [
      { type: "update", path: "old", content: "after", expectedHash: fileHash("before") },
      { type: "create", path: "nested/a", content: "a" },
      { type: "create", path: "nested/b", content: "b" }
    ])).rejects.toThrow("injected failure");
    expect(await fs.readdir(root)).toEqual(["old"]);
    expect(await fs.readFile(path.join(root, "old"), "utf8")).toBe("before");
  });
  it("rechecks updates immediately before replacement", async () => {
    await fs.writeFile(path.join(root, "old"), "before");
    faults.mutate = path.join(root, "old");
    await expect(applyFileTransaction(root, [
      { type: "create", path: "nested/new", content: "new" },
      { type: "update", path: "old", content: "after", expectedHash: fileHash("before") }
    ])).rejects.toMatchObject({ status: 409 });
    expect(await fs.readdir(root)).toEqual(["old"]);
    expect(await fs.readFile(path.join(root, "old"), "utf8")).toBe("external change");
  });
  it("does not overwrite existing creates", async () => {
    await fs.writeFile(path.join(root, "old"), "before");
    await expect(applyFileTransaction(root, [{ type: "create", path: "old", content: "after" }]))
      .rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(path.join(root, "old"), "utf8")).toBe("before");
    expect(await fs.readdir(root)).toEqual(["old"]);
  });
  it("rejects traversal, absolute paths and escaping symlinks before writes", async () => {
    for (const relative of ["../escape", "/escape", "nested/../../escape", "nested\\escape"]) {
      await expect(applyFileTransaction(root, [{ type: "create", path: relative, content: "" }]))
        .rejects.toMatchObject({ status: 422 });
    }
    await fs.symlink(path.dirname(root), path.join(root, "link"));
    await expect(applyFileTransaction(root, [{ type: "create", path: "link/escape", content: "" }]))
      .rejects.toMatchObject({ status: 422 });
    expect(await fs.readdir(root)).toEqual(["link"]);
  });
});
