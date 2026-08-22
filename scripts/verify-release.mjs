import { readFile } from "node:fs/promises";
import semver from "semver";

const packagePaths = {
  pluginApi: "packages/plugin-api",
  tickets: "packages/plugin-tickets",
  vellym: "packages/vellym"
};
const manifests = Object.fromEntries(
  await Promise.all(
    Object.entries(packagePaths).map(async ([key, packagePath]) => [
      key,
      JSON.parse(
        await readFile(new URL(`../${packagePath}/package.json`, import.meta.url), "utf8")
      )
    ])
  )
);
const manifest = manifests.vellym;
const lockfile = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8")
);
for (const [key, packagePath] of Object.entries(packagePaths)) {
  const packageManifest = manifests[key];
  const lockedVersion = lockfile.packages?.[packagePath]?.version;
  if (lockedVersion !== packageManifest.version) {
    throw new Error(
      `package-lock versionが一致しません: ${packageManifest.name}は${lockedVersion} != ${packageManifest.version}`
    );
  }
  if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?$/.test(packageManifest.version)) {
    throw new Error(
      `許可されていないversion形式です: ${packageManifest.name}@${packageManifest.version}`
    );
  }
}

const pluginApiRange = manifests.tickets.peerDependencies?.["@vellym/plugin-api"] ?? "";
if (!semver.satisfies(manifests.pluginApi.version, pluginApiRange)) {
  throw new Error(
    `@vellym/ticketsのpeer dependencyが公開版を満たしません: @vellym/plugin-api@${manifests.pluginApi.version}は${pluginApiRange}の範囲外です`
  );
}
const vellymRange = manifests.tickets.engines?.vellym ?? "";
if (!semver.satisfies(manifests.vellym.version, vellymRange)) {
  throw new Error(
    `@vellym/ticketsのengines.vellymが公開版を満たしません: vellym@${manifests.vellym.version}は${vellymRange}の範囲外です`
  );
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
