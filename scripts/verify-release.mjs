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

// publish workflowが選ぶdist-tagと、利用者が最初に叩くコマンドを一致させる。
// ここがずれると、npmと公式サイトの手順が古い版を導入してしまい気づきにくい。
const prerelease = manifest.version.includes("-")
  ? manifest.version.slice(manifest.version.indexOf("-") + 1).split(".")[0]
  : undefined;
const distTag = prerelease ?? "latest";
const installTarget = distTag === "latest" ? "vellym" : `vellym@${distTag}`;
const documents = [
  "../README.md",
  "../packages/vellym/README.md",
  "../how-to-use/ja/content/getting-started.yaml",
  "../how-to-use/en/content/getting-started.yaml"
];
for (const relativePath of documents) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const commands = source.match(/npx vellym(?:@[\w.-]+)?/g) ?? [];
  if (!commands.length) {
    throw new Error(`導入コマンドが見つかりません: ${relativePath}`);
  }
  const wrong = commands.filter((command) => command !== `npx ${installTarget}`);
  if (wrong.length) {
    throw new Error(
      `導入コマンドがdist-tagと一致しません: ${relativePath} は ${[...new Set(wrong)].join("、")} を案内していますが、${manifest.version}は npx ${installTarget} です`
    );
  }
}
process.stdout.write(
  `release metadata verified: ${suppliedTag} (dist-tag: ${distTag})\n`
);
