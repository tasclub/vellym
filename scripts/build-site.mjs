import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist/site");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const schemaTargets = [
  ["v1alpha1", "page.schema.json", "page.schema.json"],
  ["v1alpha1", "folder.schema.json", "folder.schema.json"],
  ["v1alpha1", "rich-text-block.schema.json", "rich-text-block.schema.json"],
  ["v1", "page.schema.json", "page-v1.schema.json"],
  ["v1", "folder.schema.json", "folder-v1.schema.json"],
  ["v1", "rich-text-block.schema.json", "rich-text-block.schema.json"]
];
for (const [version, targetName, sourceName] of schemaTargets) {
  const directory = path.join(output, "schemas", version);
  await mkdir(directory, { recursive: true });
  let source = await readFile(path.join(root, "packages/core/schemas", sourceName), "utf8");
  if (version === "v1" && sourceName === "rich-text-block.schema.json") {
    source = source.replace("/schemas/v1alpha1/", "/schemas/v1/");
  }
  await writeFile(path.join(directory, targetName), source, "utf8");
}
await cp(
  path.join(root, "packages/core/schemas/config.schema.json"),
  path.join(output, "schemas/config-v1.schema.json")
);

const documentSites = [
  { target: ".", config: "how-to-use/ja/vellym.config.yaml" },
  { target: "en", config: "how-to-use/en/vellym.config.yaml" }
];
for (const documentSite of documentSites) {
  const config = path.join(root, documentSite.config);
  const result = spawnSync(
    process.execPath,
    [path.join(root, "packages/vellym/dist/cli.mjs"), "build", "--config", config, "--json"],
    { cwd: root, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`document site build failed (${documentSite.target})\n${result.stdout}\n${result.stderr}`);
  }
  const built = JSON.parse(result.stdout).data.outputDir;
  const target = path.join(output, documentSite.target);
  await mkdir(target, { recursive: true });
  await cp(built, target, { recursive: true });
  await rm(built, { recursive: true, force: true });
}

process.stdout.write(`official site built: ${output}\n`);
