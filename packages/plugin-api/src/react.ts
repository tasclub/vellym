/**
 * Reactで画面を書く作者のための薄い層。`@vellym/plugin-api/react`で読む。
 *
 * **既定のエントリ（`@vellym/plugin-api`）はここを読み込まない。** Reactを
 * 使わないプラグインがReactを要求されないように、subpathで分けている。
 * `react`と`react-dom`はoptionalなpeerDependencyである。
 *
 * ブラウザでの解決先はhostがimport mapで与える。プラグインはReactを
 * 同梱せず、externalとしてビルドする。同梱するとインスタンスが二重になり
 * hooksが壊れる。
 */
import {
  Component as ReactComponent,
  createElement,
  type ComponentType,
  type ReactNode
} from "react";
import { createRoot, type Root } from "react-dom/client";

import type { PluginViewRenderer } from "./host.js";
import type { PluginViewContext } from "./views.js";

/**
 * componentが受け取るprops。
 *
 * 文脈を展開せず`context`1つで渡す。契約へ項目が増えたときに、
 * propsの名前とぶつからないようにするためである。
 */
export interface PluginViewProps {
  context: PluginViewContext;
}

export type PluginViewComponent = ComponentType<PluginViewProps>;

/**
 * プラグインのReactツリーの中で起きた例外を、その場で受け止める。
 *
 * **hostのエラー境界では捕まえられない。** `reactRenderer`は`createRoot`で
 * **別のReactツリー**を作るため、その中の例外はhost側のツリーへ伝わらない。
 * host側が捕まえられるのは`mount`／`update`／`unmount`が同期で投げた場合
 * だけである。実際に、描画中に投げるcomponentで何も表示されない状態を踏んだ。
 *
 * 受け止めた結果はこの区画にだけ出る。文書ツリーも全文検索も本文の編集も
 * 巻き込まない。
 */
class RendererBoundary extends ReactComponent<
  { children: ReactNode },
  { message?: string }
> {
  state: { message?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error("[vellym] プラグインの画面で例外が発生しました", error);
  }

  render() {
    if (this.state.message === undefined) return this.props.children;
    return createElement(
      "p",
      { role: "alert" },
      "この画面を描画できませんでした。他の機能は使えます。",
      createElement("span", null, ` ${this.state.message}`)
    );
  }
}

/**
 * Reactのcomponentをmount契約へ包む。
 *
 * ```ts
 * import { reactRenderer } from "@vellym/plugin-api/react";
 * host.registerViewRenderer("ticket.list", reactRenderer(TicketList));
 * ```
 */
export function reactRenderer(Component: PluginViewComponent): PluginViewRenderer {
  return {
    mount(element, context) {
      const root: Root = createRoot(element);
      const draw = (next: PluginViewContext) =>
        createElement(RendererBoundary, null, createElement(Component, { context: next }));
      root.render(draw(context));

      let unmounted = false;
      return {
        update(next: PluginViewContext) {
          if (unmounted) return;
          root.render(draw(next));
        },
        unmount() {
          if (unmounted) return;
          unmounted = true;
          /*
           * **同期で片づける。**
           *
           * 当初は1 microtask遅らせていたが、hostが先に要素を捨てたあとに
           * 後片付けが走り、`removeChild`が`NotFoundError`を投げていた。
           * しかも非同期なのでどこにも捕まらない。
           *
           * hostが**Reactの管理外の要素を1枚挟む**ようにしたので、DOMの
           * 取り合いが起きなくなり、同期で片づけて問題ない。
           */
          root.unmount();
        }
      };
    }
  };
}
