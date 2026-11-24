#!/usr/bin/env node

/**
 * Build the bundled catalog from Google's official repository.
 *
 * Download the source outside this script with:
 *   git clone --depth 1 https://github.com/google/fonts
 * Then run:
 *   node scripts/google-fonts-list.mjs <google/fonts-directory>
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultOutput = path.join(
  repositoryRoot,
  "packages/plugin-design/src/fonts/google-fonts.json"
);

const LICENSES = new Map([
  ["OFL", "OFL"],
  ["APACHE2", "Apache"],
  ["Apache", "Apache"],
  ["UFL", "UFL"]
]);

function decodeProtoString(raw, source, lineNumber) {
  let index = 0;
  let result = "";
  const fail = () => {
    throw new Error(`${source}:${lineNumber}: invalid protobuf string`);
  };

  while (index < raw.length) {
    while (/\s/.test(raw[index] ?? "")) index += 1;
    if (index >= raw.length) break;
    if (raw[index] !== '"') fail();
    index += 1;

    let closed = false;
    while (index < raw.length) {
      const character = raw[index];
      index += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character !== "\\") {
        result += character;
        continue;
      }

      const escaped = raw[index];
      if (escaped === undefined) fail();
      index += 1;
      const simpleEscapes = {
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        "\\": "\\",
        "'": "'",
        '"': '"'
      };
      if (Object.hasOwn(simpleEscapes, escaped)) {
        result += simpleEscapes[escaped];
        continue;
      }

      if (escaped === "x" || escaped === "X") {
        const digits = raw.slice(index).match(/^[0-9a-fA-F]{1,2}/)?.[0];
        if (!digits) fail();
        result += String.fromCodePoint(Number.parseInt(digits, 16));
        index += digits.length;
        continue;
      }
      if (escaped === "u" || escaped === "U") {
        const width = escaped === "u" ? 4 : 8;
        const digits = raw.slice(index, index + width);
        if (digits.length !== width || !/^[0-9a-fA-F]+$/.test(digits)) fail();
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint > 0x10ffff) fail();
        result += String.fromCodePoint(codePoint);
        index += width;
        continue;
      }
      if (/[0-7]/.test(escaped)) {
        const digits = escaped + (raw.slice(index).match(/^[0-7]{0,2}/)?.[0] ?? "");
        result += String.fromCodePoint(Number.parseInt(digits, 8));
        index += digits.length - 1;
        continue;
      }
      result += escaped;
    }
    if (!closed) fail();
  }

  return result;
}

function fieldValue(line, source, lineNumber) {
  const value = line.trim();
  if (value.startsWith('"')) return decodeProtoString(value, source, lineNumber);
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  throw new Error(`${source}:${lineNumber}: unsupported value ${value}`);
}

/**
 * Parse the small subset of protobuf text format used in Google's family metadata.
 * Unrelated nested messages (axes and source information) are intentionally ignored.
 */
export function parseGoogleFontsMetadata(contents, source = "METADATA.pb") {
  let depth = 0;
  let font = undefined;
  let family;
  let license;
  let category;
  const weights = new Set();
  const copyrights = new Set();
  const subsets = new Set();
  let hasItalic = false;

  for (const [index, originalLine] of contents.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (/^fonts\s*\{\s*$/.test(line) && depth === 0) {
      font = {};
      depth = 1;
      continue;
    }
    if (line === "}") {
      if (depth === 0) {
        throw new Error(`${source}:${lineNumber}: unexpected closing brace`);
      }
      if (depth === 1 && font) {
        if (typeof font.weight !== "number") {
          throw new Error(`${source}:${lineNumber}: font entry is missing weight`);
        }
        weights.add(font.weight);
        if (font.style === "italic") hasItalic = true;
        if (font.copyright) copyrights.add(font.copyright);
        font = undefined;
      }
      depth -= 1;
      continue;
    }
    if (line.endsWith("{")) {
      depth += 1;
      continue;
    }
    if (depth === 0) {
      const match = /^(name|license|category|subsets|copyright):\s*(.+)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      const value = fieldValue(rawValue, source, lineNumber);
      if (key === "name") family ??= value;
      else if (key === "license") license ??= value;
      else if (key === "category") category ??= value;
      else if (key === "subsets") subsets.add(value);
      else if (key === "copyright") copyrights.add(value);
      continue;
    }
    if (depth === 1 && font) {
      const match = /^(style|weight|copyright):\s*(.+)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      font[key] = fieldValue(rawValue, source, lineNumber);
    }
  }

  if (depth !== 0 || font) throw new Error(`${source}: unclosed protobuf message`);
  if (typeof family !== "string" || !family.trim()) {
    throw new Error(`${source}: missing family name`);
  }
  if (typeof license !== "string" || !LICENSES.has(license)) {
    throw new Error(`${source}: unsupported or missing license ${String(license)}`);
  }
  if (typeof category !== "string" || !category.trim()) {
    throw new Error(`${source}: missing category`);
  }
  if (weights.size === 0) throw new Error(`${source}: no font weights found`);

  return {
    family,
    weights: [...weights].sort((a, b) => a - b),
    italic: hasItalic,
    category,
    license: LICENSES.get(license),
    copyright: [...copyrights].sort(compareText),
    subsets: [...subsets].sort(compareText)
  };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function findMetadataFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await findMetadataFiles(fullPath));
    } else if (entry.isFile() && entry.name === "METADATA.pb") {
      found.push(fullPath);
    }
  }
  return found;
}

export async function buildGoogleFontsCatalog(sourceDirectory) {
  const sourceRoot = path.resolve(sourceDirectory);
  const metadataFiles = (await findMetadataFiles(sourceRoot)).sort(compareText);
  if (metadataFiles.length === 0) {
    throw new Error(`No METADATA.pb files found under ${sourceRoot}`);
  }

  const catalog = [];
  const families = new Set();
  for (const file of metadataFiles) {
    const font = parseGoogleFontsMetadata(await readFile(file, "utf8"), file);
    if (families.has(font.family)) {
      throw new Error(`Duplicate Google Fonts family name: ${font.family}`);
    }
    families.add(font.family);
    catalog.push(font);
  }
  return catalog.sort((left, right) => compareText(left.family, right.family));
}

function serializeCatalog(catalog) {
  // Keep one family per line so generated diffs remain useful without bloating the
  // bundled catalog with indentation for every field.
  return `[\n${catalog.map((font) => `  ${JSON.stringify(font)}`).join(",\n")}\n]\n`;
}

export async function writeGoogleFontsCatalog(sourceDirectory, outputFile = defaultOutput) {
  const catalog = await buildGoogleFontsCatalog(sourceDirectory);
  const destination = path.resolve(outputFile);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, serializeCatalog(catalog), "utf8");
  return { count: catalog.length, outputFile: destination };
}

async function main(args) {
  if (args.length === 0) {
    throw new Error(
      "Usage: node scripts/google-fonts-list.mjs <google/fonts-directory> [--out <file>]"
    );
  }
  const sourceDirectory = args[0];
  let outputFile = defaultOutput;
  if (args.length > 1) {
    if (args.length !== 3 || args[1] !== "--out") {
      throw new Error(
        "Usage: node scripts/google-fonts-list.mjs <google/fonts-directory> [--out <file>]"
      );
    }
    outputFile = args[2];
  }
  const result = await writeGoogleFontsCatalog(sourceDirectory, outputFile);
  console.log(`Wrote ${result.count} Google Fonts families to ${result.outputFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
