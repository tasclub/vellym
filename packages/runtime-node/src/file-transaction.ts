import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";

export type FileOp =
  | { type: "create"; path: string; content: string }
  | { type: "update"; path: string; content: string; expectedHash: string };

export function fileHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Validate lexical paths and all existing ancestors, including symlinks. */
export async function checkFileBoundary(root: string, relative: string): Promise<void> {
  if (!relative || path.isAbsolute(relative) || /[\\\0]/.test(relative) ||
      relative.split("/").some(part => !part || part === "." || part === "..")) {
    throw new RuntimeError("不正なファイルパスです", 422, "PATH_BOUNDARY");
  }
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try { await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const resolved = await realpath(current);
    if (resolved !== root && !isInside(root, resolved)) {
      throw new RuntimeError("管理範囲外への書き込みは許可されていません", 422, "PATH_BOUNDARY");
    }
  }
}

function conflict(): never {
  throw new RuntimeError("対象が変更されました。もう一度確認してください", 409, "SETUP_PLAN_CONFLICT");
}

export async function applyFileTransaction(root: string, ops: FileOp[]): Promise<void> {
  root = await realpath(root);
  const seen = new Set<string>();
  // Preflight every update before creating even a directory.
  for (const op of ops) {
    await checkFileBoundary(root, op.path);
    if (seen.has(op.path)) conflict();
    seen.add(op.path);
    if (op.type === "update") {
      try {
        if (fileHash(await readFile(path.join(root, op.path))) !== op.expectedHash) conflict();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") conflict();
        throw error;
      }
    }
  }
  const directories: string[] = [];
  const temporary: string[] = [];
  const reserved: string[] = [];
  const updated: Array<{ target: string; source: Buffer }> = [];
  try {
    const staged: Array<{ op: FileOp; target: string; temp: string }> = [];
    for (const op of ops) {
      let directory = root;
      for (const part of op.path.split("/").slice(0, -1)) {
        directory = path.join(directory, part);
        try { await mkdir(directory); directories.push(directory); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        await checkFileBoundary(root, path.relative(root, directory));
        if (!(await stat(directory)).isDirectory()) throw new Error("Destination is not a directory");
        directory = await realpath(directory);
      }
      await checkFileBoundary(root, op.path);
      // Resolve existing in-bound symlinks for updates so rollback restores the
      // referent rather than replacing a user's symlink.
      const destination = path.join(directory, path.posix.basename(op.path));
      const target = op.type === "update" ? await realpath(destination) : destination;
      const temp = path.join(path.dirname(target), `.vellym-transaction-${randomBytes(12).toString("hex")}.tmp`);
      const handle = await open(temp, "wx");
      temporary.push(temp);
      try { await handle.writeFile(op.content, "utf8"); }
      finally { await handle.close(); }
      staged.push({ op, target, temp });
    }
    for (const { op, target } of staged) {
      if (op.type !== "create") continue;
      await checkFileBoundary(root, op.path);
      const handle = await open(target, "wx");
      reserved.push(target);
      await handle.close();
    }
    for (const { op, target, temp } of staged) {
      await checkFileBoundary(root, op.path);
      if (op.type === "update") {
        if (await realpath(path.join(root, op.path)) !== target) conflict();
        const source = await readFile(target);
        if (fileHash(source) !== op.expectedHash) conflict();
        updated.push({ target, source });
      }
      await rename(temp, target);
    }
  } catch (error) {
    const rollback = await Promise.allSettled([
      ...updated.map(({ target, source }) => writeFile(target, source)),
      ...[...reserved, ...temporary].map(target => rm(target, { force: true }))
    ]);
    let directoryFailed = false;
    for (const directory of directories.reverse()) {
      try { await rmdir(directory); }
      catch (cleanupError) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((cleanupError as NodeJS.ErrnoException).code ?? "")) directoryFailed = true;
      }
    }
    if (directoryFailed || rollback.some(result => result.status === "rejected")) {
      throw new RuntimeError("書き込みに失敗し、元に戻せませんでした", 500, "SETUP_ROLLBACK");
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") conflict();
    throw error;
  }
}
