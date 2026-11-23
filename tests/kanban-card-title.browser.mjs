// Run after npm run build: node tests/kanban-card-title.browser.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "kanban-card-title-"));
const content = path.join(root, "content");
const trackerDirectory = path.join(content, "demo-tickets");
const ticketsDirectory = path.join(trackerDirectory, "+tickets");
await mkdir(ticketsDirectory, { recursive: true });
await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");

await writeFile(path.join(trackerDirectory, "_index.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: Folder
metadata:
  title: Kanban title fixture
spec: {}
`);
await writeFile(path.join(trackerDirectory, "demo-tickets.yaml"), `apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: demo-tickets
  title: Kanban title fixture
spec:
  statuses:
    - id: todo
      label: 未着手
      category: open
  fields:
    - id: priority
      label: 優先度
      type: select
      options:
        - value: high
          label: 高
  kanban:
    card:
      - priority
`);

const tickets = [
  {
    name: "ticket-title-short",
    title: "API設計"
  },
  {
    name: "ticket-title-long-ja",
    title: "業務ヒアリング項目を整理し関係者と共有するための詳細な準備作業"
  },
  {
    name: "ticket-title-long-ascii",
    title: "AnExtremelyLongUnbrokenTicketTitleThatMustWrapWithoutBeingClipped"
  }
];
for (const ticket of tickets) {
  await writeFile(path.join(ticketsDirectory, `${ticket.name}.yaml`), `apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ${ticket.name}
  title: '${ticket.title}'
spec:
  status: todo
  fields:
    priority: high
  blocks:
    - id: description
      type: rich-text
      content: ''
`);
}

const config = path.join(root, "vellym.config.yaml");
await writeFile(config, `schemaVersion: "1.0"
contentRoot: content
outputDir: dist
ui:
  language: en
i18n:
  defaultLocale: ja
plugins:
  - "@vellym/tickets"
  - "@vellym/kanban"
  - "@vellym/wbs"
`);

const port = 4195;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs", "dev", "--config", config, "--port", String(port)
]);
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });

let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}/api/v1/repository`)).ok) break;
    } catch {}
    if (attempt > 100) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "ja-JP",
    viewport: { width: 1400, height: 900 }
  });
  await page.goto(`${base}/ja/pages/demo-tickets/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Kanban", exact: true }).click();

  const cards = page.locator(".kanban-board article[data-ticket-name]");
  await expect(cards).toHaveCount(tickets.length);
  const measurements = await cards.evaluateAll((elements) => elements.map((card) => {
    const title = card.querySelector("button[aria-keyshortcuts]");
    const firstField = card.querySelector("dt");
    if (!title || !firstField) throw new Error("Kanban card is missing its title or first field");
    const titleRect = title.getBoundingClientRect();
    const fieldRect = firstField.getBoundingClientRect();
    return {
      name: card.dataset.ticketName,
      title: title.textContent,
      titleLeft: titleRect.left,
      fieldLeft: fieldRect.left,
      scrollWidth: title.scrollWidth,
      clientWidth: title.clientWidth
    };
  }));

  expect(measurements.map(({ name }) => name).sort()).toEqual(
    tickets.map(({ name }) => name).sort()
  );
  for (const measurement of measurements) {
    expect(
      Math.abs(measurement.titleLeft - measurement.fieldLeft),
      `${measurement.name}: title and first field are not left-aligned`
    ).toBeLessThanOrEqual(2);
    expect(
      measurement.scrollWidth,
      `${measurement.name}: title overflows its button`
    ).toBeLessThanOrEqual(measurement.clientWidth);
  }
  console.log("Kanban card titles align with their fields and wrap without clipping: passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await rm(root, { recursive: true, force: true });
}
