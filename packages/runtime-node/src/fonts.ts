import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "../../plugin-design/src/fonts/google-fonts.json";
import { saveFontAsset } from "./assets.js";
import { RuntimeError } from "./errors.js";
import type { LoadedConfig } from "./types.js";

const licenses: Record<string, string> = { OFL: "OFL-1.1.txt", Apache: "Apache-2.0.txt", UFL: "UFL-1.0.txt" };
const fail = (message: string) => new RuntimeError(message, 400, "GOOGLE_FONT");

function base(name: string, fallback: string): URL {
  const url = new URL(process.env[name] || fallback);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw fail("Invalid font service URL");
  return url;
}

async function get(url: URL, method: string): Promise<Response> {
  const response = await fetch(url, {
    method, redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Encoding": "identity" }
  });
  if (!response.ok) throw fail("Google Fonts request failed");
  return response;
}

export async function fetchGoogleFont(config: LoadedConfig, input: unknown) {
  if (!input || typeof input !== "object") throw fail("Invalid font request");
  const { family, weights, dryRun } = input as Record<string, unknown>;
  if (typeof family !== "string" || !Array.isArray(weights) || !weights.length ||
      weights.some(w => !Number.isInteger(w) || w < 1 || w > 1000) || typeof dryRun !== "boolean") {
    throw fail("Invalid font request");
  }
  const entry = catalog.find(item => item.family === family);
  if (!entry) throw fail("Unknown font family");
  const licenseName = licenses[entry.license];
  if (!licenseName) throw fail("Unknown font license");
  const cssBase = base("VELLYM_GOOGLE_FONTS_CSS_URL", "https://fonts.googleapis.com/css2");
  const fontBase = base("VELLYM_GOOGLE_FONTS_FILE_URL", "https://fonts.gstatic.com");
  cssBase.searchParams.set("family", `${family}:wght@${[...new Set(weights as number[])].sort((a, b) => a - b).join(";")}`);
  const css = await (await get(cssBase, "GET")).text();
  const faces: { url: URL; weight: number; unicodeRange: string }[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1]!;
    const source = /src\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*format\(\s*['"]woff2['"]\s*\)/i.exec(body);
    const range = /unicode-range\s*:\s*([^;}]*)/i.exec(body)?.[1]?.trim() ?? "U+0-10FFFF";
    const weight = /font-weight\s*:\s*(\d+)\s*(?:;|})/i.exec(body)?.[1];
    if (!source || !range || !weight) throw fail("Invalid font CSS");
    const original = new URL(source[1]!, cssBase);
    if (original.origin !== "https://fonts.gstatic.com" && original.origin !== fontBase.origin) throw fail("Unapproved font host");
    if (original.username || original.password) throw fail("Unapproved font host");
    const url = original.origin === "https://fonts.gstatic.com"
      ? new URL(original.pathname + original.search, fontBase)
      : original;
    faces.push({ url, weight: Number(weight), unicodeRange: range });
  }
  if (!faces.length) throw fail("No font faces returned");
  let totalBytes = 0;
  for (const face of faces) {
    const response = await get(face.url, "HEAD");
    const size = response.headers.get("content-length");
    if (!size || !/^\d+$/.test(size) || !Number.isSafeInteger(Number(size))) throw fail("Font size unavailable");
    totalBytes += Number(size);
    if (!Number.isSafeInteger(totalBytes)) throw fail("Font size unavailable");
  }
  if (dryRun) return { totalBytes };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const licenseRoot = path.join(here, "font-licenses");
  const license = await readFile(path.join(licenseRoot, licenseName), "utf8");
  await saveFontAsset(config, Buffer.from(`${entry.copyright.join("\n")}\n\n${license}`), "text/plain", family);
  const files = [];
  for (const face of faces) {
    const response = await get(face.url, "GET");
    const body = Buffer.from(await response.arrayBuffer());
    const saved = await saveFontAsset(config, body, "font/woff2", family);
    files.push({ ...saved, weight: face.weight, unicodeRange: face.unicodeRange });
  }
  return { files };
}
