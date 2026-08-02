import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../packages/vellym/package.json", import.meta.url), "utf8")
);
const lockfile = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8")
);
const lockedVersion = lockfile.packages?.["packages/vellym"]?.version;
if (lockedVersion !== manifest.version) {
  throw new Error(`package-lock versionが一致しません: ${lockedVersion} != ${manifest.version}`);
}
const suppliedTag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!suppliedTag) throw new Error("release tagを引数またはGITHUB_REF_NAMEで指定してください");
const expected = `v${manifest.version}`;
if (suppliedTag !== expected) {
  throw new Error(`release tagとpackage versionが一致しません: ${suppliedTag} != ${expected}`);
}
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(manifest.version)) {
  throw new Error(`許可されていないversion形式です: ${manifest.version}`);
}
process.stdout.write(`release metadata verified: ${suppliedTag}\n`);
