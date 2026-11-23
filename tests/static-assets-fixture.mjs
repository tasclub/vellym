// Shared by tests/cli.test.ts and tests/static-assets.browser.mjs (ticket-01m748wq4ddar0gdyytdxn95vy).
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

/**
 * A project whose published body references images/used.png, whose draft English
 * translation alone references draft-only.png, and where unused.png is referenced nowhere.
 * With `missing: true` the body also references an image that does not exist.
 */
export async function staticAssetsProject({ missing = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-static-assets-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "assets", "images"), { recursive: true });
  for (const name of ["images/used.png", "unused.png", "draft-only.png"]) await writeFile(path.join(root, "assets", name), png);
  await writeFile(path.join(root, "vellym.config.yaml"), 'schemaVersion: "1.0"\ncontentRoot: docs\noutputDir: dist/site\nui:\n  language: ja\ni18n:\n  defaultLocale: ja\nplugins: []\n');
  await writeFile(path.join(root, "docs", "page.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page
  title: 画像のページ
spec:
  locale: ja
  blocks:
    - id: body
      type: rich-text
      content: |
        ![図](asset:images/used.png)
${missing ? "\n        ![無い図](asset:missing.png)\n" : ""}
  translations:
    en:
      visibility: draft
      title: Image page
      blocks:
        - id: body
          type: rich-text
          content: |
            ![Draft figure](asset:draft-only.png)
`);
  return { root, config: path.join(root, "vellym.config.yaml") };
}
