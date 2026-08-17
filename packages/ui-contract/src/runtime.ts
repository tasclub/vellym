/**
 * `@vellym/ui`は**型だけを配るパッケージ**である。
 *
 * 実体はVellym本体が持ち、ブラウザではimport mapが
 * `/assets/vellym-ui.js`へ向ける。プラグインはこのパッケージを
 * externalとしてビルドし、実体をhostから受け取る。
 *
 * 同梱すると部品が二重になり、Reactのインスタンスも分かれてhooksが壊れる。
 * ここが実行されたということは、externalの指定が漏れている。
 */
throw new Error(
  "@vellym/ui は型だけのパッケージです。プラグインのビルドで external に指定し、" +
    "実体は Vellym 本体（import map）から受け取ってください。"
);
