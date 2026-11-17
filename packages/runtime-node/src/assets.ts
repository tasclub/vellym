import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isAssetPath, type Diagnostic } from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";
import type { LoadedConfig, RepositorySnapshot } from "./types.js";

const extensions: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif"
};

function imageType(body: Buffer): string | undefined {
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(body.toString("ascii", 0, 6))) return "image/gif";
  if (body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (body.length >= 16 && body.toString("ascii", 4, 8) === "ftyp") {
    const size = body.readUInt32BE(0);
    if (size >= 16 && size <= body.length) {
      for (let i = 8; i + 4 <= size; i += 4) {
        if (i !== 12 && ["avif", "avis"].includes(body.toString("ascii", i, i + 4))) return "image/avif";
      }
    }
  }
  return undefined;
}

async function assetFile(root: string, relativePath: string): Promise<string> {
  if (!isAssetPath(relativePath)) throw new RuntimeError("Invalid asset path", 400, "ASSET_PATH");
  const realRoot = await realpath(root);
  const file = await realpath(path.join(realRoot, relativePath));
  if (!isInside(realRoot, file) || !(await stat(file)).isFile()) {
    throw new RuntimeError("Asset is outside its root or is not a file", 403, "ASSET_PATH");
  }
  return file;
}

export async function readAsset(root: string, relativePath: string): Promise<{ body: Buffer; mime: string }> {
  try {
    const file = await assetFile(root, relativePath);
    const mime = extensions[path.extname(relativePath).slice(1).toLowerCase()];
    if (!mime) throw new RuntimeError("Unsupported image type", 415, "ASSET_TYPE");
    const body = await readFile(file);
    if (imageType(body) !== mime) throw new RuntimeError("Unsupported image type", 415, "ASSET_TYPE");
    return { body, mime };
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError("Asset is unavailable", 404, "ASSET_NOT_FOUND");
  }
}

function ulid(now: Date): string {
  let value = (BigInt(now.getTime()) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`);
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let result = "";
  for (let i = 0; i < 26; i++) { result = alphabet[Number(value & 31n)] + result; value >>= 5n; }
  return result;
}

/** Uses only generated names, never a caller-supplied filename. */
export async function saveAsset(
  config: Pick<LoadedConfig, "assetsRoot" | "assetsMaxBytes">,
  body: Buffer,
  mime: string,
  now = new Date()
): Promise<{ path: string; url: string }> {
  if (body.length > config.assetsMaxBytes) throw new RuntimeError("Image is too large", 413, "ASSET_LIMIT");
  const extension = Object.keys(extensions).find((key) => extensions[key] === mime);
  if (!extension || imageType(body) !== mime) throw new RuntimeError("Unsupported image type", 415, "ASSET_TYPE");
  await mkdir(config.assetsRoot, { recursive: true });
  const root = await realpath(config.assetsRoot);
  const parts = [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0")];
  let directory = root;
  for (const part of parts) {
    const next = path.join(directory, part);
    try { await mkdir(next); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    directory = await realpath(next);
    if (!isInside(root, directory) || !(await stat(directory)).isDirectory()) {
      throw new RuntimeError("Asset directory is outside its root", 403, "ASSET_PATH");
    }
  }
  const filename = `${ulid(now)}.${extension}`;
  await writeFile(path.join(directory, filename), body, { flag: "wx" });
  const relativePath = [...parts, filename].join("/");
  return { path: relativePath, url: `asset:${relativePath}` };
}

export async function diagnoseAssets(config: LoadedConfig, snapshot: RepositorySnapshot): Promise<Diagnostic[]> {
  const references = snapshot.pages.flatMap((page) => (page.assetReferences ?? []).map((reference) => ({ ...reference, file: page.relativePath })));
  if (!references.length) return [];
  try {
    if (!(await stat(config.assetsRoot)).isDirectory()) throw new Error("Not a directory");
    // Check readability too (for example a disconnected or inaccessible NAS).
    const { opendir } = await import("node:fs/promises");
    await (await opendir(config.assetsRoot)).close();
  } catch {
    return [{ file: config.configPath, path: "/assets/root", severity: "warning", code: "ASSETS_UNAVAILABLE", message: { ja: "画像フォルダに届かないため参照先を確かめられません", en: "Cannot verify image references: the assets folder is unavailable" } }];
  }
  const diagnostics: Diagnostic[] = [];
  for (const reference of references) {
    try { await readAsset(config.assetsRoot, reference.relativePath); }
    catch (error) {
      const code = error instanceof RuntimeError ? error.code : "ASSET_NOT_FOUND";
      diagnostics.push({ file: reference.file, path: reference.path, severity: "error", code, message: { ja: `画像の参照先が無いか利用できません: asset:${reference.relativePath}`, en: `Image reference is missing or unusable: asset:${reference.relativePath}` } });
    }
  }
  return diagnostics;
}
