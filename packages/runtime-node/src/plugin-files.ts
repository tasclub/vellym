import { randomUUID, createHash } from "node:crypto";
import { lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PluginFileKindContribution } from "@vellym/plugin-api";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";

const locks = new Map<string, Promise<void>>();

export async function savePluginFile(root: string, relativePath: string, value: unknown, baseHash: string | null, kinds: readonly PluginFileKindContribution[]): Promise<{ hash: string }> {
  const parts = relativePath.split("/");
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || parts.some(p => !p || p.startsWith("."))) {
    throw new RuntimeError("保存先が不正です", 422, "PATH_BOUNDARY");
  }
  const name = parts.at(-1)!;
  const kind = kinds.find(k => new RegExp(`^${k.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`).test(name));
  if (!kind) throw new RuntimeError("登録されていないファイルです", 403, "READ_ONLY");
  const text = JSON.stringify(value, null, 2);
  if (text === undefined || Buffer.byteLength(text + "\n") > kind.maxBytes) throw new RuntimeError("ファイルの内容が不正です", 422, "INVALID_JSON");
  const bytes = Buffer.from(text + "\n");
  const rootReal = await realpath(root);
  let directory = rootReal;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    if ((await lstat(directory)).isSymbolicLink()) throw new RuntimeError("保存先が不正です", 422, "PATH_BOUNDARY");
    const actual = await realpath(directory);
    if (!isInside(rootReal, actual)) throw new RuntimeError("保存先が不正です", 422, "PATH_BOUNDARY");
    directory = actual;
  }
  const target = path.join(directory, name);
  const previous = locks.get(target) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(target, current);
  await previous;
  try {
    let existing: Buffer | undefined;
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new RuntimeError("保存先が不正です", 422, "PATH_BOUNDARY");
      existing = await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (baseHash === null ? existing !== undefined : !existing || createHash("sha256").update(existing).digest("hex") !== baseHash) {
      throw new RuntimeError("外部変更を検出しました", 409, "HASH_CONFLICT");
    }
    const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { hash: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    release();
    if (locks.get(target) === current) locks.delete(target);
  }
}
