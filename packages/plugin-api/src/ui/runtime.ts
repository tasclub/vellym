/**
 * `@vellym/plugin-api/ui`は**型だけを配るサブパスである。**
 *
 * UI部品の実装はVellym本体（`vellym`パッケージ）に同梱されており、
 * ブラウザではimport mapが`/assets/vellym-ui.js`へ解決する。
 * プラグインはこのsubpathをexternalとしてビルドし、実体をhostから受け取る。
 *
 * 同梱すると部品が二重になり、Reactのインスタンスも分かれてhooksが壊れる。
 * ここが実行されたということは、externalの指定が漏れている。
 */
throw new Error(
  "@vellym/plugin-api/ui は型だけのサブパスです。プラグインのビルドで external に指定し、" +
    "実体は Vellym 本体（import map）から受け取ってください。"
);
