import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isAssetPath, type Diagnostic } from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { isInside } from "./path-utils.js";
import type { LoadedConfig, RepositorySnapshot } from "./types.js";

const extensions: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif"
};

const fontExtensions: Record<string, string> = {
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf"
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

function fontType(body: Buffer): string | undefined {
  const signature = body.toString("ascii", 0, 4);
  if (signature === "wOF2") return "font/woff2";
  if (signature === "wOFF") return "font/woff";
  if (body.length >= 4 && body[0] === 0 && body[1] === 1 && body[2] === 0 && body[3] === 0) return "font/ttf";
  if (signature === "OTTO") return "font/otf";
  return undefined;
}

function licenseText(body: Buffer): boolean {
  if (!body.length) return false;
  const text = body.toString("utf8");
  return !text.includes("\0") && Buffer.from(text, "utf8").equals(body);
}

function fontFamilyName(value: string | undefined): string {
  const family = value?.normalize("NFC");
  if (
    !family ||
    family !== family.trim() ||
    family.length > 120 ||
    family === "." ||
    family === ".." ||
    /[\/\\\x00-\x1f\x7f]/.test(family)
  ) {
    throw new RuntimeError("Invalid font family", 400, "ASSET_PATH");
  }
  return family;
}

function fontAssetPath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts.length === 3 &&
    parts[0] === "fonts" &&
    !!parts[2] &&
    (() => {
      try {
        fontFamilyName(parts[1]);
        return true;
      } catch {
        return false;
      }
    })();
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
    const extension = path.extname(relativePath).slice(1).toLowerCase();
    const imageMime = extensions[extension];
    const fontMime = fontAssetPath(relativePath) ? fontExtensions[extension] : undefined;
    const isLicense = fontAssetPath(relativePath) && path.basename(relativePath) === "LICENSE.txt";
    const mime = imageMime ?? fontMime ?? (isLicense ? "text/plain; charset=utf-8" : undefined);
    if (!mime) throw new RuntimeError("Unsupported asset type", 415, "ASSET_TYPE");
    const body = await readFile(file);
    if (
      (imageMime && imageType(body) !== mime) ||
      (fontMime && fontType(body) !== mime) ||
      (isLicense && !licenseText(body))
    ) {
      throw new RuntimeError("Unsupported asset type", 415, "ASSET_TYPE");
    }
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
  const parts = [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0")];
  const directory = await assetDirectory(config.assetsRoot, parts);
  const filename = `${ulid(now)}.${extension}`;
  await writeFile(path.join(directory, filename), body, { flag: "wx" });
  const relativePath = [...parts, filename].join("/");
  return { path: relativePath, url: `asset:${relativePath}` };
}

/** Saves local or downloaded font data below fonts/<family>, never at a caller-selected path. */
export async function saveFontAsset(
  config: Pick<LoadedConfig, "assetsRoot" | "assetsMaxBytes">,
  body: Buffer,
  mime: string,
  familyName: string | undefined,
  now = new Date()
): Promise<{ path: string; url: string }> {
  if (body.length > config.assetsMaxBytes) throw new RuntimeError("Font asset is too large", 413, "ASSET_LIMIT");

  const family = fontFamilyName(familyName);
  const extension = Object.keys(fontExtensions).find((key) => fontExtensions[key] === mime);
  const isLicense = mime === "text/plain";
  if (
    (extension && fontType(body) !== mime) ||
    (isLicense && !licenseText(body)) ||
    (!extension && !isLicense)
  ) {
    throw new RuntimeError("Unsupported font asset type", 415, "ASSET_TYPE");
  }

  const directory = await assetDirectory(config.assetsRoot, ["fonts", family]);
  const filename = isLicense ? "LICENSE.txt" : `${ulid(now)}.${extension}`;
  const relativePath = ["fonts", family, filename].join("/");
  const absolutePath = path.join(directory, filename);
  if (isLicense) {
    try {
      await writeFile(absolutePath, body, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await lstat(absolutePath);
      if (!existing.isFile() || !(await readFile(absolutePath)).equals(body)) {
        throw new RuntimeError("A different font license already exists", 409, "ASSET_TYPE");
      }
    }
  } else {
    await writeFile(absolutePath, body, { flag: "wx" });
  }
  return { path: relativePath, url: `asset:${relativePath}` };
}

async function assetDirectory(rootPath: string, parts: string[]): Promise<string> {
  await mkdir(rootPath, { recursive: true });
  const root = await realpath(rootPath);
  let directory = root;
  for (const part of parts) {
    const next = path.join(directory, part);
    try {
      await mkdir(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    directory = await realpath(next);
    if (!isInside(root, directory) || !(await stat(directory)).isDirectory()) {
      throw new RuntimeError("Asset directory is outside its root", 403, "ASSET_PATH");
    }
  }
  return directory;
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
