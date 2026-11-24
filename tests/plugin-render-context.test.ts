import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderContext } from "../packages/ui-react/src/plugin/render-context.js";
import { pluginViewSettingsKey } from "../packages/ui-react/src/plugin/view-settings.js";

function context(overrides: {
  projectRoot?: string;
  targetName?: string;
  onOpenResource?: (name: string) => Promise<{ ok: true } | { ok: false; message: string; reason: "not-found" | "unavailable" }>;
  onSaved?: () => void;
  saveDraft?: () => Promise<void>;
} = {}) {
  return createRenderContext({
    payload: {
      pluginId: "kanban",
      viewId: "ticket-kanban",
      descriptor: {
        type: "list",
        id: "ticket-kanban",
        kind: "Ticket",
        title: "Kanban",
        columns: []
      },
      rows: [],
      allRows: [],
      commands: []
    },
    locale: "ja",
    projectRoot: overrides.projectRoot ?? "/workspace/project",
    targetKind: "TicketTracker",
    targetName: overrides.targetName ?? "quality-tickets",
    targetTitle: "品質チケット",
    targetPath: "40-品質/quality-tickets.yaml",
    onOpenResource: overrides.onOpenResource ?? (async (name) => ({
      ok: false,
      reason: "not-found",
      message: `not found: ${name}`
    })),
    onSaved: overrides.onSaved ?? (() => {}),
    saveDraft: overrides.saveDraft,
    describeError: String
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("plugin render context", () => {
  it("creates immediately and refreshes without using draft or navigation", async () => {
    const saved = vi.fn();
    const draftSave = vi.fn();
    const open = vi.fn(async () => ({ ok: true as const }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      apiSchemaVersion: "1", data: { name: "new-page", relativePath: "new-page.yaml" }, diagnostics: []
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const draft = { kind: "Page", name: "new-page", title: "New", spec: {} };
    const render = context({ onSaved: saved, saveDraft: draftSave, onOpenResource: open });
    expect(await render.createResourceNow!(draft)).toEqual({ ok: true, name: "new-page" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/plugins/resources");
    expect(JSON.parse(String(init.body))).toEqual({ baseHash: null, draft });
    expect(saved).toHaveBeenCalledOnce();
    expect(draftSave).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([[409, "conflict"], [500, "error"]] as const)("reports HTTP %i as %s", async (status, reason) => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      apiSchemaVersion: "1", data: null, diagnostics: [{ code: "FAIL", message: "failed" }]
    }), { status, headers: { "Content-Type": "application/json" } }));
    const saved = vi.fn();
    expect(await context({ onSaved: saved }).createResourceNow!({
      kind: "Page", name: "new-page", title: "New", spec: {}
    })).toMatchObject({ ok: false, reason, message: expect.any(String) });
    expect(saved).not.toHaveBeenCalled();
  });

  it("rejects creation in static output", async () => {
    vi.stubGlobal("window", { __VELLYM_STATIC__: { appBase: "https://example.test/", dataBase: "https://example.test/data" } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await context().createResourceNow!({
      kind: "Page", name: "new-page", title: "New", spec: {}
    })).toMatchObject({ ok: false, reason: "error", message: expect.any(String) });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("delegates view commands to the host instead of creating a file in the renderer", async () => {
    const run = vi.fn(async () => ({ ok: true as const }));
    const render = createRenderContext({
      payload: { pluginId: "wbs", viewId: "wbs-tree", descriptor: {
        type: "list", id: "wbs-tree", kind: "Ticket", title: "WBS", columns: []
      }, rows: [], allRows: [], commands: [] },
      locale: "ja", projectRoot: "/workspace/project", targetKind: "TicketTracker", targetName: "tracker", targetTitle: "Tracker",
      targetPath: "tracker.yaml", onOpenResource: async () => ({ ok: true }),
      onRunCommand: run, onSaved: () => {}, describeError: String
    });
    await expect(render.runCommand?.("ticket.create", { title: "New", parent: "existing" }))
      .resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("ticket.create", { title: "New", parent: "existing" });
  });
  it("passes only the Node-resolved renderer data through to a custom renderer", () => {
    const rendererData = {
      trackerName: "quality-tickets",
      statuses: [{ id: "todo", label: "未着手" }]
    };
    const renderContext = createRenderContext({
      payload: {
        pluginId: "kanban",
        viewId: "ticket-kanban",
        descriptor: {
          type: "list",
          id: "ticket-kanban",
          kind: "Ticket",
          title: "Kanban",
          columns: [],
          rendererData
        },
        rows: [],
        allRows: [],
        commands: []
      },
      locale: "ja",
      projectRoot: "/workspace/project",
      targetKind: "TicketTracker",
      targetName: "quality-tickets",
      targetTitle: "品質チケット",
      targetPath: "40-品質/quality-tickets.yaml",
      onOpenResource: async () => ({ ok: true }),
      onSaved: () => {},
      describeError: String
    });

    expect(renderContext.rendererData).toEqual(rendererData);
    expect(renderContext.target?.kind).toBe("TicketTracker");
    // definition records全体はbrowserへ渡さない。
    expect(renderContext.records("TicketTracker")).toEqual([]);
  });

  it("delegates resource navigation and returns missing-resource results", async () => {
    const open = vi.fn(async (name: string) => name === "ticket-1"
      ? { ok: true as const }
      : { ok: false as const, reason: "not-found" as const, message: "missing" });
    const renderContext = context({ onOpenResource: open });

    await expect(renderContext.openResource("ticket-1")).resolves.toEqual({ ok: true });
    await expect(renderContext.openResource("missing")).resolves.toMatchObject({ ok: false, reason: "not-found" });
    expect(open).toHaveBeenCalledWith("ticket-1");
    expect(open).toHaveBeenCalledWith("missing");
  });

  it("scopes view settings by project, plugin, view, and target resource", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    values.set("vellym.plugin-view.kanban.ticket-kanban", JSON.stringify({ legacy: true }));
    const renderContext = context();

    expect(renderContext.getViewSettings()).toBeUndefined();

    renderContext.setViewSettings({ collapsed: ["defined:todo"] });

    expect(values.get("vellym.user-settings.v2:%2Fworkspace%2Fproject:kanban:ticket-kanban:quality-tickets")).toBe(
      JSON.stringify({ collapsed: ["defined:todo"] })
    );
    expect(renderContext.getViewSettings()).toEqual({ collapsed: ["defined:todo"] });

    expect(context({ targetName: "other-tracker" }).getViewSettings()).toBeUndefined();
    expect(context({ projectRoot: "/workspace/other" }).getViewSettings()).toBeUndefined();
  });

  it("normalizes the project root and encodes each key component without ambiguity", () => {
    const scope = {
      projectRoot: "/workspace/project/",
      pluginId: "tickets",
      viewId: "tracker.settings",
      targetName: "tracker:one"
    };
    expect(pluginViewSettingsKey(scope)).toBe(
      "vellym.user-settings.v2:%2Fworkspace%2Fproject:tickets:tracker.settings:tracker%3Aone"
    );
    expect(pluginViewSettingsKey({ ...scope, projectRoot: "\\workspace\\project" }))
      .toBe(pluginViewSettingsKey(scope));
  });

  it("treats unavailable localStorage as an optional preference store", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("storage disabled"); },
        setItem: () => { throw new Error("storage disabled"); }
      }
    });
    const renderContext = context();

    expect(renderContext.getViewSettings()).toBeUndefined();
    expect(() => renderContext.setViewSettings({ collapsed: ["defined:todo"] })).not.toThrow();
  });

  it("saves to the requested resource name and uses its fresh hash", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      return new Response(JSON.stringify({
        apiSchemaVersion: "1",
        data: url.endsWith("/edit") ? { hash: "fresh-hash" } : {},
        diagnostics: []
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const renderContext = context();

    expect(await renderContext.save([{ path: ["status"], value: "done" }], {
      targetName: "ticket-1"
    })).toEqual({ ok: true });
    expect(requests.map((request) => request.url)).toEqual([
      "/api/v1/pages/ticket-1/edit",
      "/api/v1/pages/ticket-1"
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      baseHash: "fresh-hash",
      specValues: [{ path: ["status"], value: "done" }]
    });
  });

  it("keeps the opened resource as the default save target", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify({
        apiSchemaVersion: "1",
        data: url.endsWith("/edit") ? { hash: "fresh-hash" } : {},
        diagnostics: []
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    expect(await context().save([{ path: ["fields", "name"], value: "updated" }])).toEqual({ ok: true });
    expect(urls).toEqual([
      "/api/v1/pages/quality-tickets/edit",
      "/api/v1/pages/quality-tickets"
    ]);
  });

  it("returns a distinguishable conflict result for HTTP 409", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      const conflict = !url.endsWith("/edit");
      return new Response(JSON.stringify({
        apiSchemaVersion: "1",
        data: conflict ? null : { hash: "fresh-hash" },
        diagnostics: conflict ? [{ code: "PAGE_EDIT_CONFLICT", message: "changed" }] : []
      }), {
        status: conflict ? 409 : 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const renderContext = context();

    expect(await renderContext.save([{ path: ["status"], value: "done" }], {
      targetName: "ticket-1"
    })).toMatchObject({ ok: false, reason: "conflict" });
  });
});
