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

    host.registerRecordSetValidator("Example", (rows) =>
      // Runs once after every index row is ready. Checks that span records —
      // references, cycles — belong here and nowhere else.
      rows
        .filter(
          (row) =>
            typeof row.values.duplicateOf === "string" &&
            !rows.some((other) => other.name === row.values.duplicateOf)
        )
        .map((row) => ({
          file: row.name,
          path: "/spec/fields/duplicateOf",
          severity: "warning" as const,
          code: "EXAMPLE_REFERENCE_UNRESOLVED",
          message: {
            ja: "参照先のレコードが見つかりません",
            en: "The referenced record was not found."
          }
        }))
    );

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
- A `registerRecordSetValidator` check runs once per registration, after all index rows of that kind are ready. Several plugins may register checks for the same kind: the host runs the same function (same reference) once, deduplicates returned diagnostics by file, JSON Pointer, and code, and turns a throwing validator into a warning without stopping the load.
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

    host.registerRecordSetValidator("Example", (rows) =>
      // 索引行がすべてそろった後に1回だけ呼ばれる。レコードをまたぐ検査
      // （参照の解決・循環）はここでしか書けない。
      rows
        .filter(
          (row) =>
            typeof row.values.duplicateOf === "string" &&
            !rows.some((other) => other.name === row.values.duplicateOf)
        )
        .map((row) => ({
          file: row.name,
          path: "/spec/fields/duplicateOf",
          severity: "warning" as const,
          code: "EXAMPLE_REFERENCE_UNRESOLVED",
          message: {
            ja: "参照先のレコードが見つかりません",
            en: "The referenced record was not found."
          }
        }))
    );

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
- `registerRecordSetValidator`の検査は、そのkindの索引行がすべてそろった後に1回だけ走ります。複数のプラグインが同じkindへ登録してよい。同じ関数（同じ参照）は1回だけ実行され、返された診断はfile・JSON Pointer・codeで重複を除きます。検査が例外を投げても読み込みは続き、警告になります。
- プラグインが理解できないデータも保持します。プラグインの有効・無効にかかわらず、正本YAMLの未知の項目やコメントは保存後も残ります。

## 命名

公式プラグインは`@vellym/*`として公開します。コミュニティのプラグインには`vellym-plugin-<name>`を推奨します。いずれの命名規則も解決方法には影響しません。Vellymは`vellym.config.yaml`の`plugins`に書かれたパッケージ名だけを読み込みます。

## ライセンス

MIT

[English user guide](https://vellym.tasclub.com/en/) | [日本語の利用ガイド](https://vellym.tasclub.com/)


`summarizeRows(rows, key, type, method, locale)` は索引行を純粋に集計し、`{ text, excluded }` を返します。`SUMMARY_METHODS` は型ごとの方式です。ラベルは呼び出し側で付けます。
