import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@vellym-internal/core";
import {
  PLUGIN_MANIFEST_FIELD,
  PLUGIN_MANIFEST_SCHEMA,
  defineBrowserPlugin,
  definePlugin,
  resolveLocalizedText,
  type PluginDiagnostic,
  type PluginPackageManifest,
  type PluginRecordProjectorFactory,
  type PluginRenderContext,
  type PluginViewRenderer,
  type VellymBrowserPluginHost,
  type VellymPluginHost
} from "@vellym/plugin-api";
import { reactRenderer } from "@vellym/plugin-api/react";

function validateManifest(value: unknown): boolean {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.validate(PLUGIN_MANIFEST_SCHEMA, value) === true;
}

describe("plugin-api contract", () => {
  it("keeps PluginDiagnostic structurally interchangeable with the core Diagnostic", () => {
    // 契約はCoreの型を再輸出しない。二重定義が離れていくのを型で止める。
    const fromPlugin: PluginDiagnostic = {
      file: "tickets/ticket-01.yaml",
      path: "/spec/status",
      severity: "warning",
      code: "TICKET_STATUS_UNDEFINED",
      message: "定義に無いステータスです"
    };
    const asCore: Diagnostic = fromPlugin;
    const backToPlugin: PluginDiagnostic = asCore;
    expect(backToPlugin).toBe(fromPlugin);
  });

  it("resolves localized text with a fallback that is never empty", () => {
    const label = { ja: "優先度", en: "Priority" };
    expect(resolveLocalizedText(label, "ja")).toBe("優先度");
    expect(resolveLocalizedText(label, "en")).toBe("Priority");
    // 未定義のlocaleでもfallbackへ落ちる。空欄にすると未翻訳と値なしを区別できない。
    expect(resolveLocalizedText(label, "fr")).toBe("Priority");
    expect(resolveLocalizedText({ ja: "優先度" }, "fr")).toBe("優先度");
    expect(resolveLocalizedText("Priority", "ja")).toBe("Priority");
  });

  it("resolves a region locale through its base language", () => {
    expect(resolveLocalizedText({ ja: "期限", en: "Due" }, "ja-JP")).toBe("期限");
  });

  it("accepts a manifest that declares the four contribution points", () => {
    const manifest: PluginPackageManifest["vellym"] = {
      id: "tickets",
      contributes: {
        kinds: [
          { kind: "Ticket" },
          { kind: "TicketTracker", showInDocumentTree: true, hasBlocks: false }
        ],
        views: [
          {
            id: "ticket-list",
            kind: "Ticket",
            opensKind: "TicketTracker",
            type: "list",
            static: true
          },
          { id: "ticket-detail", kind: "Ticket", type: "detail", static: true }
        ],
        commands: [
          { id: "ticket.create", title: { ja: "チケットを作成", en: "New ticket" }, static: false },
          {
            id: "ticket.create-tracker",
            title: { ja: "チケット管理", en: "Ticket tracker" },
            static: false,
            placement: "document-tree"
          }
        ],
        settings: []
      }
    };
    expect(validateManifest(manifest)).toBe(true);
  });

  it("rejects manifests the host cannot act on", () => {
    expect(validateManifest({})).toBe(false);
    expect(validateManifest({ id: "Tickets" })).toBe(false);
    expect(validateManifest({ id: "tickets", contributes: { unknown: [] } })).toBe(false);
    // staticの宣言が無いviewは、静的版へ出すかを決められない。
    expect(
      validateManifest({
        id: "tickets",
        contributes: { views: [{ id: "ticket-list", kind: "Ticket", type: "list" }] }
      })
    ).toBe(false);
  });

  it("names the package.json field the host reads", () => {
    expect(PLUGIN_MANIFEST_FIELD).toBe("vellym");
  });

  it("registers contributions through the host without touching the filesystem", () => {
    const kinds: string[] = [];
    const projections = new Map<string, PluginRecordProjectorFactory>();
    const host: VellymPluginHost = {
      pluginId: "tickets",
      hostVersion: "0.3.0-beta.1",
      registerKind: (contribution) => kinds.push(contribution.kind),
      registerView: () => {},
      registerCommand: () => {},
      registerRecordProjection: (kind, project) => projections.set(kind, project),
      reportDiagnostic: () => {}
    };

    const plugin = definePlugin({
      activate(pluginHost) {
        pluginHost.registerKind({ kind: "Ticket", showInDocumentTree: false });
        pluginHost.registerRecordProjection("Ticket", () => (record) => ({
          values: { status: String(record.spec.status ?? "") }
        }));
      }
    });
    plugin.activate(host);

    expect(kinds).toEqual(["Ticket"]);
    const project = projections.get("Ticket")?.({ records: () => [] });
    expect(project).toBeDefined();
    expect(
      project?.({
        kind: "Ticket",
        name: "ticket-01jxyzabcdefghijklmnopqr",
        title: "言語切り替えを追加する",
        relativePath: "tickets/ticket-01jxyzabcdefghijklmnopqr.yaml",
        spec: { status: "in-progress" },
        readOnly: false
      })
    ).toEqual({ values: { status: "in-progress" } });
  });

  it("lets a browser plugin draw without React through the mount contract", () => {
    // 描画契約はmountであり、React固有の型を一切通さない。Vanillaで書いた
    // rendererがそのまま登録できることを型と呼び出しの両方で固定する。
    const calls: string[] = [];
    const renderers = new Map<string, PluginViewRenderer>();
    const host: VellymBrowserPluginHost = {
      pluginId: "tickets",
      hostVersion: "0.3.0-beta.1",
      registerViewRenderer: (viewId, renderer) => renderers.set(viewId, renderer)
    };

    const plugin = defineBrowserPlugin({
      activate(browserHost) {
        browserHost.registerViewRenderer("ticket-list", {
          mount(_element, context) {
            calls.push(`mount:${context.locale}`);
            return {
              update: (next) => calls.push(`update:${next.locale}`),
              unmount: () => calls.push("unmount")
            };
          }
        });
      }
    });
    plugin.activate(host);

    const renderer = renderers.get("ticket-list");
    expect(renderer).toBeDefined();
    const context: PluginRenderContext = {
      locale: "ja",
      isStatic: false,
      records: () => [],
      rows: [],
      save: async () => ({ ok: true })
    };
    // hostは要素の中身へ触らない。rendererに渡すだけである。
    const element = {} as HTMLElement;
    const handle = renderer?.mount(element, context);
    handle?.update?.({ ...context, locale: "en" });
    handle?.unmount();

    expect(calls).toEqual(["mount:ja", "update:en", "unmount"]);
  });

  it("keeps update optional so a renderer can rely on remount alone", () => {
    // updateは描き直しを避けるための最適化であり、省略しても契約を満たす。
    // 省略した場合はhostがunmountして新しい要素へmountし直す。
    const renderer: PluginViewRenderer = {
      mount: () => ({ unmount: () => {} })
    };
    const handle = renderer.mount({} as HTMLElement, {
      locale: "ja",
      isStatic: false,
      records: () => [],
      rows: [],
      save: async () => ({ ok: true })
    });
    expect(handle.update).toBeUndefined();
  });

  it("wraps a React component into the same mount contract", () => {
    // Reactで書く作者の入口。契約側は素のmountのままで、Reactへの依存は
    // /react のsubpathに閉じている。
    const renderer = reactRenderer(() => null);
    expect(typeof renderer.mount).toBe("function");
  });
});
