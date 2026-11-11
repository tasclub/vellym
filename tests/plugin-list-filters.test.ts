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
