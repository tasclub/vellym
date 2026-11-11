// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Diagnostic, PageView } from "@vellym-internal/core";
import { PluginListPage } from "../packages/ui-react/src/plugin/plugin-area.js";
import type { PluginViewPayload } from "../packages/ui-react/src/plugin/plugin-list-view.js";
import { countUnreadableDocumentFiles } from "../packages/ui-react/src/shell/app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

function diagnostic(
  file: string,
  code: string,
  severity: Diagnostic["severity"] = "error"
): Diagnostic {
  return { file, code, severity, message: "private diagnostic details" };
}

describe("unreadable document diagnostics", () => {
  it("counts distinct files rejected before indexing, and excludes other errors and warnings", () => {
    expect(countUnreadableDocumentFiles([
      diagnostic("broken.yaml", "READ_ERROR"),
      diagnostic("broken.yaml", "YAML_PARSE"),
      diagnostic("conversion.yaml", "YAML_CONVERSION"),
      diagnostic("page-schema.yaml", "PAGE_SCHEMA"),
      diagnostic("resource-schema.yaml", "RESOURCE_SCHEMA"),
      diagnostic("warning.yaml", "READ_ERROR", "warning"),
      diagnostic("locale.yaml", "INVALID_LOCALE"),
      diagnostic("duplicate.yaml", "DUPLICATE_PAGE_ID"),
      diagnostic("ordering.yaml", "FOLDER_ORDER_MISSING")
    ])).toBe(4);
  });

  it("renders only the count and a settings action in Japanese and English", () => {
    const page = {
      page: {
        apiVersion: "vellym.tasclub.com/v1",
        kind: "TicketTracker",
        metadata: { name: "tracker", title: "Tracker" },
        spec: {}
      },
      knownBlocks: [],
      relativePath: "tracker.yaml",
      hash: "hash",
      readOnly: false,
      readOnlyReasons: []
    } as unknown as PageView;
    const payload: PluginViewPayload = {
      pluginId: "tickets",
      viewId: "ticket-list",
      descriptor: { type: "list", id: "ticket-list", kind: "Ticket", title: "Ticket list", columns: [] },
      rows: [],
      allRows: [],
      commands: []
    };

    const noticeCases: Array<[string, string]> = [
      ["読み込めない文書が2件あります。", "設定で確認"],
      ["2 documents couldn't be loaded.", "View in settings"]
    ];
    for (const [message, action] of noticeCases) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const onOpenDiagnostics = vi.fn();
      act(() => root!.render(createElement(PluginListPage, {
        payload,
        view: page,
        projectRoot: "/projects/demo",
        targetName: "tracker",
        uiLocale: message.startsWith("2 ") ? "en" : "ja",
        showAll: false,
        onToggleShowAll: () => {},
        onNavigate: () => {},
        onSwitchView: () => {},
        onRunCommand: () => {},
        editable: false,
        onBulkChange: async () => [],
        onBulkArchive: async () => [],
        diagnosticsNotice: message,
        diagnosticsAction: action,
        onOpenDiagnostics
      })));

      expect(container.textContent).toContain(message);
      expect(container.textContent).not.toContain("broken.yaml");
      expect(container.textContent).not.toContain("private diagnostic details");
      const button = [...container.querySelectorAll("button")]
        .find((item) => item.textContent === action);
      expect(button).toBeDefined();
      act(() => button!.click());
      expect(onOpenDiagnostics).toHaveBeenCalledOnce();

      act(() => root!.unmount());
      root = undefined;
      container.remove();
      container = undefined;
    }
  });

  it("keeps both message translations count-based and the action localized", () => {
    const japanese = JSON.parse(readFileSync("packages/ui-react/src/locales/ja.json", "utf8")) as Record<string, string>;
    const english = JSON.parse(readFileSync("packages/ui-react/src/locales/en.json", "utf8")) as Record<string, string>;
    expect(japanese["app.unreadableDocumentsMessage"]).toBe("読み込めない文書が{{count}}件あります。");
    expect(japanese["app.unreadableDocumentsAction"]).toBe("設定で確認");
    expect(english["app.unreadableDocumentsMessage"]).toBe("{{count}} documents couldn't be loaded.");
    expect(english["app.unreadableDocumentsAction"]).toBe("View in settings");
  });
});
