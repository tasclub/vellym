import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function npmReadme(source) {
  return "<!-- Generated from the root README.md; do not edit directly. -->\n\n" +
    source.replace(/<!-- npm-readme:skip-start -->[\s\S]*?<!-- npm-readme:skip-end -->\n?/g, "")
      .replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (match, start, target, end) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return match;
        const plugin = target.match(/^packages\/plugin-([^/]+)\/(?:README\.md)?$/);
        const url = plugin ? `https://www.npmjs.com/package/@vellym/${plugin[1]}`
          : target.startsWith(".github/readme/") ? `https://raw.githubusercontent.com/tasclub/vellym/main/${target}`
          : `https://github.com/tasclub/vellym/blob/main/${target}`;
        return `${start}${url}${end}`;
      });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(import.meta.dirname, "..");
  await writeFile(path.join(root, "packages/vellym/README.md"), npmReadme(await readFile(path.join(root, "README.md"), "utf8")));
}
