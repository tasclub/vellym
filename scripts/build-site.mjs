import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

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
