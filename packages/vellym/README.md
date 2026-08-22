# Vellym

[![npm](https://img.shields.io/npm/v/vellym/beta?label=npm%40beta)](https://www.npmjs.com/package/vellym)
[![CI](https://github.com/tasclub/vellym/actions/workflows/ci.yml/badge.svg)](https://github.com/tasclub/vellym/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vellym)](https://github.com/tasclub/vellym/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/vellym)](https://nodejs.org/)

**Git管理できる型付きYAMLを「正本」とし、同じ実体を人間にはブラウザ上の読みやすい文書として、
AIエージェントには構造化ファイルとして両対応で提供する、ローカルファーストの文書管理ツール。**

Word や Notion は AI エージェントが構造的に扱いにくく、素の Markdown は型・スキーマが弱い。
Vellym はその間を **Kubernetes マニフェスト風の型付き YAML（`apiVersion`/`kind`）＋ ブラウザ表示**
で埋める。人間は視覚的に読み書きし、エンジニアと外部 AI エージェントは同じ YAML を直接読み書きする。
表示用の HTML と正本が乖離しない。

- **正本は YAML** — Git で diff・レビュー・履歴管理できる。HTML と図は生成物。
- **1ソース・2つの読み手** — 人間（ブラウザ）と AI エージェント（構造化ファイル）が同じ正本を共有。
- **プロジェクト文書に特化** — 憲章・要求・設計判断・ロードマップ・リスク・進捗・バックログ。
  arc42 / PMBOK / C4 / ADR は標準構成を設計するときの参考体系であり、Vellymは準拠や運用手順を強制しない。
- **中立な器** — 製品内へ AI モデル・AI チャット・AI 生成機能を組み込まない。ローカル完結でロックインなし。

> beta版。CLI は `init` / `dev` / `validate` / `build` / `migrate` を提供する。

## クイックスタート

必須環境は Node.js 22.12 以降と npm（Active LTS の 22・24 で動作確認）。
22.12 未満では JSON モジュールを安定して読み込めないため、動作対象外とする。

```bash
# 空ディレクトリからブラウザの3段階セットアップ付きで起動
npx vellym@beta dev

# もしくは CLI で初期化してから起動
npx vellym@beta init myproject --size small-team --method hybrid --language ja
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
| `vellym init [dir]` | 規模と開発方式に応じた厳格構成のFolderとPage YAMLを生成 |
| `vellym dev` | ローカル Web サーバーを起動し、閲覧・編集 |
| `vellym validate` | 正本 YAML をスキーマ検証し、診断を出力 |
| `vellym build` | 節目の閲覧専用スナップショット（静的 HTML）を生成 |
| `vellym migrate --to v1` | `v1alpha1`のPage／Folderを明示的に`v1`へ移行 |

```bash
vellym init [directory] --size personal --method agile --language ja
vellym init [directory] --size small-team --method hybrid --language ja
vellym init [directory] --size medium-large --method waterfall --language en
```

CLIは個別候補の選択を行わず、指定された規模と開発方式の厳格構成を一括生成する。Page候補と同じpathが
既にある場合はそのPageだけをskipし、既存ファイルを上書き・削除しない。ブラウザでは軽量・標準・厳格から選択し、
生成候補を追加・除外できる。後から必要になった構成は設定画面から明示的に追加でき、自動追加やリマインドは行わない。

既存文書の形式を`v1`へ移す場合は、Gitへcommitした上で
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

## プラグイン

npm パッケージで `kind` を追加できる。プラグインは新しい `kind` と、その一覧画面・
詳細画面・操作を提供する。正本は同じ YAML のまま増える。

公式のチケット管理 [`@vellym/tickets`](https://www.npmjs.com/package/@vellym/tickets)
を入れる場合。

```bash
npm install @vellym/tickets
```

```yaml
# vellym.config.yaml
plugins:
  - "@vellym/tickets"
```

`Ticket` と `TicketTracker` の YAML の書き方、フィールド型、チケット管理の置き場所は
`@vellym/tickets` の README に載せている。プラグインを作る側の情報は
<https://vellym.tasclub.com/pages/developing-plugins/> を参照。

プラグインを外しても、そのプラグインが扱っていた YAML を Vellym が削除・書き換えする
ことはない。対応するプラグインがない `kind` はエラーにならず、本文は全文検索と内部
リンクから引き続き利用できる。

## ライセンス

MIT © tasclub

## リンク

- 公式サイト・利用ガイド: <https://vellym.tasclub.com/>（このサイト自体を Vellym で生成している）
- 利用ガイド全文（平文・AIエージェント向け）: <https://vellym.tasclub.com/llms.txt>
- 公式プラグイン: <https://www.npmjs.com/package/@vellym/tickets>（チケット管理）
- 不具合・要望: <https://github.com/tasclub/vellym/issues/new/choose>
