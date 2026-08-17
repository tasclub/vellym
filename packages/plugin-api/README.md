# @vellym/plugin-api

Public contract for [Vellym](https://vellym.tasclub.com) plugins.

This package holds the types a plugin needs and nothing else: the host API,
the record types a plugin receives, the declarative view descriptors, and the
JSON Schema for the `vellym` field in a plugin's `package.json`. It has no
runtime dependencies and does not depend on Vellym's internals.

## Installing

```sh
npm install --save-dev @vellym/plugin-api
```

Declare the range of Vellym versions your plugin supports. There is no separate
plugin API version — `engines.vellym` refers to the `vellym` package itself.

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

- A plugin never receives a filesystem path or the content root. It reads the
  extracted records the host hands it, and writes only through host commands,
  which go through Vellym's own save path.
- Anything a plugin gets wrong — an unresolvable package, a manifest outside the
  declared version range, a throwing `activate` — becomes a diagnostic. It never
  fails `vellym validate`, `vellym build`, the dev server, or the SPA.
- Data a plugin does not understand is preserved. Unknown fields and comments in
  canonical YAML survive a save round trip whether or not the plugin is enabled.

## Naming

Official plugins are published under `@vellym/*`. Community plugins are
encouraged to use `vellym-plugin-<name>`. Neither convention affects
resolution — Vellym loads exactly the package names listed under `plugins` in
`vellym.config.yaml`.

## License

MIT
