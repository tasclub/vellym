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
// prereleaseの連番は任意とする。`0.4.0-beta`のように番号を持たない形を許す。
// 同じ版のbetaを2回出すときだけ`beta.2`のように付ける。dist-tagは`-`の後の
// 先頭要素から決まるため、番号の有無で変わらない。
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?$/.test(manifest.version)) {
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
  "../how-to-use/content/getting-started.yaml"
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
// enginesで宣言した最小Node.jsと、利用者向け文書の必須環境を一致させる。
// 宣言だけ上げて文書が古いままだと、対象外の版でinstallさせてしまう。
const engines = manifest.engines?.node ?? "";
const engineMatch = engines.match(/^>=\s*(\d+)\.(\d+)/);
if (!engineMatch) {
  throw new Error(`engines.nodeを解釈できません: ${engines}`);
}
const requiredNode = `${engineMatch[1]}.${engineMatch[2]}`;
const environmentDocuments = [
  "../README.md",
  "../how-to-use/content/getting-started.yaml"
];
for (const relativePath of environmentDocuments) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  if (!source.includes(`Node.js ${requiredNode}`)) {
    throw new Error(
      `必須Node.jsの記載がenginesと一致しません: ${relativePath} に「Node.js ${requiredNode}」がありません（engines: ${engines}）`
    );
  }
}
process.stdout.write(
  `release metadata verified: ${suppliedTag} (dist-tag: ${distTag}, node: >=${requiredNode})\n`
);
