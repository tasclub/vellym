import { chmod, cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { generateThirdPartyNotices } from "./third-party-notices.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "packages/vellym/dist");
const cliOutput = path.join(output, "cli.mjs");
const packageManifest = JSON.parse(
  await readFile(path.join(root, "packages/vellym/package.json"), "utf8")
);
const version = packageManifest.version;
// The official plugins `init --plugins` accepts: published packages/plugin-* with a vellym.id.
const officialPlugins = {};
for (const entry of (await readdir(path.join(root, "packages"), { withFileTypes: true }))
  .filter((item) => item.isDirectory() && item.name.startsWith("plugin-"))) {
  const manifest = JSON.parse(await readFile(path.join(root, "packages", entry.name, "package.json"), "utf8"));
  if (manifest.private || manifest.publishConfig?.access !== "public" || typeof manifest.vellym?.id !== "string") continue;
  officialPlugins[manifest.vellym.id] = {
    name: manifest.name,
    version: manifest.version,
    ...(manifest.vellym.guideUrl ? { guideUrl: manifest.vellym.guideUrl } : {})
  };
}
const sortedOfficialPlugins = Object.fromEntries(Object.entries(officialPlugins).sort(([a], [b]) => a.localeCompare(b)));

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "schemas"), { recursive: true });
await build({
  entryPoints: [path.join(root, "packages/vellym/src/cli.ts")],
  outfile: cliOutput,
  bundle: true,
  platform: "node",
  format: "esm",
  // @vellym/plugin-api はワークスペースのsrcから取り込む（tsconfigと同じ条件）。
  // "module"を併記するのは、conditionsを指定するとesbuildの既定の独自条件が
  // 外れ、ESM entryを"module"で示す依存の解決が変わるためである。
  conditions: ["vellym-source", "module"],
  target: "node22",
  define: {
    __VELLYM_VERSION__: JSON.stringify(version),
    __VELLYM_OFFICIAL_PLUGINS__: JSON.stringify(sortedOfficialPlugins)
  },
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __vellymCreateRequire } from 'node:module';\nconst require = __vellymCreateRequire(import.meta.url);"
  }
});
await chmod(cliOutput, 0o755);
await cp(
  path.join(root, "packages/ui-react/dist/client"),
  path.join(output, "ui"),
  { recursive: true }
);
await cp(
  path.join(root, "packages/core/schemas"),
  path.join(output, "schemas"),
  { recursive: true }
);
await cp(
  path.join(root, "packages/runtime-node/src/setup-packs/v3"),
  path.join(output, "setup-packs/v3"),
  { recursive: true }
);
await cp(
  path.join(root, "packages/runtime-node/src/font-licenses"),
  path.join(output, "font-licenses"),
  { recursive: true }
);
const notices = await generateThirdPartyNotices(
  root,
  path.join(root, "packages/vellym/THIRD-PARTY-NOTICES.md")
);
if (notices.missing.length) {
  process.stdout.write(
    `THIRD-PARTY-NOTICES: ライセンス本文が見つからないpackage ${notices.missing.length}件: ${notices.missing.join(", ")}\n`
  );
}
