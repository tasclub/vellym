import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript generator has no declaration file
import { npmReadme } from "../scripts/npm-readme.mjs";

describe("npm README", () => {
  it("matches the generated README", async () => {
    expect(await readFile("packages/vellym/README.md", "utf8")).toBe(npmReadme(await readFile("README.md", "utf8")));
  });

  it("removes marked sections and rewrites relative links", () => {
    const result = npmReadme("before\n<!-- npm-readme:skip-start -->\nsecret\n<!-- npm-readme:skip-end -->\n[license](LICENSE) [plugin](packages/plugin-tickets/README.md) ![image](.github/readme/a.png) [web](https://example.com)\n");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("npm-readme:skip");
    expect(result).toContain("https://github.com/tasclub/vellym/blob/main/LICENSE");
    expect(result).toContain("https://www.npmjs.com/package/@vellym/tickets");
    expect(result).toContain("https://raw.githubusercontent.com/tasclub/vellym/main/.github/readme/a.png");
    expect(result).toContain("https://example.com");
  });
});
