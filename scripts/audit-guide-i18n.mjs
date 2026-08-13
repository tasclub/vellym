import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const canonicalRoot = path.join(root, "how-to-use/content");
const legacyJaRoot = path.join(root, "how-to-use/ja/content");
const legacyEnRoot = path.join(root, "how-to-use/en/content");

async function yamlFiles(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith(".yaml")).sort();
}

async function resource(directory, name) {
  return YAML.parse(await readFile(path.join(directory, name), "utf8"));
}

function pageIdentity(value) {
  return {
    kind: value.kind,
    name: value.metadata?.name,
    slug: value.metadata?.slug ?? value.metadata?.name,
    blocks: (value.spec?.blocks ?? []).map(({ id, type, format }) => ({ id, type, format }))
  };
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  }
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function auditLegacy() {
  const jaFiles = await yamlFiles(legacyJaRoot);
  const enFiles = await yamlFiles(legacyEnRoot);
  assertEqual(enFiles, jaFiles, "Japanese and English guide file sets differ");
  for (const name of jaFiles) {
    const ja = await resource(legacyJaRoot, name);
    const en = await resource(legacyEnRoot, name);
    if (ja.kind === "Page") {
      assertEqual(pageIdentity(en), pageIdentity(ja), `${name}: Page identity or block structure differs`);
    } else {
      assertEqual(en.kind, ja.kind, `${name}: resource kind differs`);
      assertEqual(en.spec?.order, ja.spec?.order, `${name}: Folder order differs`);
    }
  }
  return { mode: "legacy", files: jaFiles.length, pages: jaFiles.filter((name) => name !== "_index.yaml").length };
}

async function auditUnified() {
  const files = await yamlFiles(canonicalRoot);
  let pages = 0;
  for (const name of files) {
    const value = await resource(canonicalRoot, name);
    const translation = value.spec?.translations?.en;
    if (!translation) throw new Error(`${name}: published English translation is missing`);
    if ((translation.visibility ?? "published") !== "published") {
      throw new Error(`${name}: English translation is not published`);
    }
    if (value.kind === "Page") {
      pages += 1;
      assertEqual(
        (translation.blocks ?? []).map(({ id, type, format }) => ({ id, type, format })),
        pageIdentity(value).blocks,
        `${name}: translated block structure differs from the canonical Page`
      );
    }
  }
  return { mode: "unified", files: files.length, pages };
}

const result = await ((await exists(legacyJaRoot)) && (await exists(legacyEnRoot))
  ? auditLegacy()
  : auditUnified());
process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
