# @vellym/ui

Vellym本体が持つUI部品の**型宣言だけ**を配るパッケージ。

実装は含まない。ブラウザではVellym本体がimport mapで
`/assets/vellym-ui.js`へ解決する。プラグインはこのパッケージを
externalとしてビルドする。

```ts
import { Button, DataTable } from "@vellym/ui";
```

宣言は`packages/ui-react/src/shared/index.ts`から生成する。手で書かない。
実装と宣言が離れることを防ぐためである。
