import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { stringify } from "yaml";
import { cliPath, test as base, expect } from "../fixtures.js";

const test = base.extend({
  project: async ({ project }, use) => {
    await mkdir(path.join(project.content, "target"));
    await writeFile(path.join(project.content, "target/_index.yaml"), stringify({
      apiVersion: "vellym.tasclub.com/v1", kind: "Folder",
      metadata: { title: "Target folder" }, spec: { locale: "en", order: [] }
    }));
    await writeFile(path.join(project.root, "VELLYM.md"), "Original guide\n");
    await use(project);
  }
});

test("creates and opens a named document in the current folder @CORE-MANUAL-E01", async ({ page, server, project }, testInfo) => {
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
  await expect(page.getByTestId("folder-add-resource")).toHaveCount(0);
  await page.getByTestId("folder-add-template").click();
  await page.getByTestId("template-add-role").selectOption("decisions");
  await expect(page.getByTestId("template-add-option-vision")).toHaveCount(0);
  await page.getByTestId("template-add-option-decision").check();
  await page.getByTestId("template-add-name").fill("Our decision");
  await expect(page.getByTestId("template-add-preview")).toContainText("target/our-decision.yaml");
  await expect(page.getByTestId("template-add-guide")).not.toBeChecked();
  expect(await readdir(path.join(project.content, "target"))).toEqual(["_index.yaml"]);
  await page.getByTestId("template-add-guide").check();
  await expect(page.getByTestId("template-add-create")).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("template-preview.png") });
  expect(await page.getByRole("dialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByTestId("template-add-create").click();
  await expect(page.getByRole("heading", { level: 1, name: "Our decision" })).toBeVisible();
  expect(await readFile(path.join(project.content, "target/our-decision.yaml"), "utf8")).toContain("Our decision");
  expect(await readFile(path.join(project.root, "VELLYM.md"), "utf8")).toContain("vellym:guide:add-template-decision");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Our decision" })).toBeVisible();
});

test("adds two distinct sprint folders with a required name @CORE-MANUAL-E03", async ({ page, server, project }) => {
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
  for (let index = 0; index < 2; index++) {
    await page.getByTestId("folder-add-set").click();
    await page.getByTestId("template-add-option-sprint").check();
    await expect(page.getByTestId("template-add-create")).toBeDisabled();
    await page.getByTestId("template-add-name").fill("Iteration");
    await expect(page.getByTestId("template-add-preview")).toContainText(index ? "target/iteration-2/" : "target/iteration/");
    await expect(page.getByTestId("template-add-create")).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByTestId("template-add-create").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(await readdir(path.join(project.content, "target"))).toEqual(["_index.yaml", "iteration", "iteration-2"]);
  expect(await readFile(path.join(project.root, "VELLYM.md"), "utf8")).toBe("Original guide\n");
});

test("previews existing files and unavailable contributions as skips", async ({ page, server, project }) => {
  await writeFile(path.join(project.content, "target/roadmap.yaml"), "Existing user file\n");
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
  await page.getByTestId("folder-add-set").click();
  await page.getByTestId("template-add-option-planning").check();
  const preview = page.getByTestId("template-add-preview");
  await expect(preview).toContainText("target/roadmap.yaml");
  await expect(preview).toContainText("Plugin is not enabled");
  await expect(preview).toContainText("Skip");
  await expect(page.getByTestId("template-add-create")).toBeEnabled();
  expect(await readdir(path.join(project.content, "target"))).toEqual(["_index.yaml", "roadmap.yaml"]);
  await page.getByTestId("template-add-create").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await readFile(path.join(project.content, "target/roadmap.yaml"), "utf8")).toBe("Existing user file\n");
});

test("hides the guide opt-in when absent and refuses a stale preview without creating @CORE-MANUAL-E01", async ({ context, server, project }) => {
  // This scenario intentionally causes a browser network error. Use a separate
  // context-owned page and exclude only that exact, asserted 409 console entry.
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (message.location().url === `${server}/api/v1/templates/apply` &&
        message.text() === "Failed to load resource: the server responded with a status of 409 (Conflict)") return;
    errors.push(message.text());
  });
  await unlink(path.join(project.root, "VELLYM.md"));
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
  await page.getByTestId("folder-add-template").click();
  await page.getByTestId("template-add-option-decision").check();
  await page.getByTestId("template-add-name").fill("Stale decision");
  await expect(page.getByTestId("template-add-create")).toBeEnabled();
  await expect(page.getByTestId("template-add-guide")).toHaveCount(0);
  await writeFile(project.config, (await readFile(project.config, "utf8")) + "\n# External edit\n");
  const rejected = page.waitForResponse(response => response.url() === `${server}/api/v1/templates/apply`);
  await page.getByTestId("template-add-create").click();
  expect((await rejected).status()).toBe(409);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("template-add-create")).toBeDisabled();
  expect(await readdir(path.join(project.content, "target"))).toEqual(["_index.yaml"]);
  await page.close();
  expect(errors).toEqual([]);
});

test.describe("plugin contributions", () => {
  test.use({ plugins: ["tickets"] });
  test("creates a plugin management resource and one record @CORE-MANUAL-E02", async ({ page, server, project }) => {
    await page.goto(server);
    await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
    const addResource = page.getByTestId("folder-add-resource");
    await expect(addResource).toHaveText("Create ticket management");
    await addResource.click();
    await expect(page.getByRole("heading", { name: "Create ticket management", exact: true })).toBeVisible();
    await page.getByTestId("template-add-option-tickets:work").check();
    await expect(page.getByTestId("template-add-create")).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByTestId("template-add-create").click();
    await expect(page.getByTestId("plugin-list")).toBeVisible();
    await page.getByTestId("plugin-list").getByRole("button", { name: /create|new|add/i }).first().click();
    await expect(page.getByTestId("document-save")).toBeVisible();
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("New fixture task");
    await page.getByTestId("document-save").click();
    await expect.poll(async () => {
      const files = await readdir(path.join(project.content, "target/+tickets"));
      return files.length;
    }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "New fixture task" })).toBeVisible();
  });
});

const japanese = test.extend({
  project: async ({ project }, use) => {
    await writeFile(project.config, (await readFile(project.config, "utf8")).replace("language: en", "language: ja"));
    await use(project);
  }
});

japanese("Japanese template selection is accessible at 768px", async ({ page, server }, testInfo) => {
  await page.goto(server);
  await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByTestId("folder-add-template").click();
  await page.getByTestId("template-add-role").selectOption("decisions");
  await page.getByTestId("template-add-option-decision").check();
  await page.getByTestId("template-add-name").fill("設計の決定");
  await expect(page.getByTestId("template-add-create")).toBeEnabled();
  await expect(page.getByTestId("template-add-guide")).not.toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.getByRole("dialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("template-ja-768.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("folder-add-template")).toBeFocused();
});

test("does not expose creation in a static build", async ({ project, staticServer, page }) => {
  test.setTimeout(120_000);
  execFileSync(process.execPath, [cliPath, "build", "--config", project.config], { timeout: 90_000 });
  const [build] = await readdir(path.join(project.root, "dist"));
  const origin = await staticServer(path.join(project.root, "dist", build!), "/site");
  await page.goto(`${origin}/site/`);
  await page.getByRole("treegrid").getByRole("row", { name: /Target folder/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Target folder" })).toBeVisible();
  for (const id of ["folder-add-template", "folder-add-resource", "folder-add-set"]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
});
