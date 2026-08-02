import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "vellym-100-pages-"));
const content = path.join(root, "docs/content");
await mkdir(content, { recursive: true });
await writeFile(
  path.join(root, "vellym.config.yaml"),
  `schemaVersion: "1.0"\ncontentRoot: docs/content\noutputDir: dist/vellym\nui:\n  language: ja\nplugins: []\n`,
  "utf8"
);
await Promise.all(
  Array.from({ length: 100 }, (_, index) => {
    const id = `page-${String(index).padStart(3, "0")}`;
    return writeFile(
      path.join(content, `${id}.yaml`),
      `apiVersion: vellym.tasclub.com/v1alpha1\nkind: Page\nmetadata:\n  name: ${id}\n  title: Page ${index}\nspec:\n  blocks:\n    - id: body\n      type: rich-text\n      format: commonmark\n      content: |\n        ## Page ${index}\n\n        Performance fixture.\n`,
      "utf8"
    );
  })
);

const cli = path.resolve("packages/vellym/dist/cli.mjs");
const started = performance.now();
for (const command of ["validate", "build"]) {
  const result = spawnSync(
    process.execPath,
    [cli, command, "--config", path.join(root, "vellym.config.yaml")],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`);
  }
}
const output = path.join(root, "dist/vellym");
const generatedPages = (
  await readdir(path.join(output, "pages"), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (generatedPages.length !== 100) {
  throw new Error(`expected 100 generated pages, found ${generatedPages.length}`);
}
const htmlFiles = [
  path.join(output, "index.html"),
  ...generatedPages.map((name) =>
    path.join(output, "pages", name, "index.html")
  )
];
for (const htmlFile of htmlFiles) {
  const source = await readFile(htmlFile, "utf8");
  if (/<script(?:\s|>)/i.test(source)) {
    throw new Error(`static output unexpectedly depends on JavaScript: ${htmlFile}`);
  }
  const hrefs = [...source.matchAll(/href="([^"]+)"/g)].map(
    (match) => match[1]
  );
  for (const href of hrefs) {
    if (
      href.startsWith("#") ||
      href.startsWith("http:") ||
      href.startsWith("https:")
    ) {
      continue;
    }
    const target = decodeURIComponent(href.split("#", 1)[0]);
    await access(path.resolve(path.dirname(htmlFile), target));
  }
}
const elapsed = performance.now() - started;
if (elapsed > 30_000) throw new Error(`100 page smoke test exceeded 30 seconds: ${elapsed}ms`);
process.stdout.write(
  `100 page validate/build/link crawl passed in ${Math.round(elapsed)}ms: ${root}\n`
);
