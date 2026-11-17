import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
// @ts-expect-error The build helper is plain JavaScript and intentionally has no declaration file.
import { generateThirdPartyNotices } from "../scripts/third-party-notices.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(packages: Record<string, { version: string; license: string }>) {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-third-party-notices-"));
  roots.push(root);
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({
    packages: Object.fromEntries(Object.entries(packages).map(([location, metadata]) => [
      location,
      metadata
    ]))
  }));
  await Promise.all(Object.keys(packages).map((location) =>
    mkdir(path.join(root, location), { recursive: true })
  ));
  return root;
}

const MIT_BODY = `MIT License

Copyright (c) HOLDER

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

test("adds version-pinned MIT texts for the two packages without LICENSE files", async () => {
  const root = await createRoot({
    "node_modules/client-only": { version: "0.0.1", license: "MIT" },
    "node_modules/react-remove-scroll-bar": { version: "2.3.8", license: "MIT" }
  });
  const outputFile = path.join(root, "THIRD-PARTY-NOTICES.md");

  const result = await generateThirdPartyNotices(root, outputFile);
  const notices = await readFile(outputFile, "utf8");

  expect(result).toEqual({ count: 2, missing: [] });
  expect(notices).toContain("## client-only 0.0.1\n\nLicense: MIT");
  expect(notices).toContain(
    MIT_BODY.replace("HOLDER", "Facebook, Inc. and its affiliates.")
  );
  expect(notices).toContain("## react-remove-scroll-bar 2.3.8\n\nLicense: MIT");
  expect(notices).toContain(
    MIT_BODY.replace("HOLDER", "Anton Korzunov <thekashey@gmail.com>")
  );
});

test("fails if a package without a LICENSE file has no reviewed version override", async () => {
  const root = await createRoot({
    "node_modules/new-unreviewed-package": { version: "1.0.0", license: "MIT" }
  });

  await expect(
    generateThirdPartyNotices(root, path.join(root, "THIRD-PARTY-NOTICES.md"))
  ).rejects.toThrow("ライセンス本文が見つからないpackage 1件: new-unreviewed-package");

  const upgradedRoot = await createRoot({
    "node_modules/client-only": { version: "0.0.2", license: "MIT" }
  });
  await expect(
    generateThirdPartyNotices(upgradedRoot, path.join(upgradedRoot, "THIRD-PARTY-NOTICES.md"))
  ).rejects.toThrow("ライセンス本文が見つからないpackage 1件: client-only");
});
