import { defineBrowserPlugin } from "@vellym/plugin-api";
import { reactRenderer } from "@vellym/plugin-api/react";
import { SETTINGS_VIEW_ID } from "./views.js";
import { TrackerSettingsScreen } from "./settings-screen.js";

/**
 * ブラウザ側エントリ。
 *
 * **宣言では表せない画面だけをこちらへ移す。** 一覧と詳細は宣言のまま描く。
 * 定義の編集だけは、選択肢が「繰り返しの中の繰り返し」になるため宣言では
 * 表せず、ここで描く。
 *
 * `react`・`react-dom`・`@vellym/ui`はexternalとしてビルドし、実体はhostが
 * import mapで与える。同梱するとReactのインスタンスが二重になりhooksが壊れる。
 */
export default defineBrowserPlugin({
  activate(host) {
    host.registerViewRenderer(SETTINGS_VIEW_ID, reactRenderer(TrackerSettingsScreen));
  }
});
