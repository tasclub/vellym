// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginListViewDescriptor } from "@vellym/plugin-api";
import {
  PluginListView,
  type PluginViewPayload
} from "../packages/ui-react/src/plugin/plugin-list-view.js";
import { pluginViewSettingsKey } from "../packages/ui-react/src/plugin/view-settings.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const scope = {
  projectRoot: "/projects/example",
  pluginId: "tickets",
  viewId: "ticket-list",
  targetName: "tracker"
};

const descriptor: PluginListViewDescriptor = {
  type: "list",
  id: "ticket-list",
  kind: "Ticket",
  title: { ja: "チケット一覧", en: "Tickets" },
  columns: [{
    id: "priority",
    label: { ja: "優先度", en: "Priority" },
    filterable: true,
    options: [
      { value: "high", label: { ja: "高", en: "High" } },
      { value: "low", label: { ja: "低", en: "Low" } }
    ]
  }],
  defaultFilters: [{
    columnId: "status",
    operator: "not-in",
    value: ["done"],
    toggleLabels: {
      applied: { ja: "未完了のみ", en: "Open only" },
      cleared: { ja: "完了を含める", en: "Include done" }
    }
  }]
};

const payload: PluginViewPayload = {
  pluginId: "tickets",
  viewId: "ticket-list",
  descriptor,
  rows: [
    { name: "a", title: "A", relativePath: "a.yaml", values: { priority: "high" } },
    { name: "b", title: "B", relativePath: "b.yaml", values: { priority: "low" } }
  ],
  allRows: [
    { name: "a", title: "A", relativePath: "a.yaml", values: { priority: "high" } },
    { name: "b", title: "B", relativePath: "b.yaml", values: { priority: "low" } }
  ],
  commands: []
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  window.localStorage.clear();
});

/**
 * テキスト入力へ値を設定してonChangeを発火させる。
 * Reactは入力要素に値のトラッカーを付けていて、`.value`へ直接代入すると
 * 「値が変わっていない」と判定されてonChangeが抑止される。原生のsetterで
 * トラッカーを迂回し、inputイベントをたてる（selectのchangeとは別イベント）。
 */
function setInputValue(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setValue) throw new Error("HTMLInputElementのvalue setterが見つかりません");
  setValue.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(PluginListView, {
    payload,
    projectRoot: scope.projectRoot,
    targetName: scope.targetName,
    locale: "ja",
    showAll: false,
    onToggleShowAll: () => undefined
  })));
  return container;
}

describe("plugin list filters", () => {
  it("summarizes all filtered rows and reports invalid values", () => {
    const rows = Array.from({ length: 105 }, (_, i) => ({
      name: String(i), title: String(i), relativePath: `${i}.yaml`,
      values: { priority: i < 2 ? "high" : "low", amount: i === 0 ? "invalid" : 1 }
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(createElement(PluginListView, {
      payload: { ...payload, rows, allRows: rows, descriptor: { ...descriptor,
        summary: [{ valueKey: "amount", type: "number", method: "sum", label: { ja: "見積", en: "Estimate" } }] } },
      projectRoot: scope.projectRoot, targetName: scope.targetName, locale: "en"
    })));
    expect(container.textContent).toContain("Estimate Sum: 104");
    expect(container.textContent).toContain("Invalid values excluded: 1");
    const priority = container.querySelector<HTMLSelectElement>("#plugin-filter-priority")!;
    act(() => { priority.value = "high"; priority.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).toContain("Estimate Sum: 1");
    expect(container.textContent).toContain("Invalid values excluded: 1");
  });
  it("starts collapsed while keeping the default toggle and active count visible", () => {
    const view = mount();
    expect(view.querySelector("section[aria-live]")).toBeNull();
    const filtersButton = view.querySelector<HTMLButtonElement>("button[aria-controls]")!;
    const defaultToggle = [...view.querySelectorAll("button")]
      .find((button) => button.textContent === "未完了のみ");
    const controls = view.querySelector<HTMLDivElement>("#plugin-list-filter-controls")!;

    expect(filtersButton.textContent).toContain("有効 1件");
    expect(filtersButton.getAttribute("aria-expanded")).toBe("false");
    expect(controls.hidden).toBe(true);
    expect(defaultToggle).toBeDefined();
  });

  it("opens the filter controls and persists the disclosure preference", () => {
    const view = mount();
    const filtersButton = view.querySelector<HTMLButtonElement>("button[aria-controls]")!;

    act(() => filtersButton.click());
    const priority = view.querySelector<HTMLSelectElement>("#plugin-filter-priority")!;
    act(() => {
      priority.value = "high";
      priority.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => filtersButton.click());

    expect(filtersButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.querySelector<HTMLDivElement>("#plugin-list-filter-controls")!.hidden).toBe(true);
    expect(filtersButton.textContent).toContain("有効 2件");
    expect(view.textContent).toContain("1件（全2件中）");
    expect([...view.querySelectorAll("button")].some((button) => button.textContent === "未完了のみ"))
      .toBe(true);
    expect(JSON.parse(window.localStorage.getItem(pluginViewSettingsKey(scope))!))
      .toMatchObject({ filtersExpanded: false, filters: { priority: "high" } });

    act(() => root!.unmount());
    root = undefined;
    const restored = mount();
    expect(restored.querySelector<HTMLButtonElement>("button[aria-controls]")?.textContent)
      .toContain("有効 2件");
    expect(restored.querySelector<HTMLSelectElement>("#plugin-filter-priority")?.value).toBe("high");
  });

  it("does not render a filter band when the view has no filterable columns", () => {
    const noFilters: PluginViewPayload = {
      ...payload,
      descriptor: { ...descriptor, columns: [{ id: "title", label: "Title" }], defaultFilters: [] }
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(createElement(PluginListView, {
      payload: noFilters,
      projectRoot: scope.projectRoot,
      targetName: scope.targetName,
      locale: "en"
    })));
    expect(container.querySelector(".plugin-list-filters")).toBeNull();
  });
});

describe("hidden columns and the sort selector", () => {
  const sortDescriptor: PluginListViewDescriptor = {
    type: "list",
    id: "ticket-list",
    kind: "Ticket",
    title: { ja: "チケット一覧", en: "Tickets" },
    columns: [
      { id: "title", label: { ja: "タイトル", en: "Title" }, sortable: true },
      // 表には出さず、並べ替えにだけ使う列
      { id: "estimate", label: { ja: "見積", en: "Estimate" }, type: "number", hidden: true, sortable: true },
      // 表には出さず、絞り込みにだけ使う列
      { id: "sprint", label: { ja: "スプリント", en: "Sprint" }, type: "text", hidden: true, filterable: true },
      // 行内の副次情報としても隠す
      { id: "labels", label: { ja: "ラベル", en: "Labels" }, type: "multiselect", secondary: true, hidden: true, filterable: true }
    ],
    defaultSort: { columnId: "estimate", direction: "asc" }
  };

  const sortPayload: PluginViewPayload = {
    pluginId: "tickets",
    viewId: "ticket-list",
    descriptor: sortDescriptor,
    rows: [
      { name: "a", title: "A", relativePath: "a.yaml", values: { estimate: 2, sprint: "S1", labels: ["urgent"] } },
      { name: "b", title: "B", relativePath: "b.yaml", values: { estimate: 1, sprint: "S2", labels: ["docs"] } }
    ],
    allRows: [],
    commands: []
  };

  function mountSort(): HTMLDivElement {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(createElement(PluginListView, {
      payload: sortPayload,
      projectRoot: scope.projectRoot,
      targetName: scope.targetName,
      locale: "ja"
    })));
    return container;
  }

  const visibleTitles = () => [...document.querySelectorAll("tbody tr")]
    .map((row) => row.querySelector("button")?.textContent ?? "");

  it("keeps hidden columns out of the table while still filtering by them", () => {
    const view = mountSort();
    // 既定の並べ替え（見積 昇順）が適用され、隠れた列は表に出ない
    expect(visibleTitles()).toEqual(["B", "A"]);
    const headers = [...view.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["タイトル"]);
    // 副次情報としても隠れている
    expect(view.textContent).not.toContain("urgent");
    // 隠れていても絞り込みの対象。入力して絞り込める
    const controls = view.querySelector<HTMLButtonElement>("button[aria-controls]")!;
    act(() => controls.click());
    const sprint = view.querySelector<HTMLInputElement>("#plugin-filter-sprint")!;
    act(() => {
      setInputValue(sprint, "S2");
    });
    expect(visibleTitles()).toEqual(["B"]);
  });

  it("offers sortable columns (hidden included) in the sort selector and shares state with the header", () => {
    const view = mountSort();
    act(() => view.querySelector<HTMLButtonElement>("button[aria-controls]")!.click());
    const sortSelect = view.querySelector<HTMLSelectElement>('select[aria-label="並べ替え"]')!;
    const optionValues = [...sortSelect.options].map((option) => option.value);
    expect(optionValues).toEqual(["title", "estimate"]);
    expect(sortSelect.value).toBe("estimate");

    // 選択をタイトルへ変えると、見出しの並び順表示も同じ状態を指す
    act(() => {
      sortSelect.value = "title";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.querySelector("thead th[aria-sort='ascending']")?.textContent).toContain("タイトル");
    expect(visibleTitles()).toEqual(["A", "B"]);

    // 昇降の切り替え。見出しクリックと同じ並び順を変える
    const desc = [...view.querySelectorAll("button")].find((button) => button.textContent === "降順")!;
    act(() => desc.click());
    expect(view.querySelector("thead th[aria-sort='descending']")).not.toBeNull();
    expect(visibleTitles()).toEqual(["B", "A"]);
    // 個人設定へ並べ替えが保存される（次回開いたときにもう一度使える）
    expect(JSON.parse(window.localStorage.getItem(pluginViewSettingsKey(scope))!))
      .toMatchObject({ sort: { columnId: "title", direction: "desc" } });

    // 降順の途中で列を替えても、見出しクリックと同じく昇順から始める
    act(() => {
      sortSelect.value = "estimate";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(visibleTitles()).toEqual(["B", "A"]);
    expect(desc.getAttribute("aria-pressed")).toBe("false");

    // 見出しクリックも同じ状態を指す（選択側の値と昇降表示が切り替わる）
    act(() => {
      sortSelect.value = "title";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.querySelector("thead th[aria-sort='ascending']")).not.toBeNull();
    act(() => view.querySelector<HTMLButtonElement>("thead th button")!.click());
    expect(sortSelect.value).toBe("title");
    expect(view.querySelector("thead th[aria-sort='descending']")).not.toBeNull();
    expect(desc.getAttribute("aria-pressed")).toBe("true");
  });
});
