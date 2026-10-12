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

describe("WBS screen", () => {
  it("keeps roots and unresolved children, navigates, and writes the selected child's parent", async () => {
    const { container, root, save, openResource } = fixture();
    expect(container.textContent).toContain("親チケットが見つかりません");
    expect(container.querySelector('[data-ticket-name="child"]')?.textContent).toContain("なし – なし");
    expect(container.querySelector('[data-ticket-name="root"] [data-wbs-level="1"]')?.textContent).toContain("子");
    const child = container.querySelector<HTMLElement>('[data-ticket-name="child"]')!;
    await act(async () => [...child.querySelectorAll("button")]
      .find((button) => button.textContent === "子")!.click());
    expect(openResource).toHaveBeenCalledWith("child");
    expect(child.querySelector("select")).toBeNull();
    act(() => child.querySelector<HTMLButtonElement>('[aria-label="子: 親を変更"]')!.click());
    await act(async () => {
      const select = child.querySelector("select")!;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "parent"], value: null }], { targetName: "child" });
    expect(container.querySelector('[data-ticket-name="child"] [data-wbs-level="1"]')).toBeNull();
    act(() => root.unmount());
  });

  it("leaves the existing hierarchy untouched on a conflicting save", async () => {
    const { container, root, save } = fixture();
    save.mockImplementationOnce(async () => ({ ok: false as const, reason: "conflict" as const, message: "conflict" }));
    act(() => container.querySelector<HTMLButtonElement>('[data-ticket-name="child"] [aria-label="子: 親を変更"]')!.click());
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[data-ticket-name="child"] select')!;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector('[data-ticket-name="root"] [data-ticket-name="child"]')).not.toBeNull();
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

  it("shows the total count and provides the remaining rows on demand", () => {
    const { context, container, root } = fixture();
    const next = { ...context, rows: Array.from({ length: 23 }, (_, index) => ({
      name: `item-${index}`, title: `項目 ${index}`, values: {}
    })) };
    act(() => root.render(createElement(WBSScreen, { context: next })));
    expect(container.querySelectorAll('[data-ticket-name]')).toHaveLength(20);
    expect(container.textContent).toContain("チケット: 23");
    act(() => [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("残り3件"))!.click());
    expect(container.querySelectorAll('[data-ticket-name]')).toHaveLength(23);
    act(() => root.unmount());
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
    expect(container.querySelector('[aria-label="日付タイムライン"]')?.textContent).toContain("10-01");
    const addChild = container.querySelector<HTMLButtonElement>('[data-ticket-name="root"] button[aria-label="親: 子タスクを追加"]')!;
    await act(async () => { addChild.click(); await Promise.resolve(); });
    expect(runCommand).toHaveBeenCalledWith("ticket.create", {
      parent: "root", parentField: "parent"
    });
    expect(save).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("offers a drag handle instead of up/down buttons and persists just the dropped row", async () => {
    const { container, root, save } = fixture();
    expect(container.querySelector('button[aria-label="親: 上へ"]')).toBeNull();
    const grip = container.querySelector<HTMLButtonElement>('button[aria-label="孤児: ドラッグして順序を変更"]')!;
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
    expect(save).toHaveBeenCalledWith([{ path: ["fields", "rank"], value: 0 }], { targetName: "orphan" });
    act(() => root.unmount());
  });

  it("switches daily and weekly scales, caps the range and labels out-of-range tickets", () => {
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
    expect(container.querySelector<HTMLInputElement>('input[aria-label="表示終了"]')?.value).toBe("2026-10-31");
    expect(container.querySelector('[data-ticket-name="last"]')?.textContent).toContain("範囲外 →");
    const labels = [...container.querySelectorAll('[aria-label="日付タイムライン"] > span')];
    expect(labels).toHaveLength(31);
    expect(labels[0]?.getAttribute("style")).toContain("min(");
    act(() => root.unmount());
  });
});
