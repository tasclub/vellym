// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PluginIndexRow, PluginRenderContext, PluginSaveResult, PluginSpecWrite } from "@vellym/plugin-api";
vi.mock("@vellym/plugin-api/ui", () => ({
  Button: ({ children, tone: _tone, icon: _icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: string; icon?: boolean
  }) => createElement("button", props, children),
  ChoiceControl: ({ options, onChange, ...props }: {
    options: Array<{ value: string; label: string }>;
    onChange(value: string): void;
    value: string;
  } & Record<string, unknown>) => createElement("select", {
    ...props,
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)
  }, ...options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))),
  InputControl: (props: React.InputHTMLAttributes<HTMLInputElement>) => createElement("input", props)
  ,FieldInput: ({ value, onChange, field, ...props }: { value: string; onChange(value: string): void; field: { type: string } } & Record<string, unknown>) =>
    createElement("input", { ...props, type: field.type === "date" ? "date" : "text", value,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) })
}));
import { WBSScreen, cellWrite, equalCell, pruneCellOverrides } from "../packages/plugin-wbs/src/screen.js";
import { formatCell, wbsView, type WBSRendererData } from "../packages/plugin-wbs/src/view.js";

describe("WBS detail formatting", () => {
  it("prepares cell writes and reconciles indexed values", () => {
    expect(cellWrite("status", "done")).toEqual({ path: ["status"], value: "done" });
    expect(cellWrite("start", "")).toEqual({ path: ["fields", "start"], value: null });
    expect(equalCell(["a", "b"], ["a", "b"])).toBe(true);
    expect(equalCell(undefined, null)).toBe(true);
    const key = "root\u0000start";
    const rows = [{ name: "root", title: "Root", values: { "field:start": "2026-01-01" } }];
    expect(pruneCellOverrides({ [key]: "2026-01-01" }, rows, new Set())).toEqual({});
    expect(pruneCellOverrides({ [key]: "2026-01-01" }, rows, new Set([key]))).toEqual({ [key]: "2026-01-01" });
  });
  it("formats values by type", () => {
    const data = { columns: [], diagnostics: [], statusSymbols: { todo: "○" },
      tracker: { statuses: [{ id: "todo", label: "Todo", category: "open" }] } } as unknown as WBSRendererData;
    const col = (type: string) => ({ id: type, label: type, type, options: [{ value: "a", label: "Alpha" }] });
    expect(formatCell(col("status"), "todo", [], data)).toBe("○ Todo");
    expect(formatCell(col("select"), "a", [], data)).toBe("Alpha");
    expect(formatCell(col("multiselect"), ["a", "b"], [], data)).toBe("Alpha、b");
    expect(formatCell(col("boolean"), true, [], data)).toBe("✓");
    expect(formatCell(col("boolean"), false, [], data)).toBe("");
    expect(formatCell(col("reference"), "a", [{ name: "a", title: "Task A" }], data)).toBe("Task A");
    expect(formatCell(col("date"), "2026-11-23", [], data)).toBe("2026-11-23");
    expect(formatCell(col("text"), "", [], data)).toBe("—");
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(isStatic = false, customRows?: PluginIndexRow[]) {
  const save = vi.fn(async (_writes: readonly PluginSpecWrite[], _options?: { targetName?: string }): Promise<PluginSaveResult> =>
    ({ ok: true }));
  const openResource = vi.fn(async (_name: string) => ({ ok: true as const }));
  const context: PluginRenderContext = {
    locale: "ja", isStatic, target: { kind: "TicketTracker", name: "project", title: "計画",
      relativePath: "tracker.yaml", readOnly: false, spec: {} },
    records: () => [], getViewSettings: () => undefined, setViewSettings: () => {},
    rendererData: { tracker: { name: "project", title: "計画", relativePath: "tracker.yaml",
      fields: [{ id: "parent", label: "親", type: "reference" },
        { id: "start", label: "開始", type: "date" }, { id: "due", label: "終了", type: "date" },
        { id: "rank", label: "順序", type: "number" }], statuses: [], parentField: "parent" },
      parentField: "parent", startField: "start", endField: "due", orderField: "rank", diagnostics: [] },
    rows: customRows ?? [
      { name: "root", title: "親", values: { "field:rank": 1, "field:start": "2026-10-01" } },
      { name: "child", title: "子", values: { "field:parent": "root", "field:rank": 2 } },
      { name: "orphan", title: "孤児", values: { "field:parent": "missing", "field:rank": 3 } }
    ], save, openResource
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(WBSScreen, { context })));
  return { context, save, openResource, container, root };
}

function openMenu(container: HTMLElement, name: string) {
  act(() => container.querySelector<HTMLButtonElement>(`[data-ticket-name="${name}"] .wbs-actions button[aria-expanded]`)!.click());
  return container.querySelector<HTMLElement>(`[data-ticket-name="${name}"] .wbs-row-menu`)!;
}
function clickText(container: HTMLElement, text: string) {
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!.click();
}
function editParent(container: HTMLElement, name: string) {
  const menu = openMenu(container, name);
  act(() => clickText(menu, "親を変更…"));
}

describe("WBS screen", () => {
  it("saves cells once, retains optimistic values until indexed, and rolls back conflicts", async () => {
    const { context, container, root, save } = fixture(false, [{ name: "root", title: "Root",
      values: { status: "todo", "field:start": "2026-01-01" } }]);
    const data = context.rendererData as WBSRendererData;
    const next = { ...context, rendererData: { ...data, columns: [
      { id: "status", label: "状態", type: "status" }, { id: "start", label: "開始", type: "date" }
    ], tracker: { ...data.tracker!, statuses: [{ id: "todo", label: "Todo", category: "open" as const },
      { id: "done", label: "Done", category: "closed" as const }] } } };
    act(() => root.render(createElement(WBSScreen, { context: next })));
    const cell = (id: string) => container.querySelector<HTMLElement>(`[data-ticket-name="root"] [data-cell="${id}"]`)!;
    act(() => cell("status").querySelector("button")!.click());
    await act(async () => { const select = cell("status").querySelector("select")!; select.value = "done"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(save).toHaveBeenCalledWith([{ path: ["status"], value: "done" }], { targetName: "root" });
    expect(cell("status").textContent).toContain("Done");
    act(() => cell("status").querySelector("button")!.click());
    await act(async () => { const select = cell("status").querySelector("select")!; select.value = "done"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(save).toHaveBeenCalledTimes(1);
    save.mockImplementationOnce(async () => ({ ok: false, reason: "conflict", message: "conflict" }));
    act(() => cell("start").querySelector("button")!.click());
    await act(async () => {
      const input = cell("start").querySelector("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(save).toHaveBeenLastCalledWith([{ path: ["fields", "start"], value: null }], { targetName: "root" });
    expect(cell("start").textContent).toContain("2026-01-01");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("他で変更");
    act(() => root.unmount());
  });
  it("validates pane settings and preserves one visible pane in live and static views", () => {
    for (const isStatic of [false, true]) for (const value of [undefined, {}, { title: false, details: false, schedule: false }, { title: true, details: "bad", schedule: false }]) {
      const { context, container, root, save } = fixture(isStatic);
      act(() => root.unmount());
      let stored: Record<string, unknown> = { panes: value, other: 1 };
      const next = { ...context, getViewSettings: () => stored, setViewSettings: (v: unknown) => { stored = v as Record<string, unknown>; } };
      const mounted = createRoot(container);
      act(() => mounted.render(createElement(WBSScreen, { context: next })));
      const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === name && b.hasAttribute("aria-pressed"))!;
      expect(button("題名").getAttribute("aria-pressed")).toBe("true");
      expect(button("詳細").getAttribute("aria-pressed")).toBe("true");
      expect(button("スケジュール").getAttribute("aria-pressed")).toBe("true");
      act(() => button("スケジュール").click());
      act(() => button("詳細").click());
      expect(button("題名").disabled).toBe(true);
      expect(container.querySelector(".wbs-date-header")).toBeNull();
      expect(stored.panes).toEqual({ title: true, details: false, schedule: false });
      expect(stored.other).toBe(1);
      expect(save).not.toHaveBeenCalled();
      act(() => mounted.unmount());
    }
  });
  it("renders grouped WBS summaries", () => {
    const { context, container, root } = fixture(false, [{ name: "a", title: "A", values: { "field:rank": 3, "field:sprint": "S1" } }]);
    const data = context.rendererData as { tracker: Record<string, unknown> };
    act(() => root.render(createElement(WBSScreen, { context: { ...context, locale: "en", rendererData: { ...data, tracker: { ...data.tracker, summary: [{ field: { id: "rank", label: "Rank", type: "number" }, method: "sum", groupBy: { id: "sprint", type: "text" } }] } } } })));
    expect(container.querySelector('.wbs-summary')?.textContent).toContain("S1: Sum: 3");
    act(() => root.unmount());
  });
  it("summarizes all rows including folded and review groups in live and static views", () => {
    for (const isStatic of [false, true]) for (const locale of ["ja", "en"]) {
      const { context, container, root } = fixture(isStatic, [
        { name: "root", title: "Root", values: { "field:rank": 1 } },
        { name: "child", title: "Child", values: { "field:parent": "root", "field:rank": 2 } },
        { name: "orphan", title: "Orphan", values: { "field:parent": "missing", "field:rank": 3 } },
        { name: "a", title: "A", values: { "field:parent": "b", "field:rank": 4 } },
        { name: "b", title: "B", values: { "field:parent": "a", "field:rank": "bad" } }
      ]);
      expect(container.querySelector('.wbs-summary')).toBeNull();
      const data = context.rendererData as { tracker: Record<string, unknown> };
      act(() => root.render(createElement(WBSScreen, { context: { ...context, locale,
        rendererData: { ...data, tracker: { ...data.tracker, summary: [{ field: { id: "rank", label: "Rank", type: "number" }, method: "sum" }] } }
      } })));
      const summary = container.querySelector('.wbs-summary')!;
      expect(summary.textContent).toContain(locale === "ja" ? "Rank 合計: 10 (値の形式が合わないため集計から除外: 1)" : "Rank Sum: 10 (Invalid values excluded: 1)");
      act(() => container.querySelector<HTMLButtonElement>(`[aria-label="Root: ${locale === "ja" ? "展開・折りたたみ" : "Toggle children"}"]`)!.click());
      expect(container.querySelector('[data-ticket-name="child"]')).toBeNull();
      expect(summary.textContent).toContain(locale === "ja" ? "合計: 10" : "Sum: 10");
      act(() => root.unmount());
    }
  });
  it("projects only valid raw status symbols through rendererData for list and static views", () => {
    for (const isStatic of [false, true]) {
      const descriptor = wbsView({ locale: "ja", isStatic, records: () => [], target: {
        name: "project", kind: "TicketTracker", title: "計画", relativePath: "tracker.yaml", readOnly: false,
        spec: { statuses: [{ id: "doing", symbol: "★" }, { id: "todo" }, { id: "bad", symbol: 12 },
          { id: "empty", symbol: " " }, null, "invalid"] }
      } });
      expect(descriptor.rendererData?.statusSymbols).toEqual({ doing: "★" });
    }
  });
  it("distinguishes all schedule exceptions, keeps undated rows, and uses Tracker symbols", () => {
    const { context, container, root } = fixture(false, [
      { name: "anchor", title: "Anchor", values: { "field:start": "2026-08-17", "field:due": "2026-08-20" } },
      { name: "cross", title: "Cross", values: { "field:start": "2026-07-27", "field:due": "2026-10-02" } },
      { name: "before", title: "Before", values: { "field:start": "2026-06-01", "field:due": "2026-06-02" } },
      { name: "after", title: "After", values: { "field:start": "2027-01-01", "field:due": "2027-01-02" } },
      { name: "start", title: "Start", values: { "field:start": "2026-08-31", status: "doing" } },
      { name: "end", title: "End", values: { "field:due": "2026-09-04", status: "done" } },
      { name: "invalid", title: "Invalid", values: { "field:start": "2026-08-20", "field:due": "2026-08-14" } },
      { name: "none", title: "None", values: {} }
    ]);
    const rendererData = context.rendererData as { tracker: Record<string, unknown> };
    act(() => root.render(createElement(WBSScreen, { context: { ...context,
      rendererData: { ...rendererData, statusSymbols: { doing: "★" }, tracker: { ...rendererData.tracker, statuses: [
        { id: "doing", label: "作業中", category: "open" }, { id: "done", label: "完了", category: "closed" }
      ] } }
    } })));
    const range = container.querySelector<HTMLSelectElement>('select[aria-label="範囲"]')!;
    act(() => { range.value = "custom"; range.dispatchEvent(new Event("change", { bubbles: true })); });
    const setDate = (name: string, value: string) => act(() => {
      const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    setDate("表示終了", "2026-09-20"); setDate("表示開始", "2026-08-17");
    expect(container.querySelector('[data-ticket-name="cross"] [data-before][data-after]')).not.toBeNull();
    expect(container.querySelector('[data-ticket-name="cross"]')?.textContent).toContain("◀ 07-27");
    expect(container.querySelector('[data-ticket-name="cross"]')?.textContent).toContain("10-02 ▶");
    for (const [name, kind, text] of [
      ["before", "outside-before", "◀ 表示期間より前"], ["after", "outside-after", "表示期間より後"],
      ["start", "start-only", "開始 08-31・終了日なし"], ["end", "end-only", "開始日なし・終了 09-04"],
      ["invalid", "invalid", "△ 終了日が開始日より前です"], ["none", "none", "— 日程なし"]
    ]) {
      const row = container.querySelector(`[data-ticket-name="${name}"]`)!;
      expect(row.querySelector(`[data-schedule="${kind}"]`)).not.toBeNull();
      expect(row.textContent).toContain(text);
    }
    expect(container.querySelector('[data-ticket-name="start"] .wbs-status')?.textContent).toBe("★ 作業中");
    expect(container.querySelector('[data-ticket-name="end"] .wbs-status')?.textContent).toBe("✓ 完了");
    expect(container.querySelector('[data-ticket-name="end"] [data-closed]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/·\s*\d+%/);
    act(() => root.unmount());
  });

  it("places only index rows into two counted review groups, hiding diagnostic details in static output", () => {
    for (const isStatic of [false, true]) {
      const { container, root } = fixture(isStatic, [
        { name: "ok", title: "OK", values: {} },
        { name: "orphan", title: "Orphan", values: { "field:parent": "missing-name" } },
        { name: "a", title: "A", values: { "field:parent": "b" } },
        { name: "b", title: "B", values: { "field:parent": "a" } }
      ]);
      expect([...container.querySelectorAll('[data-ticket-name]')].map((row) => row.getAttribute("data-ticket-name"))).toEqual(["ok", "orphan", "a", "b"]);
      expect([...container.querySelectorAll('.wbs-review-heading > :first-child')].map((row) => row.textContent)).toEqual([
        "△ 親が見つからないチケット（1）", "△ 親子が循環しているチケット（2）"
      ]);
      expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toContain("△ 要確認 3件");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).not.toContain("読み込めないチケット");
      if (isStatic) {
        expect(container.textContent).not.toContain("missing-name");
        const menu = openMenu(container, "a");
        expect(menu.textContent).toBe("詳細");
      } else expect(container.textContent).toContain("親 missing-name が見つかりません");
      act(() => root.unmount());
    }
  });
  it("moves from the row menu with a single write, disables edges, and restores after conflict", async () => {
    const { container, root, save } = fixture(false, [
      { name: "a", title: "A", values: { "field:rank": 1 } },
      { name: "b", title: "B", values: { "field:rank": 2 } },
      { name: "c", title: "C", values: { "field:rank": 3 } }
    ]);
    let menu = openMenu(container, "a");
    expect([...menu.querySelectorAll("button")].find((button) => button.textContent === "上へ")?.disabled).toBe(true);
    await act(async () => { clickText(menu, "下へ"); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]).toEqual([[{ path: ["fields", "rank"], value: 2.5 }], { targetName: "a" }]);
    expect([...container.querySelectorAll("[data-ticket-name]")].map((row) => row.getAttribute("data-ticket-name"))).toEqual(["b", "a", "c"]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("2番目 / 3件");
    menu = openMenu(container, "a");
    save.mockImplementationOnce(async () => ({ ok: false, reason: "conflict", message: "conflict" }));
    await act(async () => { clickText(menu, "上へ"); });
    expect([...container.querySelectorAll("[data-ticket-name]")].map((row) => row.getAttribute("data-ticket-name"))).toEqual(["b", "a", "c"]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("他で変更されました");
    menu = openMenu(container, "c");
    expect([...menu.querySelectorAll("button")].find((button) => button.textContent === "下へ")?.disabled).toBe(true);
    act(() => root.unmount());
  });
  it("omits repeated review diagnostics in English while retaining row details and the count button", () => {
    const { context, container, root } = fixture(false, [
      { name: "orphan", title: "Orphan", values: { "field:parent": "missing-name" } }
    ]);
    act(() => root.render(createElement(WBSScreen, { context: { ...context, locale: "en" } })));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Check WBS definition");
    expect(container.textContent).not.toContain("Check the parent reference. Reordering and adding children are unavailable.");
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toContain("△ Needs attention: 1");
    expect(container.querySelector('[data-ticket-name="orphan"] .wbs-review-note')?.textContent).toContain("Parent missing-name not found");
    act(() => root.unmount());
  });

  it("indents and outdents a row with one write and rolls back conflicts", async () => {
    const { container, root, save } = fixture(false, [
      { name: "a", title: "A", values: { "field:rank": 1 } },
      { name: "b", title: "B", values: { "field:rank": 2 } },
      { name: "c", title: "C", values: { "field:rank": 3 } }
    ]);
    let menu = openMenu(container, "b");
    expect([...menu.querySelectorAll("button")].find((button) => button.textContent === "字下げ")?.disabled).toBe(false);
    expect([...menu.querySelectorAll("button")].find((button) => button.textContent === "字上げ")?.disabled).toBe(true);
    await act(async () => clickText(menu, "字下げ"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]).toEqual([[{ path: ["fields", "parent"], value: "a" }, { path: ["fields", "rank"], value: 1 }], { targetName: "b" }]);
    expect(container.querySelector('[data-ticket-name="b"]')?.getAttribute("aria-level")).toBe("2");

    menu = openMenu(container, "b");
    expect([...menu.querySelectorAll("button")].find((button) => button.textContent === "字下げ")?.disabled).toBe(true);
    expect([...menu.querySelectorAll("button")].find((button) => button.textContent === "字上げ")?.disabled).toBe(false);
    await act(async () => clickText(menu, "字上げ"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([[{ path: ["fields", "parent"], value: null }, { path: ["fields", "rank"], value: 2 }], { targetName: "b" }]);
    expect([...container.querySelectorAll("[data-ticket-name]")].map((row) => row.getAttribute("data-ticket-name"))).toEqual(["a", "b", "c"]);
    expect(container.querySelector('[data-ticket-name="b"]')?.getAttribute("aria-level")).toBe("1");

    menu = openMenu(container, "c");
    save.mockImplementationOnce(async () => ({ ok: false, reason: "conflict", message: "conflict" }));
    await act(async () => clickText(menu, "字下げ"));
    expect(container.querySelector('[data-ticket-name="c"]')?.getAttribute("aria-level")).toBe("1");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("他で変更されました");
    act(() => root.unmount());
  });

  it("maps Tab and Shift+Tab on a title to indent and outdent, not quick-add input", async () => {
    const { context, container, root, save } = fixture(false, [
      { name: "a", title: "A", values: { "field:rank": 1 } },
      { name: "b", title: "B", values: { "field:rank": 2 } }
    ]);
    const title = container.querySelector<HTMLButtonElement>('[data-ticket-name="b"] .wbs-title')!;
    title.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => { title.dispatchEvent(tab); });
    expect(tab.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "parent"], value: "a" }, { path: ["fields", "rank"], value: 1 }], { targetName: "b" });

    const nestedTitle = container.querySelector<HTMLButtonElement>('[data-ticket-name="b"] .wbs-title')!;
    nestedTitle.focus();
    const shiftTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => { nestedTitle.dispatchEvent(shiftTab); });
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(save).toHaveBeenLastCalledWith([{ path: ["fields", "parent"], value: null }, { path: ["fields", "rank"], value: 2 }], { targetName: "b" });

    const createResourceNow = vi.fn(async () => ({ ok: true as const, name: "new" }));
    act(() => root.render(createElement(WBSScreen, { context: { ...context, createResourceNow } })));
    act(() => clickText(container, "＋ 追加"));
    const input = container.querySelector<HTMLInputElement>('[aria-label="新しいチケットの題名"]')!;
    const inputTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(inputTab); });
    expect(inputTab.defaultPrevented).toBe(false);
    expect(createResourceNow).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("saves only the parent when indenting without a Tracker order field", async () => {
    const { context, container, root, save } = fixture(false, [
      { name: "a", title: "A", values: {} },
      { name: "b", title: "B", values: {} }
    ]);
    const data = context.rendererData as WBSRendererData;
    act(() => root.render(createElement(WBSScreen, { context: {
      ...context, rendererData: { ...data, orderField: undefined }
    } })));
    const menu = openMenu(container, "b");
    await act(async () => clickText(menu, "字下げ"));
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "parent"], value: "a" }], { targetName: "b" });
    expect(container.querySelector('[data-ticket-name="b"]')?.getAttribute("aria-level")).toBe("2");
    act(() => root.unmount());
  });

  it("appends a reparented ticket with one save and opens its folded destination", async () => {
    const { container, root, save } = fixture(false, [
      { name: "a", title: "A", values: { "field:rank": 1 } },
      { name: "b", title: "B", values: { "field:rank": 2 } },
      { name: "child", title: "Child", values: { "field:parent": "b", "field:rank": 10 } }
    ]);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="B: 展開・折りたたみ"]')!.click());
    editParent(container, "a");
    const select = container.querySelector<HTMLSelectElement>('[data-ticket-name="a"] select')!;
    expect([...select.options].map((option) => option.value)).not.toContain("a");
    await act(async () => { select.value = "b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]).toEqual([[{ path: ["fields", "parent"], value: "b" }, { path: ["fields", "rank"], value: 11 }], { targetName: "a" }]);
    expect(container.querySelector('[data-ticket-name="b"]')?.getAttribute("aria-expanded")).toBe("true");
    expect([...container.querySelectorAll("[data-ticket-name]")].map((row) => row.getAttribute("data-ticket-name"))).toEqual(["b", "child", "a"]);
    act(() => root.unmount());
  });

  it("restricts unresolved/cyclic rows and excludes original-graph descendants", () => {
    const { container, root } = fixture(false, [
      { name: "a", title: "A", values: { "field:parent": "b" } },
      { name: "b", title: "B", values: { "field:parent": "a" } },
      { name: "c", title: "C", values: { "field:parent": "b" } },
      { name: "ok", title: "OK", values: {} }
    ]);
    const menu = openMenu(container, "a");
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["詳細", "親を変更…", "親を空にして最上位へ"]);
    expect(container.querySelector('[data-ticket-name="a"] [draggable]')).toBeNull();
    act(() => clickText(menu, "親を変更…"));
    expect([...container.querySelectorAll<HTMLSelectElement>('[data-ticket-name="a"] select option')].map((option) => option.value)).toEqual(["", "ok"]);
    expect(container.querySelector('[data-ticket-name="a"] .wbs-review-note')?.textContent).toContain("△ a → b → a");
    expect(container.textContent).not.toContain("親の参照を確認してください。並び替えと子の追加はできません。");
    act(() => root.unmount());
  });

  it("does not save a parent change that cannot append after missing destination ranks", async () => {
    const { container, root, save } = fixture(false, [
      { name: "a", title: "A", values: {} },
      { name: "b", title: "B", values: {} },
      { name: "child", title: "Child", values: { "field:parent": "b" } }
    ]);
    editParent(container, "a");
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[data-ticket-name="a"] select')!;
      select.value = "b"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("並び順を付け直してください");
    act(() => root.unmount());
  });

  it("shows details only for a read-only target and for static output", () => {
    for (const isStatic of [false, true]) {
      const { context, container, root } = fixture(isStatic);
      act(() => root.render(createElement(WBSScreen, { context: {
        ...context, target: { ...context.target!, readOnly: true }
      } })));
      const menu = openMenu(container, "root");
      expect([...menu.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["詳細"]);
      expect(container.querySelector("[draggable]")).toBeNull();
      expect(container.querySelector("summary")).toBeNull();
      act(() => root.unmount());
    }
  });

  it("keeps roots and unresolved children, navigates, and writes the selected child's parent", async () => {
    const { container, root, save, openResource } = fixture();
    expect(container.querySelector('[data-ticket-name="orphan"] .wbs-review-note')?.textContent).toContain("親 missing が見つかりません");
    expect(container.querySelector('[data-ticket-name="child"]')?.textContent).toContain("— 日程なし");
    expect(container.querySelector('[data-ticket-name="child"]')?.getAttribute("aria-level")).toBe("2");
    for (const row of container.querySelectorAll('[data-ticket-name]')) {
      expect(row.getAttribute("role")).toBe("row");
      expect(row.querySelector(".wbs-title")).not.toBeNull();
      expect(row.querySelector(".wbs-timeline-cell")).not.toBeNull();
      expect(row.querySelectorAll('[data-ticket-name]')).toHaveLength(0);
    }
    const child = container.querySelector<HTMLElement>('[data-ticket-name="child"]')!;
    await act(async () => [...child.querySelectorAll("button")]
      .find((button) => button.textContent === "子")!.click());
    expect(openResource).toHaveBeenCalledWith("child");
    expect(child.querySelector("select")).toBeNull();
    editParent(container, "child");
    await act(async () => {
      const select = child.querySelector("select")!;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "parent"], value: null },
      { path: ["fields", "rank"], value: 2 }], { targetName: "child" });
    expect(container.querySelector('[data-ticket-name="child"]')?.getAttribute("aria-level")).toBe("1");
    act(() => root.unmount());
  });

  it("leaves the existing hierarchy untouched on a conflicting save", async () => {
    const { container, root, save } = fixture();
    save.mockImplementationOnce(async () => ({ ok: false as const, reason: "conflict" as const, message: "conflict" }));
    editParent(container, "child");
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[data-ticket-name="child"] select')!;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector('[data-ticket-name="child"]')?.getAttribute("aria-level")).toBe("2");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("他で変更されました");
    act(() => root.unmount());
  });

  it("omits diagnostics and all editing controls in static output", () => {
    const { container, root } = fixture(true);
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector('[data-ticket-name] select')).toBeNull();
    expect(container.textContent).not.toContain("並び順を付け直す");
    expect(container.textContent).toContain("孤児");
    expect(container.querySelector('[aria-label="日程表"]')).not.toBeNull();
    expect(container.querySelector('[data-ticket-name="root"] [aria-label="2026-10-01 – "]')).not.toBeNull();
    expect(container.textContent).not.toContain("子チケットを追加");
    act(() => root.unmount());
  });

  it("automatically windows above 300 displayed rows, ignoring saved rendering preferences", () => {
    const { context, container, root } = fixture();
    for (const [count, saved] of [[300, "virtual"], [301, "all"], [301, "incremental"]] as const) {
      const next = { ...context, getViewSettings: () => ({ strategy: saved }), rows: Array.from({ length: count }, (_, index) => ({
        name: `item-${index}`, title: `項目 ${index}`, values: {}
      })) };
      act(() => root.render(createElement(WBSScreen, { context: next })));
      const rendered = container.querySelectorAll('[data-ticket-name]').length;
      if (count === 300) expect(rendered).toBe(300);
      else expect(rendered).toBeLessThan(301);
      expect(container.querySelector('select[aria-label="描き方"]')).toBeNull();
      expect(container.textContent).not.toContain("続きを読み込む");
      expect(container.textContent).toContain(`チケット: ${count}`);
    }
    act(() => root.unmount());
  });

  it.each([5, 301])("scrolls to the review heading with %i tasks", (count) => {
    const { container, root } = fixture(false, [
      ...Array.from({ length: count }, (_, i) => ({ name: `task-${i}`, title: `Task ${i}`, values: {} })),
      { name: "orphan", title: "Orphan", values: { "field:parent": "missing" } }
    ]);
    if (count > 300) expect(container.querySelector('.wbs-review-heading')).toBeNull();
    act(() => clickText(container, "△ 要確認 1件"));
    expect(container.querySelector<HTMLElement>('.wbs-scroll')!.scrollTop).toBe(count * 36);
    expect(container.querySelector('.wbs-review-heading')?.textContent).toContain("△ 親が見つからないチケット（1）");
    expect(container.querySelector('[data-ticket-name="orphan"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("keeps a collapsed parent's own timeline and restores personal settings after remount", () => {
    const { context, container, root, save } = fixture();
    let stored: unknown = { collapsed: ["deleted"], other: true };
    const setViewSettings = vi.fn((value: unknown) => { stored = value; });
    const next = { ...context, getViewSettings: () => stored, setViewSettings };
    act(() => root.unmount());
    const mounted = createRoot(container);
    act(() => mounted.render(createElement(WBSScreen, { context: next })));
    expect(stored).toEqual({ collapsed: [], other: true });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="親: 展開・折りたたみ"]')!.click());
    expect(stored).toEqual({ collapsed: ["root"], other: true });
    expect(container.querySelector('[data-ticket-name="child"]')).toBeNull();
    expect(container.querySelector('[data-ticket-name="root"] .wbs-track')).not.toBeNull();
    expect(container.textContent).toContain("チケット: 3");
    act(() => mounted.unmount());
    const remounted = createRoot(container);
    act(() => remounted.render(createElement(WBSScreen, { context: next })));
    expect(container.querySelector('[data-ticket-name="child"]')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    act(() => remounted.unmount());
  });

  it("saves WBS field choices to the Tracker without rewriting its other settings", async () => {
    const { container, root, save } = fixture();
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('select[aria-label="終了"]')!;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledWith([{ path: ["wbs", "endField"], value: null }]);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="終了"]')?.value).toBe("");
    act(() => root.unmount());
  });

  it.each([true, false])("quick-adds children in place (ranked=%s)", async (ranked) => {
    const { context, container, root, save } = fixture();
    document.body.append(container);
    const createResourceNow = vi.fn(async (_draft: unknown) => ({ ok: true as const, name: "new" }));
    const next = { ...context, rows: context.rows.map((row) => ranked ? row : { ...row, values: Object.fromEntries(Object.entries(row.values).filter(([id]) => id !== "field:rank")) }), createResourceNow };
    act(() => root.render(createElement(WBSScreen, { context: next })));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="親: 展開・折りたたみ"]')!.click());
    const menu = openMenu(container, "root");
    act(() => clickText(menu, "子チケットを追加"));
    expect(container.querySelector('[data-ticket-name="child"]')).not.toBeNull();
    expect(container.querySelector(".wbs-quick-add")?.previousElementSibling?.getAttribute("data-ticket-name")).toBe("child");
    const input = container.querySelector<HTMLInputElement>('[aria-label="新しいチケットの題名"]')!;
    expect(document.activeElement).toBe(input);
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "追加")?.disabled).toBe(true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New child");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    expect(createResourceNow).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(createResourceNow).toHaveBeenCalledWith(expect.objectContaining({ title: "New child",
      spec: expect.objectContaining({ fields: expect.objectContaining({ parent: "root", ...(ranked ? { rank: 3 } : {}) }) }) }));
    const draft = createResourceNow.mock.calls[0]![0] as { spec: { fields: Record<string, unknown> } };
    expect(draft.spec.fields.rank).toBe(ranked ? 3 : undefined);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(save).not.toHaveBeenCalled();
    act(() => clickText(container, "取り消し"));
    expect(container.querySelector(".wbs-quick-add")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("retains failed root input, retries without an order field, and does not navigate", async () => {
    const { context, container, root, openResource, save } = fixture();
    const createResourceNow = vi.fn<NonNullable<PluginRenderContext["createResourceNow"]>>()
      .mockResolvedValueOnce({ ok: false, reason: "error", message: "Cannot create" })
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ ok: true, name: "new" });
    const data = context.rendererData as WBSRendererData;
    act(() => root.render(createElement(WBSScreen, { context: { ...context, createResourceNow,
      rendererData: { ...data, orderField: undefined } } })));
    act(() => clickText(container, "＋ 追加"));
    const input = container.querySelector<HTMLInputElement>('[aria-label="新しいチケットの題名"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " Root ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => clickText(container, "追加"));
    expect(input.value).toBe(" Root ");
    expect(container.textContent).toContain("Cannot create");
    await act(async () => clickText(container, "追加"));
    expect(input.value).toBe(" Root ");
    expect(container.textContent).toContain("Offline");
    await act(async () => clickText(container, "追加"));
    expect(createResourceNow.mock.lastCall?.[0]).toMatchObject({ title: "Root" });
    expect(createResourceNow.mock.lastCall?.[0].spec.fields).not.toHaveProperty("rank");
    expect(createResourceNow.mock.lastCall?.[0].spec.fields).not.toHaveProperty("parent");
    expect(input.value).toBe("");
    expect(save).not.toHaveBeenCalled();
    expect(openResource).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("windows the add row, opens a folded parent's children and keeps focus after indexed creation", async () => {
    const { context, container, root } = fixture(false, [
      { name: "parent", title: "A parent", values: { "field:rank": 1 } },
      ...Array.from({ length: 350 }, (_, i) => ({ name: `child-${i}`, title: `Child ${i}`,
        values: { "field:parent": "parent", "field:rank": i + 1 } }))
    ]);
    document.body.append(container);
    const createResourceNow = vi.fn(async () => ({ ok: true as const, name: "new" }));
    let next = { ...context, createResourceNow };
    act(() => root.render(createElement(WBSScreen, { context: next })));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="A parent: 展開・折りたたみ"]')!.click());
    const menu = openMenu(container, "parent");
    act(() => clickText(menu, "子チケットを追加"));
    const input = container.querySelector<HTMLInputElement>('[aria-label="新しいチケットの題名"]')!;
    expect(input).not.toBeNull();
    expect(container.querySelector<HTMLElement>(".wbs-scroll")!.scrollTop).toBeGreaterThan(0);
    expect(document.activeElement).toBe(input);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Next");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => clickText(container, "追加"));
    next = { ...next, rows: [...next.rows, { name: "new", title: "Next", values: { "field:parent": "parent", "field:rank": 351 } }] };
    act(() => root.render(createElement(WBSScreen, { context: next })));
    expect(container.querySelector(".wbs-quick-add")?.previousElementSibling?.getAttribute("data-ticket-name")).toBe("new");
    expect(document.activeElement).toBe(container.querySelector('[aria-label="新しいチケットの題名"]'));
    act(() => root.unmount());
    container.remove();
  });

  it("hides quick add without immediate creation support, in static views and on read-only targets", () => {
    const { context, container, root } = fixture();
    for (const next of [context, { ...context, isStatic: true, createResourceNow: vi.fn() },
      { ...context, target: { ...context.target!, readOnly: true }, createResourceNow: vi.fn() }]) {
      act(() => root.render(createElement(WBSScreen, { context: next })));
      expect(container.textContent).not.toContain("＋ 追加");
      const menu = container.querySelector<HTMLElement>(".wbs-row-menu") ?? openMenu(container, "root");
      expect(menu.textContent).not.toContain("子チケットを追加");
    }
    act(() => root.unmount());
  });

  it("keeps a drag handle and persists just the dropped row", async () => {
    const { container, root, save } = fixture(false, [
      { name: "root", title: "親", values: { "field:rank": 1 } },
      { name: "peer", title: "同階層", values: { "field:rank": 3 } }
    ]);
    expect(container.querySelector('button[aria-label="親: 上へ"]')).toBeNull();
    const grip = container.querySelector<HTMLButtonElement>('button[aria-label="同階層: ドラッグして順序を変更"]')!;
    expect(grip.draggable).toBe(true);
    const transfer = { name: "", setData(_type: string, value: string) { this.name = value; },
      getData() { return this.name; } };
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: transfer });
    act(() => grip.dispatchEvent(dragStart));
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: transfer });
    await act(async () => {
      container.querySelector('[data-ticket-name="root"] > div')!.dispatchEvent(drop);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "rank"], value: 0 }], { targetName: "peer" });
    act(() => root.unmount());
  });

  it("switches scales without changing the range, and applies calendar presets", () => {
    const { container, root } = fixture(false, [
      { name: "first", title: "First", values: { "field:start": "2026-10-01" } },
      { name: "last", title: "Last", values: { "field:start": "2026-12-01" } }
    ]);
    const scale = container.querySelector<HTMLSelectElement>('select[aria-label="目盛り"]')!;
    expect(scale.value).toBe("week");
    expect(container.querySelector('[data-ticket-name="last"]')?.textContent).not.toContain("範囲外");
    act(() => {
      scale.value = "day";
      scale.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelectorAll('.wbs-tick-tier > span')).toHaveLength(92);
    const range = container.querySelector<HTMLSelectElement>('select[aria-label="範囲"]')!;
    for (const [preset, mode, ticks, first] of [
      ["2w", "day", 14, "2026-09-28"], ["1m", "day", 30, "2026-09-01"],
      ["3m", "week", 13, "2026-09-01"], ["6m", "week", 26, "2026-09-01"]
    ] as const) {
      act(() => { range.value = preset; range.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(scale.value).toBe(mode);
      expect(container.querySelectorAll('.wbs-tick-tier > span')).toHaveLength(ticks);
      expect(container.querySelector('.wbs-tick-tier > span')?.getAttribute("title")).toBe(first);
    }
    act(() => { range.value = "2w"; range.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector('[data-ticket-name="last"]')?.textContent).toContain("表示期間より後");
    act(() => container.querySelector<HTMLButtonElement>('[data-ticket-name="last"] .wbs-track button')!.click());
    expect(container.querySelector('[data-ticket-name="last"] [data-schedule="start-only"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
