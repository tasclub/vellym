import { readFile } from "node:fs/promises";
import { test, expect } from "../fixtures.js";

test("opens, edits and saves a core document @smoke", async ({ page, server, project }) => {
  await page.goto(server);
  await expect(page.getByRole("treegrid")).toBeVisible();
  // The fixture contains one document. Navigation must be exercised, not bypassed.
  await page.getByRole("treegrid").getByRole("row").first().click();
  await page.getByTestId("document-edit").click();
  // Title is first, the fixture's only body is second.
  await expect(page.getByRole("textbox")).toHaveCount(2);
  const body = page.getByRole("textbox").nth(1);
  await body.fill("Smoke round-trip marker");
  await page.getByTestId("document-save").click();
  await expect.poll(() => readFile(project.pageFile, "utf8")).toContain("Smoke round-trip marker");
});
