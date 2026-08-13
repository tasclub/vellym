# Vellym

**Git管理できる型付きYAMLを「正本」とし、同じ実体を人間にはブラウザ上の読みやすい文書として、
AIエージェントには構造化ファイルとして両対応で提供する、ローカルファーストの文書管理ツール。**

Word や Notion は AI エージェントが構造的に扱いにくく、素の Markdown は型・スキーマが弱い。
Vellym はその間を **Kubernetes マニフェスト風の型付き YAML（`apiVersion`/`kind`）＋ ブラウザ表示**
で埋める。人間は視覚的に読み書きし、エンジニアと外部 AI エージェントは同じ YAML を直接読み書きする。
表示用の HTML と正本が乖離しない。

- **正本は YAML** — Git で diff・レビュー・履歴管理できる。HTML と図は生成物。
- **1ソース・2つの読み手** — 人間（ブラウザ）と AI エージェント（構造化ファイル）が同じ正本を共有。
- **プロジェクト文書に特化** — 憲章・要求・設計判断・ロードマップ・リスク・進捗・バックログ。
  arc42 / PMBOK は「保存形式」ではなく初期テンプレート（プロファイル）。
- **中立な器** — 製品内へ AI モデル・AI チャット・AI 生成機能を組み込まない。ローカル完結でロックインなし。

> beta版。CLI は `init` / `dev` / `validate` / `build` / `migrate` を提供する。

## クイックスタート

必須環境は Node.js 22 LTS 以降（Active LTS の 22・24 で動作確認）と npm。

```bash
# 空ディレクトリから対話セットアップ付きで起動
npx vellym@beta dev

# もしくは CLI で初期化してから起動
npx vellym@beta init myproject --profile software-basic
cd myproject
npx vellym@beta dev
```

`dev` は既定で `127.0.0.1` にバインドする。コンテナ内など外部から接続する場合のみ
`--host 0.0.0.0` を明示する。起動後はブラウザで `http://127.0.0.1:4173` を開く。

Vellym に認証はない。`--host 0.0.0.0` で起動したサーバーへ到達できる相手は、
文書の閲覧・編集・構成変更ができる。信頼できるネットワークだけで使用すること。
既定の loopback バインド中は、`Host` を `localhost` / `127.0.0.1` / `[::1]` に限定する。

## コマンド

| コマンド | 役割 |
|---------|------|
| `vellym init [dir]` | プロファイルに沿って正本 YAML の初期セットを生成 |
| `vellym dev` | ローカル Web サーバーを起動し、閲覧・編集 |
| `vellym validate` | 正本 YAML をスキーマ検証し、診断を出力 |
| `vellym build` | 節目の閲覧専用スナップショット（静的 HTML）を生成 |
| `vellym migrate --to v1` | `v1alpha1`のPage／Folderを明示的に`v1`へ移行 |

```bash
vellym init [directory]                                # profile未指定は minimal
vellym init [directory] --profile software-basic
vellym init [directory] --profile software-basic,arc42
vellym init [directory] --profile product-planning
vellym init [directory] --plan --json                  # 読取専用preview（変更しない）
```

`--plan` は作成予定と競合を確認する読取専用プレビュー。生成候補が一つでも既に存在する場合、
CLI は初期化全体を中止し、既存ファイルを上書き・削除しない。設定ファイルがないプロジェクトでも
`vellym dev` を起動でき、ブラウザの 4 ステップ画面から profile と作成文書を確認できる。

`product-planning`は、プロダクトビジョン、ユーザー課題、仮説、要求、ロードマップ、
リリース計画の6文書を日英で生成する。既存文書の形式を`v1`へ移す場合は、Gitへcommitした上で
`vellym migrate --to v1 --plan`で対象を確認し、`vellym migrate --to v1`を明示的に実行する。

## 正本の形（例）

```yaml
apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: project-charter
  title: プロジェクト憲章
spec:
  documentType: project-charter
  locale: ja
  blocks:
    - id: purpose
      type: rich-text
      format: commonmark
      content: |
        ## 目的
        ...
```

使い方の詳細（日本語・英語）は [`how-to-use/`](how-to-use/) を参照。

## 開発

npm workspaces のモノレポ。公開パッケージは `packages/vellym`、その他 `@vellym-internal/*`
は非公開の内部パッケージで、ビルド時に `vellym` へバンドルされる。

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Core の検証（WCAG 自動検査、100 ページ時の検索応答、エディタ往復確認）には
Playwright Chromium を使用する（開発・検証専用で配布物には含まれない）。

```bash
npx playwright install chromium
npm run verify:core
```

### Dev Container

ホストへ Node.js を導入せず開発する場合は、Docker・VS Code・Dev Containers 拡張機能を
用意し、本リポジトリを **Reopen in Container** で開く。ルート `Dockerfile` の
`development` target を使用し、作成時に `npm ci` と `npm run build` を実行する。

### 配布候補 runtime イメージ

`Dockerfile` は Node.js 24／Debian Bookworm を共通基盤に `development` / `builder` /
`runtime` を分離する。配布候補は `runtime` target から作成し、Node.js runtime と
生成済み CLI・UI・Schema だけを含める。

```bash
docker build --target runtime -t vellym:local .
docker run --rm -p 127.0.0.1:4173:4173 -v "$PWD/myproject:/workspace" vellym:local
```

Docker の公開先は `127.0.0.1:4173` に限定し、同一ネットワークへ不用意に公開しない。

## ステータス

現在は `init` / `dev` / `validate` / `build` / `migrate` を提供する。
追加ブロック、preset、Git 操作、plugin SDK は未実装。`v1`契約はRCまで変更される可能性がある。

## ライセンス

MIT © tasclub

## 開発参加・サポート

- 利用ガイド: <https://vellym.tasclub.com/>
- 不具合・要望: <https://github.com/tasclub/vellym/issues/new/choose>
- 変更履歴: [CHANGELOG.md](CHANGELOG.md)
- 開発参加: [CONTRIBUTING.md](CONTRIBUTING.md)
- セキュリティ: [SECURITY.md](SECURITY.md)
- 文書形式と互換性: <https://vellym.tasclub.com/#page=document-format>
