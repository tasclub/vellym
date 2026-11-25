import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { test as base, expect } from "../fixtures.js";

const test = base.extend({
  project: async ({ project }, use) => {
    await writeFile(path.join(project.content, "tracker.yaml"), stringify({
      apiVersion: "vellym.tasclub.com/v1", kind: "TicketTracker",
      metadata: { name: "tracker", title: "Fixture tracker" },
      spec: {
        statuses: [{ id: "todo", label: "Todo", category: "open" }],
        fields: [{ id: "parent", label: "Parent", type: "reference" }],
        hierarchy: { parentField: "parent" }
      }
    }));
    await mkdir(path.join(project.content, "+tickets"));
    await writeFile(path.join(project.content, "+tickets", "one.yaml"), stringify({
      apiVersion: "vellym.tasclub.com/v1", kind: "Ticket",
      metadata: { name: "one", title: "Fixture ticket" },
      spec: { status: "todo", fields: {}, blocks: [] }
    }));
    await use(project);
  }
});

test.use({ plugins: ["tickets", "kanban", "wbs"] });

test("switches tracker list, kanban and WBS @smoke", async ({ page, server }) => {
  await page.goto(server);
  // The fixture supplies the document's name, not a translated UI label.
  await page.getByRole("treegrid").getByRole("row", { name: /Fixture tracker/ }).click();
  await expect(page.getByTestId("plugin-list")).toBeVisible();
  await expect(page.getByTestId("plugin-list").getByRole("table")).toBeVisible();
  const modes = page.getByRole("group").filter({ has: page.getByRole("button", { pressed: true }) }).first();
  // The three views and tracker settings share this switcher.
  await expect(modes.getByRole("button")).toHaveCount(4);
  await modes.getByRole("button").nth(1).click();
  await expect(page.getByTestId("kanban-board")).toHaveRole("region");
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await modes.getByRole("button").nth(2).click();
  await expect(page.getByRole("main").getByRole("treegrid")).toBeVisible();
  await expect(page.getByTestId("kanban-board")).toHaveCount(0);
  await modes.getByRole("button").first().click();
  await expect(page.getByTestId("plugin-list")).toBeVisible();
});
