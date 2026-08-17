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
import { createElement, type ComponentType } from "react";
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
      root.render(createElement(Component, { context }));

      let unmounted = false;
      return {
        update(next: PluginViewContext) {
          if (unmounted) return;
          root.render(createElement(Component, { context: next }));
        },
        unmount() {
          if (unmounted) return;
          unmounted = true;
          // Reactは描画中の同期unmountを警告する。hostは呼んだ直後に要素を
          // 捨て、次のmountは別の要素へ行うため、1 microtask遅らせても
          // 見た目には影響しない。契約上の「同期で片づける」は、hostが
          // 完了を待たないという意味であり、ここで満たしている。
          queueMicrotask(() => {
            root.unmount();
          });
        }
      };
    }
  };
}
