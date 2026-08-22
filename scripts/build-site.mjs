import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist/site");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// 製品が持つschemaは版で分けず、apiVersionをenumで受ける1枚だけにしている。
// 公開URLは版ごとに分かれているため、公開時にenumをその版のconstへ狭める。
// 外部の検証ツールが/schemas/v1/page.schema.jsonでv1だけを検証できる状態を保つ。
const schemaNames = [
  "page.schema.json",
  "folder.schema.json",
  "page-translation.schema.json",
  "folder-translation.schema.json",
  "rich-text-block.schema.json"
];
for (const version of ["v1alpha1", "v1"]) {
  const directory = path.join(output, "schemas", version);
  await mkdir(directory, { recursive: true });
  for (const name of schemaNames) {
    const schema = JSON.parse(
      await readFile(path.join(root, "packages/core/schemas", name), "utf8")
    );
    schema.$id = `https://vellym.tasclub.com/schemas/${version}/${name}`;
    const apiVersion = schema.properties?.apiVersion;
    if (apiVersion?.enum) {
      const value = `vellym.tasclub.com/${version}`;
      if (!apiVersion.enum.includes(value)) {
        throw new Error(`${name} does not support ${value}`);
      }
      schema.properties.apiVersion = { const: value };
    }
    await writeFile(
      path.join(directory, name),
      `${JSON.stringify(schema, null, 2)}\n`,
      "utf8"
    );
  }
}
await cp(
  path.join(root, "packages/core/schemas/config.schema.json"),
  path.join(output, "schemas/config-v1.schema.json")
);

// Ticketのspec schemaはプラグインのTypeScript定数を正本とし、ここでは公開用の
// YAML全体schemaへ埋め込む。site:buildの前にnpm run buildがdistへコンパイルする。
const { TICKET_SPEC_SCHEMA, TICKET_TRACKER_SPEC_SCHEMA } = await import(
  pathToFileURL(path.join(root, "packages/plugin-tickets/dist/schemas.js")).href
);
const pageSchema = JSON.parse(
  await readFile(path.join(root, "packages/core/schemas/page.schema.json"), "utf8")
);
for (const [name, kind, spec] of [
  ["ticket.schema.json", "Ticket", TICKET_SPEC_SCHEMA],
  ["ticket-tracker.schema.json", "TicketTracker", TICKET_TRACKER_SPEC_SCHEMA]
]) {
  const schema = {
    ...pageSchema,
    $id: `https://vellym.tasclub.com/schemas/v1/${name}`,
    title: `Vellym ${kind}`,
    properties: {
      ...pageSchema.properties,
      apiVersion: { const: "vellym.tasclub.com/v1" },
      kind: { const: kind },
      spec
    }
  };
  await writeFile(
    path.join(output, "schemas/v1", name),
    `${JSON.stringify(schema, null, 2)}\n`,
    "utf8"
  );
}

const config = path.join(root, "how-to-use/vellym.config.yaml");
const result = spawnSync(
  process.execPath,
  [path.join(root, "packages/vellym/dist/cli.mjs"), "build", "--config", config, "--json"],
  { cwd: root, encoding: "utf8" }
);
if (result.status !== 0) {
  throw new Error(`document site build failed\n${result.stdout}\n${result.stderr}`);
}
const built = JSON.parse(result.stdout).data.outputDir;
await cp(built, output, { recursive: true });
await rm(built, { recursive: true, force: true });

const build = JSON.parse(await readFile(path.join(output, "vellym-build.json"), "utf8"));
const locales = build.locales;
const defaultLocale = build.defaultLocale;
const pageEntries = [];
for (const locale of locales) {
  const repository = JSON.parse(
    await readFile(path.join(output, "data", build.buildId, locale, "repository.json"), "utf8")
  );
  const pagesDirectory = path.join(output, "data", build.buildId, locale, "pages");
  const pageNames = new Set(repository.data.pages.map((page) => page.name));
  // 文書ツリーに出ない静的detail（Ticketなど）も本文があれば公開する。
  for (const entry of await readdir(pagesDirectory)) {
    if (entry.endsWith(".json")) pageNames.add(entry.slice(0, -".json".length));
  }
  const orderedNames = [
    ...repository.data.pages.map((page) => page.name),
    ...[...pageNames].filter((name) => !repository.data.pages.some((page) => page.name === name)).sort()
  ];
  const pages = await Promise.all(orderedNames.map(async (name) => {
    const payload = JSON.parse(await readFile(path.join(pagesDirectory, `${name}.json`), "utf8"));
    return payload.data.page;
  }));
  pageEntries.push(...pages.map((page) => ({ locale, page })));
}

function pageUrl(locale, page) {
  const name = page.metadata.slug ?? page.metadata.name;
  const localePrefix = locale === defaultLocale ? "" : `${locale}/`;
  return `https://vellym.tasclub.com/${localePrefix}pages/${name}/`;
}

const pageUrls = new Map(
  pageEntries.map(({ locale, page }) => [`${locale}:${page.metadata.name}`, pageUrl(locale, page)])
);
function expandInternalLinks(content, locale) {
  return content.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (source, target, label) => {
    const name = target.trim();
    const url = pageUrls.get(`${locale}:${name}`);
    return url ? `[${(label ?? name).trim()}](${url})` : source;
  });
}

// ja/enの内容を一つの入口にまとめ、言語をまたぐ検索・取得でも全ページを辿れるようにする。
const llms = [
  "# Vellym",
  "Gitで管理するYAMLを、ブラウザ用の静的サイトと構造化データへ生成するドキュメント管理ツール。",
  "This file contains the CommonMark source for every public Japanese and English page."
];
for (const { locale, page } of pageEntries) {
  const blocks = Array.isArray(page.spec.blocks) ? page.spec.blocks : [];
  const content = blocks
    .filter((block) => block.type === "rich-text" && (block.format === undefined || block.format === "commonmark"))
    .map((block) => expandInternalLinks(block.content, locale))
    .join("\n\n");
  llms.push("", `# ${page.metadata.title}`, pageUrl(locale, page), "", content);
}
await writeFile(path.join(output, "llms.txt"), `${llms.join("\n")}\n`, "utf8");

process.stdout.write(`official site built: ${output}\n`);
