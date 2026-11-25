import { mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { parse } from "yaml";
import { test as base, expect, repositoryRoot } from "../fixtures.js";

const test = base.extend({
  project: async ({ project }, use) => {
    await unlink(project.config);
    await unlink(project.pageFile);
    // Selected plugins can be resolved after init without running npm install.
    await mkdir(path.join(project.root, "node_modules"));
    await symlink(path.join(repositoryRoot, "node_modules/@vellym"), path.join(project.root, "node_modules/@vellym"));
    await use(project);
  }
});

test("recommended setup creates only the frame and opens the entry @CORE-MANUAL-A01 @CORE-MANUAL-A02", async ({ page, server, project }) => {
  await page.goto(server);
  await expect(page.getByTestId("setup-progress").getByRole("listitem")).toHaveCount(4);
  await expect(page.getByTestId("setup-root-docs")).toBeChecked();
  await expect(page.getByTestId("setup-absolute-path")).toHaveText(path.join(project.root, "docs"));
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-structure-by-type")).toBeChecked();
  await expect(page.getByTestId("setup-numbered")).not.toBeChecked();
  await expect(page.getByTestId("setup-folder-overview")).toHaveValue("概要");
  // Read-only selection tree: names are editable but there are no selection boxes.
  await expect(page.getByRole("tree").getByRole("checkbox")).toHaveCount(0);
  const firstRow = page.getByRole("treeitem").first();
  await firstRow.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("treeitem").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("setup-folder-management")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("treeitem").nth(1)).toBeFocused();
  await page.getByTestId("setup-next").click();
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-create")).toBeEnabled();
  for (const file of ["docs/vellym.config.yaml", "docs/VELLYM.md", "docs/index.yaml", "docs/.gitignore", "package.json"]) {
    await expect(page.getByTestId("setup-files-create")).toContainText(file);
  }
  // Planning writes nothing.
  expect(await readdir(path.join(project.root, "content"))).toEqual([]);
  expect(await readdir(project.root)).not.toContain("docs");
  await page.getByTestId("setup-create").click();
  await expect(page.getByTestId("setup-wizard")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "文書の入口" })).toBeVisible();
  const docs = path.join(project.root, "docs");
  expect(parse(await readFile(path.join(docs, "vellym.config.yaml"), "utf8")).setup.structure).toBe("by-type");
  expect(await readFile(path.join(docs, "VELLYM.md"), "utf8")).toContain("概要");
  expect(await readdir(path.join(docs, "概要"))).toEqual(["_index.yaml"]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "文書の入口" })).toBeVisible();
});

test("phase numbering, rename, guide and plugins survive back navigation @CORE-MANUAL-C01", async ({ page, server, project }) => {
  await page.goto(server);
  await page.getByTestId("setup-language").selectOption("en");
  await page.getByTestId("setup-root-vellym").check();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-structure-by-phase").check();
  await expect(page.getByTestId("setup-numbered")).toBeChecked();
  await expect(page.getByTestId("setup-folder-management")).toHaveValue("00_project-management");
  await expect(page.getByTestId("setup-folder-requirements")).toHaveValue("01_requirements");
  await page.getByTestId("setup-folder-management").fill("00_my-plan");
  await page.getByTestId("setup-guide").check();
  await page.getByTestId("setup-folder-tutorials").fill("my-tutorials");
  // Removing the supplement keeps edits but must not send unknown folder IDs.
  await page.getByTestId("setup-guide").uncheck();
  await page.getByTestId("setup-guide").check();
  await expect(page.getByTestId("setup-folder-tutorials")).toHaveValue("my-tutorials");
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-plugin-tickets").check();
  await page.getByTestId("setup-plugin-kanban").check();
  await page.getByTestId("setup-back").click();
  await expect(page.getByTestId("setup-folder-management")).toHaveValue("00_my-plan");
  await page.getByTestId("setup-back").click();
  await expect(page.getByTestId("setup-root-vellym")).toBeChecked();
  await expect(page.getByTestId("setup-language")).toHaveValue("en");
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-structure-by-phase")).toBeChecked();
  await expect(page.getByTestId("setup-numbered")).toBeChecked();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-plugin-tickets")).toBeChecked();
  await expect(page.getByTestId("setup-plugin-kanban")).toBeChecked();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-files-create")).toContainText("vellym/00_my-plan/_index.yaml");
  await expect(page.getByTestId("setup-create")).toBeEnabled();
  await page.getByTestId("setup-create").click();
  await expect(page.getByRole("heading", { level: 1, name: "Documentation" })).toBeVisible();
  const config = parse(await readFile(path.join(project.root, "vellym/vellym.config.yaml"), "utf8"));
  expect(config.plugins).toEqual(["@vellym/tickets", "@vellym/kanban"]);
  expect(await readdir(path.join(project.root, "vellym/00_my-plan"))).toContain("_index.yaml");
  expect(await readdir(path.join(project.root, "vellym/00_guide/my-tutorials"))).toEqual(["_index.yaml"]);
});

test("project root, feature structure, skips and package append @CORE-MANUAL-D01", async ({ page, server, project }) => {
  await writeFile(path.join(project.root, "VELLYM.md"), "Keep my guide\n");
  await writeFile(path.join(project.root, "package.json"), '{"name":"fixture","private":true,"scripts":{"check":"echo ok"}}\n');
  await page.goto(server);
  await page.getByTestId("setup-root-project").check();
  await expect(page.getByTestId("setup-absolute-path")).toHaveText(project.root);
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-structure-by-feature").check();
  await expect(page.getByTestId("setup-folder-features")).toBeVisible();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-next").click();
  await expect(page.getByTestId("setup-files-skip")).toContainText("VELLYM.md");
  await expect(page.getByTestId("setup-files-create")).toContainText("package.json");
  await page.getByTestId("setup-create").click();
  await expect(page.getByTestId("setup-wizard")).toHaveCount(0);
  expect(await readFile(path.join(project.root, "VELLYM.md"), "utf8")).toBe("Keep my guide\n");
  expect(parse(await readFile(path.join(project.root, "package.json"), "utf8")).scripts.check).toBe("echo ok");
});

for (const language of ["ja", "en"] as const) {
  test(`all four steps are accessible and readable at 768px (${language})`, async ({ page, server }, testInfo) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(server);
    await page.getByTestId("setup-language").selectOption(language);
    for (let step = 1; step <= 4; step++) {
      const progress = page.getByTestId("setup-progress");
      await expect(progress.locator('[aria-current="step"]')).toHaveCount(1);
      expect(await progress.locator('[aria-current="step"]').evaluate(node => Number(getComputedStyle(node).fontWeight))).toBeGreaterThanOrEqual(700);
      for (const item of await progress.getByRole("listitem").all()) {
        await expect(item).toBeVisible();
        expect(await item.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (step === 4) await expect(page.getByTestId("setup-create")).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (language === "en") {
        expect(await page.getByTestId("setup-wizard").evaluate(node => {
          const copy = node.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('[lang="ja"]').forEach(item => item.remove());
          return /[\u3040-\u30ff\u3400-\u9fff]/.test(copy.textContent ?? "");
        })).toBe(false);
      }
      const screenshot = testInfo.outputPath(`setup-${language}-${step}-768.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`setup-${language}-${step}-768`, { path: screenshot, contentType: "image/png" });
      if (step < 4) await page.getByTestId("setup-next").click();
    }
  });
}
