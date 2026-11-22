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
}));
import { WBSScreen } from "../packages/plugin-wbs/src/screen.js";
import { wbsView } from "../packages/plugin-wbs/src/view.js";

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
      expect(summary.textContent).toContain(locale === "ja" ? "Rank 合計: 10 (型が合わず除外: 1)" : "Rank Sum: 10 (Invalid values excluded: 1)");
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
      ["before", "outside-before", "◀ 範囲より前"], ["after", "outside-after", "範囲より後"],
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
      expect(container.textContent).toContain("△ 要確認 3件");
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
    expect(container.querySelector('[role="rowgroup"][aria-label="△ 親子が循環しているチケット"]')?.textContent).toContain("親の参照を確認");
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
    expect(container.querySelector('[role="status"]')?.textContent).toContain("順序を振り直して");
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
      expect(container.textContent).not.toContain("WBSの設定");
      act(() => root.unmount());
    }
  });

  it("keeps roots and unresolved children, navigates, and writes the selected child's parent", async () => {
    const { container, root, save, openResource } = fixture();
    expect(container.textContent).toContain("親チケットが見つかりません");
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
    expect(container.textContent).not.toContain("順序を振り直す");
    expect(container.textContent).toContain("孤児");
    expect(container.querySelector('[aria-label="日付タイムライン"]')).not.toBeNull();
    expect(container.querySelector('[data-ticket-name="root"] [aria-label="2026-10-01 – "]')).not.toBeNull();
    expect(container.textContent).not.toContain("タスクを追加");
    act(() => root.unmount());
  });

  it("renders all rows by default, and counts all tickets in every strategy", () => {
    const { context, container, root } = fixture();
    const next = { ...context, rows: Array.from({ length: 223 }, (_, index) => ({
      name: `item-${index}`, title: `項目 ${index}`, values: {}
    })) };
    act(() => root.render(createElement(WBSScreen, { context: next })));
    expect(container.querySelectorAll('[data-ticket-name]')).toHaveLength(223);
    const strategy = container.querySelector<HTMLSelectElement>('select[aria-label="描き方"]')!;
    const choose = (value: string) => act(() => {
      strategy.value = value; strategy.dispatchEvent(new Event("change", { bubbles: true }));
    });
    choose("virtual");
    expect(container.textContent).toContain("チケット: 223");
    expect(container.querySelectorAll('[data-ticket-name]').length).toBeLessThan(223);
    choose("incremental");
    expect(container.querySelectorAll('[data-ticket-name]')).toHaveLength(100);
    expect(container.textContent).toContain("チケット: 223");
    act(() => [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "続きを読み込む")!.click());
    expect(container.querySelectorAll('[data-ticket-name]')).toHaveLength(200);
    expect(container.textContent).toContain("チケット: 223");
    choose("all");
    expect(container.querySelectorAll('[data-ticket-name]')).toHaveLength(223);
    act(() => root.unmount());
  });

  it("windows review headings with their rows instead of showing them before unloaded tasks", () => {
    const { container, root } = fixture(false, [
      ...Array.from({ length: 223 }, (_, i) => ({ name: `task-${i}`, title: `Task ${i}`, values: {} })),
      { name: "orphan", title: "Orphan", values: { "field:parent": "missing" } }
    ]);
    const strategy = container.querySelector<HTMLSelectElement>('select[aria-label="描き方"]')!;
    for (const value of ["virtual", "incremental"]) {
      act(() => { strategy.value = value; strategy.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(container.querySelector('.wbs-review-heading')).toBeNull();
      expect(container.textContent).toContain("△ 要確認 1件");
    }
    act(() => clickText(container, "続きを読み込む"));
    expect(container.querySelector('.wbs-review-heading')).toBeNull();
    act(() => clickText(container, "続きを読み込む"));
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

  it("creates a root or child through the host command rather than writing a Ticket directly", async () => {
    const { context, container, root, save } = fixture();
    const runCommand = vi.fn(async () => ({ ok: true as const }));
    act(() => root.render(createElement(WBSScreen, { context: { ...context, runCommand } })));
    expect(container.querySelector('[aria-label="日付タイムライン"] [title="2026-10-01"]')?.textContent).toBe("1");
    const menu = openMenu(container, "root");
    await act(async () => { clickText(menu, "子タスクを追加"); await Promise.resolve(); });
    expect(runCommand).toHaveBeenCalledWith("ticket.create", {
      parent: "root", parentField: "parent"
    });
    expect(save).not.toHaveBeenCalled();
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
    expect(container.querySelector('[data-ticket-name="last"]')?.textContent).toContain("範囲より後");
    act(() => container.querySelector<HTMLButtonElement>('[data-ticket-name="last"] .wbs-track button')!.click());
    expect(container.querySelector('[data-ticket-name="last"] [data-schedule="start-only"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
