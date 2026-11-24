import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPluginView, loadPlugins } from "@vellym-internal/runtime-node";

const directories: string[] = [];
const HOST_VERSION = "0.3.0-beta.1";
const tracker = {
  kind: "TicketTracker",
  name: "tracker",
  title: "Tracker",
  relativePath: "tracker.yaml",
  spec: {},
  readOnly: true
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function installPlugin(
  directory: string,
  name: string,
  entry: string,
  views: Array<{ id: string; static: boolean }>
): Promise<void> {
  const pluginDirectory = path.join(directory, "node_modules", name);
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(path.join(pluginDirectory, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    main: "index.mjs",
    engines: { vellym: ">=0.3.0-beta.1" },
    vellym: {
      id: name,
      contributes: {
        views: views.map((view) => ({
          id: view.id, kind: "TicketTracker", type: "list", static: view.static
        }))
      }
    }
  }));
  await writeFile(path.join(pluginDirectory, "index.mjs"), entry);
}

function view(id: string, role?: "primary" | "settings", staticView = true): string {
  return `host.registerView({
    id: "${id}", opensKind: "TicketTracker", label: { en: "${id}" },
    ${role ? `role: "${role}",` : ""} static: ${staticView},
    view: { type: "list", id: "${id}", kind: "Ticket", title: { en: "${id}" }, columns: [] }
  });`;
}

async function payloadFor(pluginNames: string[], isStatic: boolean) {
  const directory = await mkdtemp(path.join(tmpdir(), "vellym-view-order-"));
  directories.push(directory);
  await installPlugin(directory, "tickets", `export function activate(host) {
    ${view("tickets.list", "primary")}
    ${view("tickets.settings", "settings", false)}
  }`, [{ id: "tickets.list", static: true }, { id: "tickets.settings", static: false }]);
  await installPlugin(directory, "kanban", `export function activate(host) { ${view("kanban.board")} }`, [
    { id: "kanban.board", static: true }
  ]);
  await installPlugin(directory, "wbs", `export function activate(host) { ${view("wbs.outline")} }`, [
    { id: "wbs.outline", static: true }
  ]);
  const registry = await loadPlugins({ configDir: directory, packageNames: pluginNames, hostVersion: HOST_VERSION });
  expect(registry.diagnostics).toEqual([]);
  return buildPluginView({
    registry,
    target: tracker,
    rows: [],
    definitions: () => [],
    locale: "en",
    isStatic
  })!;
}

describe("plugin view ordering", () => {
  it.each([
    [["tickets", "kanban", "wbs"], ["tickets.list", "kanban.board", "wbs.outline", "tickets.settings"]],
    [["wbs", "kanban", "tickets"], ["tickets.list", "wbs.outline", "kanban.board", "tickets.settings"]]
  ])("uses roles around configured plugin order: %j", async (plugins, expected) => {
    const dynamic = await payloadFor(plugins, false);
    expect(dynamic.viewId).toBe("tickets.list");
    expect(dynamic.siblings?.map((item) => item.id)).toEqual(expected);

    const staticPayload = await payloadFor(plugins, true);
    expect(staticPayload.viewId).toBe("tickets.list");
    expect(staticPayload.siblings?.map((item) => item.id)).toEqual(expected.filter((id) => id !== "tickets.settings"));
  });

  it("uses the first remaining configured view when no primary view is registered", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vellym-view-order-"));
    directories.push(directory);
    await installPlugin(directory, "kanban", `export function activate(host) { ${view("kanban.board")} }`, [
      { id: "kanban.board", static: true }
    ]);
    await installPlugin(directory, "wbs", `export function activate(host) { ${view("wbs.outline")} }`, [
      { id: "wbs.outline", static: true }
    ]);
    const registry = await loadPlugins({
      configDir: directory,
      packageNames: ["wbs", "kanban"],
      hostVersion: HOST_VERSION
    });
    expect(registry.diagnostics).toEqual([]);
    const payload = buildPluginView({
      registry, target: tracker, rows: [], definitions: () => [], locale: "en", isStatic: false
    })!;
    expect(payload.viewId).toBe("wbs.outline");
  });
});
