import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const fixtureRoots: string[] = [];
const script = path.resolve("scripts/google-fonts-list.mjs");

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-google-fonts-"));
  fixtureRoots.push(root);
  return root;
}

async function writeMetadata(root: string, folder: string, contents: string): Promise<void> {
  const directory = path.join(root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "METADATA.pb"), contents, "utf8");
}

async function generateCatalog(root: string): Promise<unknown[]> {
  const output = path.join(root, "catalog.json");
  await execFileAsync(process.execPath, [script, root, "--out", output]);
  return JSON.parse(await readFile(output, "utf8")) as unknown[];
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("Google Fonts catalog generator", () => {
  it("reads family metadata and deduplicates weights, copyrights and subsets", async () => {
    const root = await temporaryDirectory();
    await writeMetadata(root, "ofl/sample", `
name: "Sample \\"Family\\""
license: "OFL"
category: "SANS_SERIF"
fonts {
  style: "normal"
  weight: 700
  copyright: "Copyright 2024 Sample Authors"
}
fonts {
  style: "italic"
  weight: 400
  copyright: "Copyright 2024 Sample Authors"
}
subsets: "latin"
subsets: "latin-ext"
subsets: "latin"
`);

    await expect(generateCatalog(root)).resolves.toEqual([
      {
        family: 'Sample "Family"',
        weights: [400, 700],
        italic: true,
        category: "SANS_SERIF",
        license: "OFL",
        copyright: ["Copyright 2024 Sample Authors"],
        subsets: ["latin", "latin-ext"]
      }
    ]);
  });

  it("walks family directories and normalizes Google's Apache license label", async () => {
    const root = await temporaryDirectory();
    await writeMetadata(root, "ufl/zeta", `
name: "Zeta"
license: "UFL"
category: "DISPLAY"
fonts {
  style: "normal"
  weight: 400
}
subsets: "latin"
`);
    await writeMetadata(root, "apache/alpha", `
name: "Alpha"
license: "APACHE2"
category: "SERIF"
fonts {
  style: "normal"
  weight: 300
}
subsets: "latin"
`);

    await expect(generateCatalog(root)).resolves.toEqual([
      {
        family: "Alpha",
        weights: [300],
        italic: false,
        category: "SERIF",
        license: "Apache",
        copyright: [],
        subsets: ["latin"]
      },
      {
        family: "Zeta",
        weights: [400],
        italic: false,
        category: "DISPLAY",
        license: "UFL",
        copyright: [],
        subsets: ["latin"]
      }
    ]);
  });

  it("writes JSON to the requested output path", async () => {
    const root = await temporaryDirectory();
    const output = path.join(root, "catalog.json");
    await writeMetadata(root, "ofl/sample", `
name: "Sample"
license: "OFL"
category: "SANS_SERIF"
fonts {
  style: "normal"
  weight: 400
}
subsets: "latin"
`);

    const { stdout } = await execFileAsync(process.execPath, [
      script,
      root,
      "--out",
      output
    ]);

    expect(stdout).toContain("Wrote 1 Google Fonts families");
    await expect(JSON.parse(await readFile(output, "utf8"))).toEqual([
      {
        family: "Sample",
        weights: [400],
        italic: false,
        category: "SANS_SERIF",
        license: "OFL",
        copyright: [],
        subsets: ["latin"]
      }
    ]);
  });
});
