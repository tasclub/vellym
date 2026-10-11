// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRenderContext } from "@vellym/plugin-api";

vi.mock("@vellym/plugin-api/ui", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
  KindIcon: () => null
}));

import { KanbanScreen } from "../packages/plugin-kanban/src/screen.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statuses = [
  { id: "todo", label: "未着手" },
  { id: "doing", label: "対応中" }
];

function renderScreen(overrides: Partial<PluginRenderContext> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const context: PluginRenderContext = {
    locale: "ja",
    isStatic: false,
    records: () => [],
    target: {
      kind: "TicketTracker",
      name: "tracker",
      title: "Tracker",
      relativePath: "tracker.yaml",
      spec: {},
      readOnly: false
    },
    rendererData: { statuses, fields: [], cardFields: [], summaries: [], diagnostics: [] },
    rows: [{ name: "ticket-1", title: "One", values: { status: "todo" } }],
    save: async () => ({ ok: true }),
    openResource: async () => ({ ok: true }),
    getViewSettings: () => undefined,
    setViewSettings: () => {},
    ...overrides
  };
  act(() => root.render(createElement(KanbanScreen, { context })));
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Kanban screen interactions", () => {
  it("selects visible columns in one place, shows excluded counts, and restores the choice", () => {
    let stored: unknown;
    const preference = {
      getViewSettings: () => stored,
      setViewSettings: (value: unknown) => { stored = value; }
    };
    const first = renderScreen({
      ...preference,
      rows: [
        { name: "ticket-1", title: "One", values: { status: "todo" } },
        { name: "ticket-2", title: "Two", values: { status: "doing" } }
      ]
    });
    expect(first.container.textContent).not.toContain("列を折りたたむ");
    expect(first.container.textContent).not.toContain("列を非表示");
    expect(first.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    const doing = first.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    act(() => doing.click());
    expect(first.container.querySelector("#kanban-defined-doing")).toBeNull();
    expect(first.container.textContent).toContain("表示していない列: 対応中 (1)");
    expect(stored).toMatchObject({ tracker: { columns: ["defined:todo"] } });
    first.unmount();

    const second = renderScreen({ ...preference });
    expect(second.container.querySelector("#kanban-defined-doing")).toBeNull();
    second.unmount();

    const other = renderScreen({
      ...preference,
      target: {
        kind: "TicketTracker", name: "other-tracker", title: "Other", relativePath: "other.yaml",
        spec: {}, readOnly: false
      }
    });
    expect(other.container.querySelector("#kanban-defined-doing")).not.toBeNull();
    other.unmount();
  });

  it("allows selection in static output even when preferences cannot be saved", () => {
    const { container, unmount } = renderScreen({ isStatic: true, setViewSettings: () => {} });
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(container.querySelector("#kanban-defined-todo")).toBeNull();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    unmount();
  });

  it("keeps an excluded unset column selectable after its last ticket disappears", () => {
    let stored: unknown;
    const preference = {
      getViewSettings: () => stored,
      setViewSettings: (value: unknown) => { stored = value; }
    };
    const first = renderScreen({
      ...preference,
      rows: [{ name: "ticket-1", title: "One", values: { status: "" } }]
    });
    const unset = [...first.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent?.includes("未設定"))!;
    act(() => unset.click());
    expect(first.container.textContent).toContain("表示していない列: 未設定 (1)");
    first.unmount();

    const second = renderScreen({ ...preference, rows: [] });
    expect(second.container.textContent).toContain("表示していない列: 未設定 (0)");
    const restored = [...second.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent?.includes("未設定"))!;
    expect(restored.checked).toBe(false);
    act(() => restored.click());
    expect(second.container.textContent).not.toContain("表示していない列");
    second.unmount();
  });

  it("limits initial rendering to 20 while keeping the full count and summary", () => {
    const rows = Array.from({ length: 23 }, (_, index) => ({
      name: `ticket-${String(index).padStart(2, "0")}`, title: `Ticket ${index}`,
      values: { status: "todo", "field:estimate": 1 }
    }));
    const result = renderScreen({
      rows,
      rendererData: {
        statuses, diagnostics: [], fields: [], cardFields: [], summaries: [{
          field: { id: "estimate", label: "見積", type: "number", required: false, listColumn: false },
          method: "sum"
        }]
      }
    });
    expect(result.container.querySelectorAll("article")).toHaveLength(20);
    expect(result.container.querySelector("#kanban-defined-todo")?.textContent).toContain("23");
    expect(result.container.textContent).toContain("見積 合計: 23");
    const more = [...result.container.querySelectorAll("button")].find((button) => button.textContent?.includes("残り3件"))!;
    act(() => more.click());
    expect(result.container.querySelectorAll("article")).toHaveLength(23);
    result.unmount();
  });

  it("keeps a newly moved card visible when its destination already has 20 cards", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const rows = Array.from({ length: 20 }, (_, index) => ({
      name: `ticket-${String(index).padStart(2, "0")}`,
      title: `Ticket ${index}`,
      values: { status: "doing" }
    }));
    const result = renderScreen({
      save,
      rows: [{ name: "ticket-last", title: "ZZZ", values: { status: "todo" } }, ...rows]
    });
    const card = result.container.querySelector('article[data-ticket-name="ticket-last"] button[aria-keyshortcuts]')!;
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
      await Promise.resolve();
    });
    const destination = result.container.querySelector('section[aria-labelledby="kanban-defined-doing"]')!;
    expect(destination.textContent).toContain("(21)");
    expect(destination.querySelectorAll("article")).toHaveLength(20);
    expect(destination.querySelector('article[data-ticket-name="ticket-last"]')).not.toBeNull();
    result.unmount();
  });

  it("reports excluded summary values in the editor but not in static output", () => {
    const definition = { statuses, diagnostics: [], fields: [], cardFields: [], summaries: [{
      field: { id: "estimate", label: "見積", type: "number" as const, required: false, listColumn: false },
      method: "sum" as const
    }] };
    const rows = [{ name: "ticket-1", title: "One", values: { status: "todo", "field:estimate": "invalid" } }];
    const editor = renderScreen({ rows, rendererData: definition });
    expect(editor.container.textContent).toContain("型が合わず除外: 1");
    editor.unmount();
    const published = renderScreen({ rows, rendererData: definition, isStatic: true });
    expect(published.container.textContent).not.toContain("型が合わず除外");
    published.unmount();
  });

  it("summarizes all tickets, including hidden columns and cards past the first 20", () => {
    const definition = { statuses, diagnostics: [], fields: [], cardFields: [], summaries: [{
      field: { id: "estimate", label: "見積", type: "number" as const, required: false, listColumn: false },
      method: "sum" as const
    }] };
    const rows = Array.from({ length: 22 }, (_, index) => ({
      name: `ticket-${index}`, title: `Ticket ${index}`,
      values: { status: index === 21 ? "doing" : "todo", "field:estimate": 1 }
    }));
    const result = renderScreen({ rows, rendererData: definition });
    const whole = result.container.querySelector('[aria-label="ボード全体の集計"]')!;
    expect(whole.textContent).toContain("全22件（非表示の列と20件以降も含む）");
    expect(whole.textContent).toContain("22");
    expect(result.container.querySelectorAll("article")).toHaveLength(21);
    const doing = result.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    act(() => doing.click());
    expect(whole.textContent).toContain("22");
    expect(result.container.querySelectorAll("article")).toHaveLength(20);
    result.unmount();
    const absent = renderScreen();
    expect(absent.container.querySelector('[aria-label="ボード全体の集計"]')).toBeNull();
    absent.unmount();
  });

  it("renders selected card fields from projected values", () => {
    const result = renderScreen({
      rows: [{ name: "ticket-1", title: "One", values: { status: "todo", "field:priority": "high" } }],
      rendererData: { statuses, diagnostics: [], summaries: [], fields: [], cardFields: [
        { id: "priority", label: "優先度", type: "select", required: false, listColumn: false,
          options: [{ value: "high", label: "高" }] }
      ] }
    });
    expect(result.container.querySelector("article dl")?.textContent).toContain("優先度:高");
    result.unmount();
  });

  it("updates only the moved card's order and explicitly confirms column renumbering", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const result = renderScreen({
      save,
      rows: [
        { name: "ticket-1", title: "One", values: { status: "todo", "field:order": 1 } },
        { name: "ticket-2", title: "Two", values: { status: "todo", "field:order": 2 } }
      ],
      rendererData: { statuses, diagnostics: [], summaries: [], fields: [], cardFields: [],
        orderField: { id: "order", label: "順序", type: "number", required: false, listColumn: false } }
    });
    const down = result.container.querySelector<HTMLButtonElement>('button[aria-label="One: 下へ移動"]')!;
    await act(async () => { down.click(); await Promise.resolve(); });
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "order"], value: 3 }], { targetName: "ticket-1" });
    expect([...result.container.querySelectorAll('section[aria-labelledby="kanban-defined-todo"] article button[aria-keyshortcuts]')]
      .map((item) => item.textContent)).toEqual(["Two", "One"]);
    const renumber = [...result.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("順序を振り直す"))!;
    await act(async () => { renumber.click(); await Promise.resolve(); });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("2件"));
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "order"], value: 1 }], { targetName: "ticket-2" });
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "order"], value: 2 }], { targetName: "ticket-1" });
    result.unmount();
    confirm.mockRestore();
  });

  it("moves a card with the documented keyboard shortcut and saves one Ticket", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const { container, unmount } = renderScreen({ save });
    const title = container.querySelector('button[aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"]');
    expect(title).not.toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(2);

    await act(async () => {
      title!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledWith([{ path: ["status"], value: "doing" }], {
      targetName: "ticket-1"
    });
    expect(container.querySelector("#kanban-defined-doing")?.closest("section")?.textContent).toContain("One");
    expect(container.querySelector("#kanban-defined-todo")?.closest("section")?.textContent).not.toContain("One");
    unmount();
  });

  it("keeps the card in its original column and explains a conflict", async () => {
    const save = vi.fn(async () => ({ ok: false as const, reason: "conflict" as const, message: "changed" }));
    const { container, unmount } = renderScreen({ save });
    const title = container.querySelector('button[aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"]')!;

    await act(async () => {
      title.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector("#kanban-defined-todo")?.closest("section")?.textContent).toContain("One");
    expect(container.querySelector("#kanban-defined-doing")?.closest("section")?.textContent).not.toContain("One");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("他でチケットが変更されました");
    unmount();
  });

  it("omits status-change controls from static output", () => {
    const { container, unmount } = renderScreen({ isStatic: true });

    expect(container.querySelector("article[draggable]")).toBeNull();
    unmount();
  });
});
