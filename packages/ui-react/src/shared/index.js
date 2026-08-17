/**
 * プラグインへ公開するUI部品。**import mapの`@vellym/ui`が指す先である。**
 *
 * `reactRenderer`を通してReactで書くプラグインだけが使える。非Reactの
 * プラグインはデザイントークンを頼りに自分で描く
 * （[[decision-plugin-mechanism]] 6-1の割り切り）。
 *
 * ここへ足したものは公開契約になる。**画面固有の部品を混ぜない。**
 */
export { Button } from "./button.js";
export { Dialog } from "./dialog.js";
export { DataTable } from "./table.js";
export { FieldInput, RequiredMark } from "./field-input.js";
export { Icon } from "./icon.js";
export { KindIcon } from "./kind-icon.js";
//# sourceMappingURL=index.js.map