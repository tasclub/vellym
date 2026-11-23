import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { llmsFull, llmsIndex, pageOrder } from "./site-llms.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist/site");

// runtime-node is distributed as TypeScript source inside the workspace. Compile this
// dependency-free helper in memory so the CLI and public schemas call the same function.
const resourceSchemaSource = await readFile(
  path.join(root, "packages/runtime-node/src/resource-schema.ts"),
  "utf8"
);
const { code: resourceSchemaCode } = await transform(resourceSchemaSource, {
  loader: "ts",
  format: "esm",
  target: "node22"
});
const { resourceSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(resourceSchemaCode).toString("base64")}`
);

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
    let schema = JSON.parse(
      await readFile(path.join(root, "packages/core/schemas", name), "utf8")
    );
    const properties = schema.properties ?? {};
    const apiVersion = properties.apiVersion;
    if (apiVersion?.enum) {
      const value = `vellym.tasclub.com/${version}`;
      if (!apiVersion.enum.includes(value)) {
        throw new Error(`${name} does not support ${value}`);
      }
      const kind = properties.kind?.const;
      if (typeof kind !== "string" || !properties.spec) {
        throw new Error(`${name} is missing its resource kind or spec schema`);
      }
      schema = resourceSchema({
        pageSchema: schema,
        kind,
        specSchema: properties.spec,
        version
      });
    } else {
      schema.$id = `https://vellym.tasclub.com/schemas/${version}/${name}`;
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
  pathToFileURL(path.join(root, "packages/ticket-engine/dist/schemas.js")).href
);
const pageSchema = JSON.parse(
  await readFile(path.join(root, "packages/core/schemas/page.schema.json"), "utf8")
);
for (const [name, kind, spec] of [
  ["ticket.schema.json", "Ticket", TICKET_SPEC_SCHEMA],
  ["ticket-tracker.schema.json", "TicketTracker", TICKET_TRACKER_SPEC_SCHEMA]
]) {
  const schema = resourceSchema({ pageSchema, kind, specSchema: spec, version: "v1" });
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
const pagesByLocale = {};
for (const locale of locales) {
  const repository = JSON.parse(
    await readFile(path.join(output, "data", build.buildId, locale, "repository.json"), "utf8")
  );
  const pagesDirectory = path.join(output, "data", build.buildId, locale, "pages");
  const pageUrl = (page) => `https://vellym.tasclub.com/${locale === defaultLocale ? "" : `${locale}/`}pages/${page.slug ?? page.name}/`;
  const summaries = pageOrder(repository);
  const publishedPages = repository.data.pages.map((page) => ({ name: page.name, url: pageUrl(page) }));
  const included = summaries.filter((page) => !page.relativePath.startsWith("demo-tickets/"));
  const pages = await Promise.all(included.map(async (summary) => {
    const payload = JSON.parse(await readFile(path.join(pagesDirectory, `${summary.name}.json`), "utf8"));
    const page = payload.data.page;
    const content = (page.spec.blocks ?? [])
      .filter((block) => block.type === "rich-text" && (block.format === undefined || block.format === "commonmark"))
      .map((block) => block.content).join("\n\n");
    return { name: summary.name, title: page.metadata.title, url: pageUrl(summary), content };
  }));
  pagesByLocale[locale] = pages;
  const directory = locale === defaultLocale ? output : path.join(output, locale);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "llms-full.txt"), llmsFull({ locale, pages, publishedPages }), "utf8");
}
const schemaFiles = (await readdir(path.join(output, "schemas/v1"))).filter((name) => name.endsWith(".schema.json")).sort();
const schemaKind = (name) => name.replace(/\.schema\.json$/, "").split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
const schemas = schemaFiles.map((name) => ({ title: schemaKind(name), url: `https://vellym.tasclub.com/schemas/v1/${name}` }));
schemas.push({ title: "Config", url: "https://vellym.tasclub.com/schemas/config-v1.schema.json" });
await writeFile(path.join(output, "llms.txt"), llmsIndex({ pagesByLocale, schemas }), "utf8");

process.stdout.write(`official site built: ${output}\n`);
