# @vellym/tickets

Official ticket management plugin for [Vellym](https://vellym.tasclub.com/).

Vellymの文書階層へチケット管理を追加する。開発、テスト、リリース準備など、
工程ごとに別のチケット管理を置き、それぞれ異なるステータスと項目を使える。

## インストール

Vellymプロジェクトのルートで実行する。

```sh
npm install @vellym/tickets
```

peer dependencyの`@vellym/plugin-api`はnpmによって自動的にインストールされる。

## 設定

`vellym.config.yaml`の`plugins`へパッケージ名を追加する。

```yaml
plugins:
  - "@vellym/tickets"
```

`vellym dev`を起動し、文書ツリーの追加メニューから「チケット管理」を選ぶ。

## チケット管理を置く場所

`TicketTracker`は、置いたフォルダとその子孫にあるチケットを管理する。たとえば
`30-実装/`へ置けば実装工程を、`40-品質/`へ置けば品質工程を別々に管理できる。

チケットの所属はYAMLの項目ではなく置き場所で決まる。上位に複数の
`TicketTracker`がある場合、最も近い祖先のTrackerがそのチケットを所有し、
ステータスと項目の定義を与える。チケットは、さらに上位にあるTrackerの一覧にも
表示される。

画面から作成した新しいチケットは、既定で
`<Trackerのフォルダ>/+tickets/`へ保存される。`+`で始まるフォルダは文書ツリーには
出ないが、チケット一覧、全文検索、内部リンクでは利用できる。

## ステータスと項目

Trackerを開き、「このチケット管理の設定」からステータスと項目を定義する。
工程ごとに必要な流れや、優先度、担当、期限などを設定できる。

定義を変更した結果、既存チケットのステータスや項目と食い違っても、Vellymは
すべて警告として扱う。チケットは読める状態、編集できる状態を保ち、値を勝手に
削除しない。

## YAMLで直接書く

チケットの正本はYAMLファイルである。画面を使わず、エディタや外部のAIエージェントから
直接書いても、画面から作ったものと区別されない。

### TicketTracker

フォルダ直下へ1ファイル置く。ファイル名は自由に決めてよい。

```yaml
apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: dev-tickets
  title: 開発チケット
spec:
  statuses:
    - { id: todo, label: 未着手, category: open }
    - { id: doing, label: 対応中, category: open }
    - { id: done, label: 完了, category: closed }
  fields:
    - id: priority
      label: 優先度
      type: select
      required: true
      listColumn: true
      options:
        - { value: high, label: 高 }
        - { value: low, label: 低 }
    - id: due
      label: 期限
      type: date
      listColumn: true
```

- `statuses[]`は`id`／`label`／`category`が必須。`category`は`open`と`closed`の2値だけで、
  他の値を書いたその要素は読み飛ばされる。
- **配列の先頭が新規作成時の初期値**になり、配列順がそのまま表示順になる。初期値を指定する
  キーは無い。並べ替えて変える。
- `fields[]`は`id`／`label`／`type`が必須。`required`と`listColumn`は省略すると`false`。
- `required`は**画面から新しく作るときだけ**入力を強制する。既存チケットの編集も、手書きの
  YAMLも止めない。

### Ticket

Trackerのフォルダか、その子孫へ置く。既定の保存先は`<Trackerのフォルダ>/+tickets/`。

```yaml
apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ticket-01m0mt7tx3dm5qe6xv0265ftqc
  title: 見出しの階層を3段までに整理する
  labels:
    area: editor
spec:
  status: doing
  fields:
    priority: high
    due: 2026-09-05
  blocks:
    - id: description
      type: rich-text
      content: |
        アウトラインが深くなりすぎて、右の見出し一覧が読みにくい。
```

- `spec.status`は所有Trackerの`statuses[].id`を指す。
- `spec.fields`は**`fields[].id`をキーにしたmap**である。Trackerのような配列ではない。
- `spec.blocks`はPageと同じ形で、本文をここへ書く。
- `metadata.labels`は`kind`に依存しない分類軸で、一覧の絞り込みに使える。Trackerの
  `fields`とは別のものである。
- `metadata.name`は小文字英数と`-`。画面が作るチケットは`ticket-<小文字ULID>`で、ファイル名も
  同じにする。手書きでも揃えておくと、ファイルがおおよそ作成順に並び、Gitの差分が読みやすい。

### 項目の型と値の書き方

| `type` | YAMLでの値 |
| --- | --- |
| `text` | 文字列 |
| `multiline` | 文字列。複数行はYAMLのブロックスカラーで書く |
| `number` | 数値。`"3"`のような文字列は型違いの警告になる |
| `boolean` | `true`／`false` |
| `date` | `2026-09-05`形式の文字列。他の書式は警告になる |
| `select` | `options[].value`のいずれかと一致する文字列 |
| `multiselect` | 文字列の配列 |
| `reference` | 文字列 |

識別子は**`multiselect`であり、`multi-select`ではない**。

型に合わない値も、Vellymは削除せず警告として表示する。定義を1つ変えただけで大量のチケットが
編集不能になるのを避けるためである。

機械検証には次のJSON Schemaを使える。

- <https://vellym.tasclub.com/schemas/v1/ticket.schema.json>
- <https://vellym.tasclub.com/schemas/v1/ticket-tracker.schema.json>

## プラグインを外す

`vellym.config.yaml`の`plugins`から`@vellym/tickets`を外すと、チケット一覧と
専用の設定画面は表示されなくなる。`Ticket`と`TicketTracker`のYAMLは変更も削除も
されず、本文は引き続き読み込まれ、全文検索と内部リンクから利用できる。Vellymが
その`kind`を解釈できないことはエラーにはならない。

## License

MIT
