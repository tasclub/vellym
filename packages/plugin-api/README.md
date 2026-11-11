# @vellym/plugin-api

[English](#english) | [日本語](#日本語)

## English

Public contract for [Vellym](https://vellym.tasclub.com/en/) plugins.

This package contains only what a plugin needs: the host API, record types received by plugins, declarative view descriptors, and the JSON Schema for the `vellym` field in a plugin's `package.json`. It has no runtime dependencies and does not depend on Vellym internals.

## Installing

```sh
npm install --save-dev @vellym/plugin-api
```

Declare the range of Vellym versions your plugin supports. There is no separate plugin API version: `engines.vellym` refers to the `vellym` package itself.

```json
{
  "name": "vellym-plugin-example",
  "engines": { "vellym": ">=0.3.0-beta.1" },
  "exports": {
    ".": { "node": "./dist/node.mjs", "browser": "./dist/browser.mjs" }
  },
  "vellym": {
    "id": "example",
    "contributes": {
      "kinds": [{ "kind": "Example" }],
      "views": [
        { "id": "example-list", "kind": "Example", "type": "list", "static": true }
      ]
    }
  }
}
```

## Writing the Node entry

```ts
import { definePlugin } from "@vellym/plugin-api";

export default definePlugin({
  activate(host) {
    host.registerKind({ kind: "Example", showInDocumentTree: false });

    host.registerRecordProjection("Example", (record) => ({
      // Copy what the list needs. Do not retain `record` itself.
      values: { status: String(record.spec.status ?? "") }
    }));

    host.registerView({
      id: "example-list",
      static: true,
      navigation: { label: { ja: "例", en: "Examples" } },
      view: {
        type: "list",
        id: "example-list",
        kind: "Example",
        title: { ja: "例", en: "Examples" },
        columns: [
          { id: "title", label: { ja: "タイトル", en: "Title" }, sortable: true },
          { id: "status", label: { ja: "状態", en: "Status" }, filterable: true }
        ]
      }
    });
  }
});
```

## Rules the host enforces

- A plugin never receives a filesystem path or the content root. It reads the extracted records the host hands it, and writes only through host commands, which use Vellym's normal save path.
- Anything a plugin gets wrong — an unresolvable package, a manifest outside the declared version range, or an `activate` function that throws — becomes a diagnostic. It never fails `vellym validate`, `vellym build`, the dev server, or the SPA.
- Data a plugin does not understand is preserved. Unknown fields and comments in canonical YAML survive a save round trip whether or not the plugin is enabled.

## Naming

Official plugins are published under `@vellym/*`. Community plugins are encouraged to use `vellym-plugin-<name>`. Neither convention affects resolution: Vellym loads exactly the package names listed under `plugins` in `vellym.config.yaml`.

## License

MIT

`summarizeRows(rows, key, type, method, locale)` purely aggregates index rows and returns `{ text, excluded }`. `SUMMARY_METHODS` lists methods per value type. Add field labels at the call site.

## 日本語

[Vellym](https://vellym.tasclub.com/)プラグインの公開契約です。

このパッケージにはプラグインに必要なものだけを含みます。ホストAPI、プラグインが受け取るレコード型、宣言的なビュー記述子、プラグインの`package.json`にある`vellym`フィールド用のJSON Schemaです。実行時依存はなく、Vellymの内部パッケージにも依存しません。

## インストール

```sh
npm install --save-dev @vellym/plugin-api
```

プラグインが対応するVellymのバージョン範囲を宣言します。プラグインAPI専用のバージョンはありません。`engines.vellym`は`vellym`パッケージ自体のバージョンを指定します。

```json
{
  "name": "vellym-plugin-example",
  "engines": { "vellym": ">=0.3.0-beta.1" },
  "exports": {
    ".": { "node": "./dist/node.mjs", "browser": "./dist/browser.mjs" }
  },
  "vellym": {
    "id": "example",
    "contributes": {
      "kinds": [{ "kind": "Example" }],
      "views": [
        { "id": "example-list", "kind": "Example", "type": "list", "static": true }
      ]
    }
  }
}
```

## Nodeエントリを書く

```ts
import { definePlugin } from "@vellym/plugin-api";

export default definePlugin({
  activate(host) {
    host.registerKind({ kind: "Example", showInDocumentTree: false });

    host.registerRecordProjection("Example", (record) => ({
      // 一覧に必要な値をコピーする。`record`自体は保持しない。
      values: { status: String(record.spec.status ?? "") }
    }));

    host.registerView({
      id: "example-list",
      static: true,
      navigation: { label: { ja: "例", en: "Examples" } },
      view: {
        type: "list",
        id: "example-list",
        kind: "Example",
        title: { ja: "例", en: "Examples" },
        columns: [
          { id: "title", label: { ja: "タイトル", en: "Title" }, sortable: true },
          { id: "status", label: { ja: "状態", en: "Status" }, filterable: true }
        ]
      }
    });
  }
});
```

## ホストが適用するルール

- プラグインにファイルシステムのパスやcontent rootは渡しません。ホストが渡す抽出済みレコードを読み、Vellymの通常の保存経路を通るホストコマンドだけで書き込みます。
- 解決できないパッケージ、宣言されたバージョン範囲外のmanifest、例外を投げる`activate`など、プラグインの問題は診断になります。`vellym validate`、`vellym build`、開発サーバー、SPAを失敗させません。
- プラグインが理解できないデータも保持します。プラグインの有効・無効にかかわらず、正本YAMLの未知の項目やコメントは保存後も残ります。

## 命名

公式プラグインは`@vellym/*`として公開します。コミュニティのプラグインには`vellym-plugin-<name>`を推奨します。いずれの命名規則も解決方法には影響しません。Vellymは`vellym.config.yaml`の`plugins`に書かれたパッケージ名だけを読み込みます。

## ライセンス

MIT

[English user guide](https://vellym.tasclub.com/en/) | [日本語の利用ガイド](https://vellym.tasclub.com/)


`summarizeRows(rows, key, type, method, locale)` は索引行を純粋に集計し、`{ text, excluded }` を返します。`SUMMARY_METHODS` は型ごとの方式です。ラベルは呼び出し側で付けます。
