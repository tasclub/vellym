// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPluginView } from "../packages/ui-react/src/shared/api.js";

function staticEnvelope(data: unknown) {
  return new Response(JSON.stringify({
    apiSchemaVersion: "1.0",
    buildId: "static-test",
    data,
    diagnostics: []
  }), { headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__VELLYM_STATIC__;
});

describe("静的プラグインビューの索引", () => {
  it("索引に無い資源とviewIdのJSONを取りに行かない", async () => {
    window.__VELLYM_STATIC__ = {
      appBase: "https://example.test/",
      assetBase: "https://example.test/assets",
      dataBase: "https://example.test/data/static-test/ja",
      buildId: "static-test",
      locale: "ja",
      defaultLocale: "ja"
    };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("plugin-views.json")) {
        return staticEnvelope({ views: { ticket: { viewIds: ["detail"] } } });
      }
      if (url.endsWith("views/ticket.json")) {
        return staticEnvelope({ pluginId: "tickets", viewId: "list" });
      }
      if (url.endsWith("views/ticket/detail.json")) {
        return staticEnvelope({ pluginId: "tickets", viewId: "detail" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await expect(fetchPluginView("welcome")).resolves.toBeUndefined();
    await expect(fetchPluginView("ticket", undefined, undefined, "missing"))
      .resolves.toBeUndefined();
    await expect(fetchPluginView("ticket")).resolves.toMatchObject({ viewId: "list" });
    await expect(fetchPluginView("ticket", undefined, undefined, "detail"))
      .resolves.toMatchObject({ viewId: "detail" });

    expect(calls).toEqual([
      "https://example.test/data/static-test/ja/plugin-views.json",
      "https://example.test/data/static-test/ja/views/ticket.json",
      "https://example.test/data/static-test/ja/views/ticket/detail.json"
    ]);
  });
});
