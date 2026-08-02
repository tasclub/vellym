import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "packages/vellym/dist");
const cliOutput = path.join(output, "cli.mjs");
const packageManifest = JSON.parse(
  await readFile(path.join(root, "packages/vellym/package.json"), "utf8")
);
const version = packageManifest.version;

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "schemas"), { recursive: true });
await build({
  entryPoints: [path.join(root, "packages/vellym/src/cli.ts")],
  outfile: cliOutput,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  define: {
    __VELLYM_VERSION__: JSON.stringify(version)
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
