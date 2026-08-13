# 変更履歴

このファイルは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

1.0.0 未満の期間は、マイナー版の間でも互換性のない変更が入りうる。
正本YAMLの形式を変更する場合は、`vellym migrate` による明示的な移行手段を用意し、
既存ファイルを暗黙に書き換えない。

## [Unreleased]

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

[Unreleased]: https://github.com/tasclub/vellym/compare/v0.2.0-beta.1...HEAD
[0.2.0-beta.1]: https://github.com/tasclub/vellym/compare/v0.1.0-alpha.2...v0.2.0-beta.1
[0.1.0-alpha.2]: https://github.com/tasclub/vellym/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/tasclub/vellym/releases/tag/v0.1.0-alpha.1
