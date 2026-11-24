# @vellym/design

[English](#english) | [日本語](#日本語)

## English

The official Vellym design-canvas plugin. Create and edit designs in the browser while keeping the source files in your Git repository as YAML and DTCG JSON.

### Install and configure

Install the package from your Vellym project root:

```sh
npm install @vellym/design
```

Add it to `plugins` in `vellym.config.yaml`:

```yaml
plugins:
  - "@vellym/design"
```

Start `vellym dev`, choose **New design canvas** from the document tree's add menu, and open the new canvas. Add boards and use pages, layers, components, styles, and tokens to build the design. Canvas edits are saved automatically.

### Resources and files

The plugin provides four YAML resource kinds:

- `DesignCanvas` stores the format version, pages, fonts, and references to styles and token files.
- `DesignBoard` stores one board's position, page, `implementedBy` paths, and node tree.
- `DesignComponent` stores a reusable component and its properties or variants.
- `DesignStyles` stores named shared appearance styles.

Each canvas has a folder. Keep each board and component in a separate YAML file under `+boards/` and `+components/`; filenames are derived from `metadata.name`. Tokens stay in DTCG JSON rather than being converted to YAML.

```text
docs/app/
├── app.yaml                 # DesignCanvas
├── app-styles.yaml          # DesignStyles (optional)
├── app.tokens.json          # DTCG tokens (optional)
├── app.resolver.json        # DTCG Resolver (optional)
├── +boards/home.yaml        # DesignBoard
└── +components/button.yaml  # DesignComponent
```

Example canvas and board:

```yaml
apiVersion: vellym.tasclub.com/v1
kind: DesignCanvas
metadata:
  name: app
  title: Application
spec:
  formatVersion: 1
  pages:
    - { id: main, title: Main }
  styles: app-styles
  tokens:
    files: [app.tokens.json]
---
apiVersion: vellym.tasclub.com/v1
kind: DesignBoard
metadata:
  name: home
  title: Home
spec:
  canvas: app
  page: main
  x: 0
  y: 0
  implementedBy: [src/pages/Home.tsx]
  root:
    id: root
    type: frame
    width: 390
    height: 844
    children: []
```

Inspect the versioned schema with commands such as:

```sh
npx vellym schema --kind DesignBoard
```

### Format conventions

- Use CSS, SVG, and DTCG names and values where those standards define the concept: for example `display: flex`, `gridTemplateColumns`, SVG path `d`, and CSS text properties.
- Use Figma terminology for concepts without a standard equivalent, including `sizing` (`hug`, `fill`, `fixed`), `constraints`, components, variants, and prototype reactions.
- Lengths are numbers in px; angles are in degrees. Node IDs are unique within their file and should stay stable after creation. Resolve resources by `metadata.name`, not by file path.
- Design tokens use the DTCG 2025.10 JSON format unchanged. Values can reference tokens such as `"{color.primary}"`.
- `DesignBoard.spec.implementedBy` contains paths relative to the Git repository root, with forward slashes.

### Canvas, code, and export

Use the toolbar and the Pages, Layers, and Components panels to build a canvas. The Design panel edits layout and appearance; Prototype configures interactions; Code shows CSS and token variables and the implementation paths in `implementedBy`.

Export SVG, PNG, and PDF from the canvas. PNG exports support a scale factor. CSS is available in the Code panel, and tokens can be exported as DTCG JSON. Exports are generated in the browser and downloaded.

The canvas supports keyboard shortcuts familiar to users of design tools: `V`, `F`, `R`, `O`, `L`, `P`, `T`, and `H` select tools; arrow keys move by 1px (10px with `Shift`); `Ctrl`+`Z` or `Cmd`+`Z` undoes; `Shift`+`Ctrl`+`Z` or `Shift`+`Cmd`+`Z` redoes. See the [Design Canvas user guide](https://vellym.tasclub.com/en/) for the full shortcut table and editing workflow.

### Fonts and static output

Add a Google Font from the bundled family list or add a local TTF, OTF, WOFF, or WOFF2 font file; local files are stored without conversion. Only the selected weights are saved under `assets/fonts/<family-name>/`, together with the license text, and referenced by the canvas. External access is used only when fetching a Google Font; viewing uses the saved files. If a font is missing or unreadable, the canvas uses a fallback font and reports a warning.

Static output supports read-only canvas and presentation viewing and code inspection. It does not show editing controls or save status, and uses font files saved in the project.

### Validate

After writing or editing design files, run:

```sh
npx vellym validate --strict --config vellym.config.yaml
```

## 日本語

Vellymの公式デザインキャンバスプラグインです。ブラウザでデザインを作成・編集し、YAMLとDTCG JSONのファイルをGitで管理できます。

### インストールと設定

Vellymプロジェクトのルートでインストールします。

```sh
npm install @vellym/design
```

`vellym.config.yaml`の`plugins`へ追加します。

```yaml
plugins:
  - "@vellym/design"
```

`vellym dev`を起動し、文書ツリーの追加メニューから「デザインキャンバスを作成」を選んで、新しいキャンバスを開きます。ボードを追加し、ページ・レイヤー・部品・共有スタイル・トークンを使ってデザインします。キャンバスの編集内容は自動保存されます。

### 種別とファイル

プラグインは4つのYAMLリソースを提供します。

- `DesignCanvas`: 形式の版、ページ、フォント、共有スタイルとトークンファイルの参照。
- `DesignBoard`: 1枚のボードの位置・ページ・`implementedBy`・ノードの木。
- `DesignComponent`: 再利用する部品と、そのプロパティやバリアント。
- `DesignStyles`: 名前を付けた共有スタイル。

キャンバスごとにフォルダを作ります。ボードと部品は`+boards/`・`+components/`の下へ1件ずつ別ファイルで置き、ファイル名は`metadata.name`から作ります。トークンはYAMLに変換せず、DTCG JSONのまま保存します。

```text
docs/app/
├── app.yaml                 # DesignCanvas
├── app-styles.yaml          # DesignStyles（任意）
├── app.tokens.json          # DTCG tokens（任意）
├── app.resolver.json        # DTCG Resolver（任意）
├── +boards/home.yaml        # DesignBoard
└── +components/button.yaml  # DesignComponent
```

キャンバスとボードの例:

```yaml
apiVersion: vellym.tasclub.com/v1
kind: DesignCanvas
metadata:
  name: app
  title: アプリ
spec:
  formatVersion: 1
  pages:
    - { id: main, title: メイン }
  styles: app-styles
  tokens:
    files: [app.tokens.json]
---
apiVersion: vellym.tasclub.com/v1
kind: DesignBoard
metadata:
  name: home
  title: ホーム
spec:
  canvas: app
  page: main
  x: 0
  y: 0
  implementedBy: [src/pages/Home.tsx]
  root:
    id: root
    type: frame
    width: 390
    height: 844
    children: []
```

種別ごとの詳しいスキーマは次のように調べます。

```sh
npx vellym schema --kind DesignBoard
```

### 形式の決まり

- 標準で定義されている概念はCSS・SVG・DTCGの名前と値を使います。例: `display: flex`、`gridTemplateColumns`、SVGのパス`d`、CSSの文字の書式。
- 標準にない概念はFigmaの語を使います。例: `sizing`（`hug`・`fill`・`fixed`）、`constraints`、部品・バリアント・プロトタイプの操作。
- 長さはpxの数値、角度は度です。ノードのIDはファイル内で一意にし、作成後は変えないでください。リソース間の参照にはファイルパスでなく`metadata.name`を使います。
- デザイントークンはDTCG 2025.10のJSON形式をそのまま使います。値からは`"{color.primary}"`のように参照できます。
- `DesignBoard.spec.implementedBy`には実装ファイルのパスをGitルートからの相対パスで記録し、区切りには`/`を使います。

### キャンバス、コード、書き出し

ツールバーとページ・レイヤー・部品の欄を使ってデザインを作ります。デザイン欄でレイアウトや見た目を編集し、プロトタイプ欄で操作を設定できます。コード欄にはCSSとトークン変数、`implementedBy`の実装ファイルが表示されます。

キャンバスからSVG・PNG・PDFを書き出せます。PNGは倍率を指定できます。CSSはコード欄で確認し、トークンはDTCG JSONとして書き出せます。書き出しはブラウザで行い、ファイルをダウンロードします。

デザインツールで一般的なキー操作に対応しています。`V`・`F`・`R`・`O`・`L`・`P`・`T`・`H`でツールを選択し、矢印キーで1px、`Shift`+矢印で10px移動します。`Ctrl`+`Z`または`Cmd`+`Z`で取り消し、`Shift`+`Ctrl`+`Z`または`Shift`+`Cmd`+`Z`でやり直します。すべてのキー操作と編集手順は[デザインキャンバスの利用ガイド](https://vellym.tasclub.com/)を参照してください。

### フォントと静的版

同梱の一覧からGoogle Fontsを追加するか、手元のTTF・OTF・WOFF・WOFF2を追加します。手元のフォントは変換せずに保存します。選んだ太さだけを`assets/fonts/<ファミリー名>/`へライセンス本文とともに保存し、キャンバスから参照します。Google Fontsの取得時だけ外部へ接続し、閲覧時には保存済みファイルを使います。フォントが見つからない・読めない場合は代替フォントで表示し、警告を出します。

静的出力ではキャンバスやプレゼンテーションを閲覧し、コードを確認できます。編集操作や保存状態は表示されず、プロジェクトに保存したフォントを使います。

### 検証

デザインのファイルを書いたり編集したりした後は、次を実行します。

```sh
npx vellym validate --strict --config vellym.config.yaml
```

日本語の利用ガイド: <https://vellym.tasclub.com/>
