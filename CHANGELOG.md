# 変更履歴

このファイルは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

1.0.0 未満の期間は、マイナー版の間でも互換性のない変更が入りうる。
正本YAMLの形式を変更する場合は、`vellym migrate` による明示的な移行手段を用意し、
既存ファイルを暗黙に書き換えない。

## [Unreleased]

## [0.3.0-beta.1] - 2026-08-14

### 追加

- 本文の内部Pageリンクに、Obsidian互換のwiki link記法`[[...]]`を導入した。
  `[[target]]`、`[[target|表示名]]`、`[[target#見出し]]`とその組み合わせを解釈し、
  参照先は`metadata.name`→`metadata.slug`→titleの順に解決する。
  逆参照（このPageを参照しているPage）とリンク切れ診断を、動的版と静的版の
  双方で提供する。外部URL・mailto・相対path・画像は通常のMarkdownリンクのまま。
- Coreが解釈できない`kind`のファイルを、エラーではなく警告として読み進めるようにした。
  共通契約（`apiVersion`／`kind`／`metadata`／`spec.locale`／`translations`／`blocks`）
  だけを解釈し、種別固有の`spec`は解釈せず原文のまま保持する。全文検索・内部リンク・
  逆参照・多言語projectionの対象には含め、文書ツリーには出さない。
  プラグインを外してCoreだけになっても壊れないようにするための変更である。
- 初期セットアップの構成テンプレートを`setup-packs/`配下の外部定義へ切り出し、
  生成候補を階層ツリーで選択・絞り込みできるようにした。

### 変更

- `vellym init`の引数を`--size`と`--method`にした。規模（personal／small-team／
  medium-large）と開発方式（agile／hybrid／waterfall）から構成を導出する。
  従来の`--profile`、`--template`、`--plan`は廃止した。
- HTTP応答と静的データの封筒の`schemaVersion`を`apiSchemaVersion`へ改名した。
  `vellym-build.json`は`buildSchemaVersion`、setup pack定義は`packSchemaVersion`
  へ改名した。同じ名前で異なる契約を指していたものを分離した。
  `vellym.config.yaml`の`schemaVersion`は利用者が書く項目のため変更していない。

### 削除

- 本文リンクの`[表示名](#page=<slug>)`形式を廃止した。内部Pageリンクの記法は
  `[[...]]`ひとつに統一する。互換読み取りは実装していないため、既存の本文は
  `[[...]]`へ書き換える必要がある。
- `spec.documentType`を廃止した。当初は表示形式の判別子として確保した項目だが
  定義が定まらないまま分類ラベルとして使われており、その役割は`kind`が担う。
  唯一の表示先だった本文上部の種別表示も削除した。
- `spec.blocks[].format`を廃止した。`commonmark`固定で分岐に使われておらず、
  別形式を受け入れる計画もない。Mermaidや数式はCommonMarkのコードブロックで
  表現できるため、この廃止と競合しない。
- 生成物へのprovenance annotations（`setup-pack-id`、`template-id`、
  `information-area-id`等）の書き込みをやめた。生成後は利用者が自由に書き換える
  ため、生成元の記録は実態と乖離する。

`documentType`と`format`は解釈しなくなるだけで、既存YAMLに残っていても
未知の項目として保持・無視される。ファイルの一括修正は不要である。
`apiVersion`は`vellym.tasclub.com/v1`のまま据え置く。今回の変更はいずれも
既存ファイルを壊さない緩和であり、版を上げる理由が発生していない。

### その他

- `spec.blocks`を任意にした。本文を持たない種別を許すため。

## [0.2.0-beta.1] - 2026-08-13

### 変更

- 新規に生成するPage・Folderの`apiVersion`を`vellym.tasclub.com/v1`にした。
  `init`、ブラウザの初期セットアップ、画面からのPage・Folder作成が対象。
  既存の`v1alpha1`はこれまでどおり読み込み・編集・検索でき、
  移行する場合は`vellym migrate --to v1`を明示的に実行する。
- 公開パッケージの`engines.node`を`>=22.12.0`にした。
  JSON module（`import ... with { type: "json" }`）が安定して利用できる最小版に合わせた。
  ビルドターゲットも`node22`へ揃えた。

- 文書形式の進化規則を定め、Page・Folderのschemaを版ごとに分けず1枚に統合した。
  `apiVersion`はenumで対応版を受ける。追加（新しいblock種別、任意項目）では版を上げず、
  版を上げるのは破壊的変更のときだけとする。変換は直前の版からの一段だけを提供し、
  同時にサポートする版は2つまでとする。詳細は「文書形式と互換性」ガイドを参照。
  公開schema URL（`/schemas/v1/...`）は従来どおり版ごとに分かれ、その版だけを受け付ける。

### セキュリティ

- `dev`をloopback（既定の`127.0.0.1`）へbindしている間、`Host`ヘッダを
  `localhost`・`127.0.0.1`・`[::1]`に限定するようにした。
  外部サイトがDNS rebindingでローカルのAPIへ到達する経路を塞ぐ。
- `dev --host 0.0.0.0`で起動したとき、認証がないこと、到達できる相手が
  文書の閲覧・編集・構成変更を行えることを起動時に警告するようにした。

### 修正

- 静的ファイル配信のContent-Typeが`.js`・`.css`・HTMLしか判別せず、
  画像・アイコン・フォントを`text/html`として返していた問題を修正した。
- 存在しないアセットに対してSPAの`index.html`をHTTP 200で返していた問題を修正した。
  拡張子を持つ要求は404を返す。

### 追加

- npmのdist-tagは、prereleaseでも`latest`を同じ版へ向ける。`npm install vellym`と
  `npx vellym`が解決できる状態を保つため。版を明示する場合は`vellym@beta`を使う。
- npmの公開をTrusted Publishing（OIDC）へ移行し、publish用のtokenを保持しないようにした。
- 導入コマンドの案内がdist-tagと一致しない場合、publishを中止するようにした。
  README（2件）と日英の「はじめかた」の`npx vellym@<tag>`を検査する。
- 配布物へ`THIRD-PARTY-NOTICES.md`を同梱するようにした。
  `cli.mjs`とUI bundleへ取り込む第三者packageのライセンス本文を、
  `package-lock.json`のproduction依存から生成する。

## [0.1.0-alpha.2] - 2026-08-02

### 追加

- package、CLI、静的生成、tarballのバージョンを一元化し、
  tag/version検査、pack smoke、provenance付きpublishのgateを追加した。
- GitHub Issue Form、セキュリティポリシー、コントリビューションガイドを追加した。
- 日英の公式サイト、利用ガイド、公開schemaを生成するようにした。
- `product-planning` profile（日英6文書）を追加した。
- Page・Folderの`v1` schemaと`vellym migrate --to v1`を追加した。

### 変更

- 4段階の初期セットアップと、Node.js 22／24対応の文書を整合させた。

## [0.1.0-alpha.1] - 2026-08-01

### 追加

- 初回公開。CLI（`init`／`dev`／`validate`／`build`）、
  ブラウザでの閲覧・編集・構成管理・全文検索、閲覧専用の静的サイト生成。

[Unreleased]: https://github.com/tasclub/vellym/compare/v0.3.0-beta.1...HEAD
[0.3.0-beta.1]: https://github.com/tasclub/vellym/compare/v0.2.0-beta.1...v0.3.0-beta.1
[0.2.0-beta.1]: https://github.com/tasclub/vellym/compare/v0.1.0-alpha.2...v0.2.0-beta.1
[0.1.0-alpha.2]: https://github.com/tasclub/vellym/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/tasclub/vellym/releases/tag/v0.1.0-alpha.1
