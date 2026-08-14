# Vellym 開発時の指示

この文書はリポジトリで作業するAIエージェントと開発者向けである。Vellymの利用者向け
文書ではない。利用者向けの説明は `how-to-use/content/` に置く。

## 正本YAMLのフィールドを勝手に増やさない

**最優先の規律。** Page／Folder YAMLへ、決定されていないフィールドを追加しない。
生成するテンプレート、fixture、テストデータ、ドキュメントの例、いずれも同じである。

過去に `spec.documentType` が、定義文書を持たないまま「将来の拡張用」として置かれ、
その後AIが分類ラベルとして値を埋め続けた結果、88ファイルに25種類の語彙が育った。
本来は表示形式の判別子にする想定だったため、当初の意図とずれたまま実装が固まり、
最終的に廃止する判断になった。同じことを繰り返さない。

Coreが解釈するフィールドは次のとおりで、これがすべてである。

| 位置 | キー | 用途 |
| --- | --- | --- |
| top | `apiVersion` | 形式バージョン |
| top | `kind` | リソース種別。Core組み込みは `Page` と `Folder` のみ |
| metadata | `name` | 不変の機械ID。内部リンク `[[...]]` の第一の解決先 |
| metadata | `title` | 可変の表示名 |
| metadata | `slug` | 可変のURL名 |
| metadata | `labels` | 人が付ける分類軸。絞り込みとグループ化の入力 |
| metadata | `annotations` | 機械が書く名前空間付きメタデータ。UIに出さない |
| spec | `locale` / `translations` | 正本の言語と翻訳 |
| spec | `blocks` | 順序付き本文（任意） |
| block | `id` / `type` / `content` | ブロック識別子・種別・本文 |

正本は [[decision-resource-model-kind-boundary]]（`docs/content/20-設計/decisions/`）。

### 新しいフィールドが必要になったら

1. まず既存の `labels`、`annotations`、`blocks[].type` で表現できないか検討する。
2. 表現できない場合は、**実装より先に** `docs/content/10-要件/` の要件と
   `docs/content/20-設計/decisions/` のDecisionを更新し、目的・値域・書く主体・
   読む主体を明記する。
3. 種別固有のデータは `kind` を分けて `spec` 直下へ置く。`spec.<種別名>` のような
   入れ子を作らない。

「とりあえず入れておいて後で決める」をしない。定義の無いフィールドは、
定義される前にデータが溜まって撤回できなくなる。

## 設計文書はADRだけを直さない

方針を変更するときは `docs/content/10-要件/` の要件文書から直す。ADRだけの修正は
上位資料と矛盾する。下流の `docs/content/50-運営/フェーズ1バックログ.yaml` と
`docs/content/40-品質/` の受入シナリオにも追随が必要か確認する。

`docs/content/60-検討/`、`70-調査履歴/`、`80-履歴/` は当時の記録なので書き換えない。

なお `docs/` は `.gitignore` で除外されている。公開リポジトリには含まれない。

## Coreだけになっても壊れない

プラグインを外した状態で、解釈できないものは**無視される**のであって、
エラーにしてはならない。

- 未知の `kind` はschema errorにせず、共通契約の範囲だけを読む。
- 未知の `blocks[].type` は原文を保持し、表示しないだけにする。
- 未知のフィールドは保存時に削除しない（非破壊往復）。
- `vellym validate` と `vellym build` を、解釈できないだけの理由で失敗させない。

## 実装時の確認

- `npm run typecheck` を必ず通す。tsconfigは `strict` に加えて
  `noUncheckedIndexedAccess: true` なので、配列の添字アクセスは `T | undefined` になる。
- `npm test` を通す。
- 破壊的変更でも `apiVersion` は上げない。一連の変更を入れ終えて整合が取れた時点で、
  まとめて `v2` を切る。
