// @vitest-environment jsdom
import { act } from "react";

// Reactへテスト環境であることを伝える。無いとactの警告が出続ける。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginRenderContext, PluginViewRenderer } from "@vellym/plugin-api";
import { PluginRendererView } from "../packages/ui-react/src/plugin/plugin-renderer-view.js";

/**
 * **実DOMで確かめる。**
 *
 * ここをmarkupの検査だけで済ませると何も確かめられない。`mount`は
 * `useEffect`の中で呼ばれるためサーバ描画では走らず、エラー境界も
 * サーバ描画では働かない。実際に、jsdomへ移す前のテストは
 * 「壊れたrendererを渡しても他が残る」を主張しながら、rendererを
 * 一度も呼んでいなかった。
 */
/** rendererへ渡す文脈。保存と索引行を持つ */
function renderContext(
  overrides: Partial<PluginRenderContext> = {}
): PluginRenderContext {
  return {
    locale: "ja",
    isStatic: false,
    records: () => [],
    rows: [],
    save: async () => ({ ok: true }),
    ...overrides
  };
}

const context = renderContext();

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: Parameters<typeof root.render>[0]) {
  act(() => root.render(node));
}

describe("the host drives the mount contract", () => {
  function tracked() {
    const calls: string[] = [];
    const renderer: PluginViewRenderer = {
      mount(element, mountContext) {
        calls.push(`mount:${mountContext.locale}`);
        element.append(document.createTextNode(`drawn ${mountContext.locale}`));
        return {
          update: (next) => calls.push(`update:${next.locale}`),
          unmount: () => calls.push("unmount")
        };
      }
    };
    return { calls, renderer };
  }

  it("mounts once and lets the plugin write into the element", () => {
    const { calls, renderer } = tracked();
    render(
      createElement(PluginRendererView, { viewId: "ticket-list", renderer, context })
    );
    expect(calls).toEqual(["mount:ja"]);
    expect(host.textContent).toContain("drawn ja");
  });

  it("updates instead of remounting when the context changes", () => {
    const { calls, renderer } = tracked();
    render(
      createElement(PluginRendererView, { viewId: "ticket-list", renderer, context })
    );
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-list",
        renderer,
        context: renderContext({ locale: "en" })
      })
    );
    expect(calls).toEqual(["mount:ja", "update:en"]);
  });

  it("unmounts when the view goes away, and never updates afterwards", () => {
    const { calls, renderer } = tracked();
    render(
      createElement(PluginRendererView, { viewId: "ticket-list", renderer, context })
    );
    render(createElement("p", null, "別の画面"));
    expect(calls).toEqual(["mount:ja", "unmount"]);
    expect(calls.indexOf("unmount")).toBe(calls.length - 1);
  });

  it("remounts into a fresh element when the renderer itself changes", () => {
    // `update`を持たないrendererでも正しく描き直せることが契約である。
    const first = tracked();
    const second = tracked();
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-list",
        renderer: first.renderer,
        context
      })
    );
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-list",
        renderer: second.renderer,
        context
      })
    );
    expect(first.calls).toEqual(["mount:ja", "unmount"]);
    expect(second.calls).toEqual(["mount:ja"]);
  });

  it("hands over an empty element", () => {
    const renderer: PluginViewRenderer = {
      mount(element) {
        expect(element.childNodes.length).toBe(0);
        return { unmount: () => {} };
      }
    };
    render(
      createElement(PluginRendererView, { viewId: "ticket-list", renderer, context })
    );
  });
});

describe("failure isolation", () => {
  const exploding: PluginViewRenderer = {
    mount() {
      throw new Error("renderer exploded");
    }
  };

  it("keeps the rest of the page when a view throws while mounting", () => {
    render(
      createElement(
        "div",
        null,
        createElement("nav", null, "文書ツリー"),
        createElement(PluginRendererView, {
          viewId: "ticket-list",
          renderer: exploding,
          context
        })
      )
    );
    // **その画面だけが診断へ置き換わる。** 隣は残る。
    expect(host.textContent).toContain("文書ツリー");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("shows the cause instead of an empty box", () => {
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-list",
        renderer: exploding,
        context
      })
    );
    expect(host.textContent).toContain("renderer exploded");
  });

  it("recovers when the user moves to another view", () => {
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-list",
        renderer: exploding,
        context
      })
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const healthy: PluginViewRenderer = {
      mount(element) {
        element.append(document.createTextNode("次の画面"));
        return { unmount: () => {} };
      }
    };
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-detail",
        renderer: healthy,
        context
      })
    );
    // 前の画面の失敗を持ち越さない。
    expect(host.textContent).toContain("次の画面");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("reactRenderer", () => {
  it("really draws a React component through the mount contract", async () => {
    // 契約側のテストは形しか見ていなかった。**実際に描けることをここで確かめる。**
    const { reactRenderer } = await import("@vellym/plugin-api/react");
    const seen: string[] = [];
    const renderer = reactRenderer(({ context: viewContext }) => {
      seen.push(viewContext.locale);
      return createElement("p", { id: "from-plugin" }, `locale=${viewContext.locale}`);
    });
    render(
      createElement(PluginRendererView, { viewId: "ticket-list", renderer, context })
    );
    expect(host.querySelector("#from-plugin")?.textContent).toBe("locale=ja");
    render(
      createElement(PluginRendererView, {
        viewId: "ticket-list",
        renderer,
        context: renderContext({ locale: "en" })
      })
    );
    expect(host.querySelector("#from-plugin")?.textContent).toBe("locale=en");
    expect(seen).toEqual(["ja", "en"]);
  });

  it("defers unmount by a microtask so React does not warn", async () => {
    const { reactRenderer } = await import("@vellym/plugin-api/react");
    const renderer = reactRenderer(() => createElement("p", null, "x"));
    render(
      createElement(PluginRendererView, { viewId: "ticket-list", renderer, context })
    );
    render(createElement("p", null, "別の画面"));
    // 解体は1 microtask遅れる。hostは完了を待たない契約なので問題ない。
    await Promise.resolve();
    expect(host.textContent).toBe("別の画面");
  });
});
