// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PluginRenderContext, PluginSpecWrite } from "@vellym/plugin-api";

vi.mock("@vellym/plugin-api/ui", () => ({
  Button: ({ children, icon: _icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: boolean }) =>
    createElement("button", props, children)
}));
import { TrackerSettingsScreen } from "../packages/plugin-tickets/src/settings-screen.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Tracker hierarchy settings", () => {
  it("configures a parent reference without duplicating the WBS tree on the settings page", async () => {
    const save = vi.fn(async (_writes: readonly PluginSpecWrite[]) => ({ ok: true as const }));
    const openResource = vi.fn(async () => ({ ok: true as const }));
    const context: PluginRenderContext = {
      locale: "ja", isStatic: false, records: () => [],
      target: { kind: "TicketTracker", name: "tracker", title: "Tracker",
        relativePath: "tracker.yaml", readOnly: false,
        spec: { fields: [
          { id: "parent", label: "親", type: "reference" },
          { id: "priority", label: "優先度", type: "select", options: [{ value: "high", label: "高" }] }
        ],
          hierarchy: { parentField: "parent" }, kanban: { card: ["parent"] } } },
      rendererData: {},
      rows: [
        { name: "root", title: "親", values: { trackers: ["tracker"] } },
        { name: "child", title: "子", values: { trackers: ["tracker"], "field:parent": "root" } },
        { name: "other", title: "別", values: { trackers: ["elsewhere"] } },
        { name: "orphan", title: "孤児", values: { trackers: ["tracker"], "field:parent": "gone" } }
      ],
      save, openResource, getViewSettings: () => undefined, setViewSettings: () => {}
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(createElement(TrackerSettingsScreen, { context })));
    expect(container.querySelector('[aria-label="チケットの階層"]')).toBeNull();
    expect(container.textContent).not.toContain("親チケットが見つかりません");
    expect([...container.querySelectorAll("select")].some((select) => select.value === "parent")).toBe(true);
    expect(container.querySelectorAll(".tickets-settings-header")).toHaveLength(3);
    expect(container.querySelector('[data-row="option"]')?.classList.contains("tickets-settings-option-grid"))
      .toBe(true);
    expect(container.querySelectorAll('[data-row="option"] .tickets-settings-actions button[aria-label]'))
      .toHaveLength(2);

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "保存")!.click();
      await Promise.resolve();
    });
    expect(save.mock.calls[0]?.[0]).toContainEqual({ path: ["hierarchy", "parentField"], value: "parent" });
    expect(save.mock.calls[0]?.[0]).not.toContainEqual(expect.objectContaining({ path: ["kanban"] }));
    act(() => root.unmount());
  });
});
