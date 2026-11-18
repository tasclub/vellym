# @vellym/tickets

[English](#english) | [日本語](#日本語)

## English

Ticket index keys are `status`, `tracker`, `trackers`, `labels`, and `field:<id>`. Query without writing: `vellym list --kind Ticket --where status=ready --json` or `vellym list --kind Ticket --where field:priority=high`.

Official ticket-management plugin for [Vellym](https://vellym.tasclub.com/en/).

Add ticket management to Vellym's document tree. You can keep separate trackers for development, testing, release preparation, and other workflows, each with its own statuses and fields.

Configure `spec.summary` on a tracker to display summaries of all currently filtered list rows, including in static output. For example: `summary: [{ field: priority, method: breakdown }]`. Invalid values are counted separately.

## Installing

Run this from the root of your Vellym project:

```sh
npm install @vellym/tickets
```

The peer dependency `@vellym/plugin-api` is installed automatically by npm.

## Configuration

Add the package name to `plugins` in `vellym.config.yaml`:

```yaml
plugins:
  - "@vellym/tickets"
```

Start `vellym dev`, then choose **Ticket tracker** from the document tree's add menu.

## Where to put ticket management

A `TicketTracker` manages tickets in the folder where it is placed and its descendants. For example, place one in `30-implementation/` to manage implementation work and another in `40-quality/` for quality work.

Ticket ownership is determined by its location, not by a YAML field. If multiple `TicketTracker`s are ancestors of a ticket, the nearest one owns it and defines its statuses and fields. The ticket also appears in the lists of any higher-level trackers.

New tickets created in the UI are saved by default under `<tracker-folder>/+tickets/`. Folders whose names start with `+` are hidden from the document tree, but their contents remain available in ticket lists, full-text search, and internal links.

## Statuses and fields

Open a tracker and choose **Configure this tracker** to define statuses and fields. Configure the workflow and fields such as priority, assignee, and due date for each process.

If a definition change makes existing ticket values inconsistent, Vellym reports warnings. Tickets remain readable and editable, and values are never silently deleted.
Values outside defined `select` or `multiselect` options are warned about and retained.

To use parent-child relationships, add a field of type `reference` and select it under **Parent reference field** in the settings. Installing `@vellym/wbs` displays that hierarchy in the WBS view. Circular references and missing parents are reported as warnings; tickets are not removed. Trackers that do not select a parent field behave as before.

## Writing YAML directly

YAML files are the source of truth for tickets. You can write them with an editor or an external AI agent; Vellym treats them the same as tickets created in the UI.

### TicketTracker

Place one file directly in the tracker folder. The filename is up to you.

```yaml
apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: dev-tickets
  title: Development tickets
spec:
  statuses:
    - { id: todo, label: To do, category: open }
    - { id: doing, label: In progress, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - id: priority
      label: Priority
      type: select
      required: true
      listColumn: true
      options:
        - { value: high, label: High }
        - { value: low, label: Low }
    - id: due
      label: Due date
      type: date
      listColumn: true
    - { id: parent, label: Parent ticket, type: reference }
    - id: estimate
      label: Estimate
      type: number
      sort: true  # sortable without a column in the list
  defaultSort:
    field: estimate
    direction: desc
  hierarchy:
    parentField: parent
```

- `statuses[]` requires `id`, `label`, and `category`. The only valid `category` values are `open` and `closed`; entries with another value are skipped.
- **The first status is the initial value for new tickets**, and the array order is also the display order. There is no separate initial-value key; reorder the array to change it.
- `fields[]` requires `id`, `label`, and `type`. `required` and `listColumn` default to `false` when omitted.
- `required` enforces input **only when creating a new ticket in the UI**. It does not block editing existing tickets or writing YAML by hand.
- A field can join the list view as a column (`listColumn`), a filter (`filter`), or a sort option (`sort`) — declared separately. Omitted `filter` and `sort` follow `listColumn`. A field with `filter` or `sort` but no `listColumn` is used by the filter and sort selectors while staying out of the table.
- `spec.defaultSort: { field: <field-id>, direction: asc|desc }` sets the sort applied when the list opens. It may name a field that is not a list column, as long as sorting is enabled for it. `direction` defaults to `asc`. An unknown field or one with sorting disabled raises a warning and the list opens sorted by title, as before. Personal settings override the default.

### Ticket

Place a ticket in the tracker folder or one of its descendants. The default save location is `<tracker-folder>/+tickets/`.

```yaml
apiVersion: vellym.tasclub.com/v1
kind: Ticket
metadata:
  name: ticket-01m0mt7tx3dm5qe6xv0265ftqc
  title: Keep heading nesting to three levels
  labels:
    area: editor
spec:
  status: doing
  fields:
    priority: high
    due: 2026-09-05
    parent: ticket-01m0m000000000000000000001
  blocks:
    - id: description
      type: rich-text
      content: |
        The outline is too deep, making the heading list on the right hard to read.
```

- `spec.status` refers to an ID in the owning tracker's `statuses[].id`.
- `spec.fields` is a **map keyed by `fields[].id`**, not an array like the tracker's `fields`.
- `spec.blocks` has the same shape as a Page; put the ticket body here.
- `metadata.labels` provides classification independent of `kind` and can be used to filter lists. It is separate from the tracker's `fields`.
- `metadata.name` uses lowercase letters, digits, and hyphens. Tickets created in the UI use `ticket-<lowercase ULID>`; use the same value for the filename. Matching them for hand-written tickets also keeps files roughly in creation order and makes Git diffs easier to read.

### Field types and values

| `type` | YAML value |
| --- | --- |
| `text` | String |
| `multiline` | String; use a YAML block scalar for multiple lines |
| `number` | Number; a string such as `"3"` produces a type-mismatch warning |
| `boolean` | `true` / `false` |
| `date` | String in `2026-09-05` format; other formats produce a warning |
| `select` | String matching one of the `options[].value` values |
| `multiselect` | Array of strings |
| `reference` | String |

The identifier is **`multiselect`**, not `multi-select`.

Values that do not match their declared type are reported as warnings, not deleted. This prevents a single definition change from making many tickets impossible to edit.

For machine validation, use these JSON Schemas:

- <https://vellym.tasclub.com/schemas/v1/ticket.schema.json>
- <https://vellym.tasclub.com/schemas/v1/ticket-tracker.schema.json>

## Removing the plugin

Removing `@vellym/tickets` from `plugins` in `vellym.config.yaml` hides the ticket list and its dedicated settings screen. The `Ticket` and `TicketTracker` YAML files are neither changed nor deleted. Their content remains loaded and available through full-text search and internal links. Vellym does not treat an unrecognized `kind` as an error.

## License

MIT

## 日本語

Ticketの索引キーは`status`、`tracker`、`trackers`、`labels`、`field:<項目ID>`。読み取り専用の例: `vellym list --kind Ticket --where status=ready --json`、`vellym list --kind Ticket --where field:priority=high`。

Trackerの `spec.summary`（例: `summary: [{ field: priority, method: breakdown }]`）で、一覧に絞り込み後の全行の集計を表示します。静的出力にも表示し、型の合わない値は除外件数を示します。

[Vellym](https://vellym.tasclub.com/)の公式チケット管理プラグインです。

Vellymの文書階層へチケット管理を追加します。開発、テスト、リリース準備など、工程ごとに別のチケット管理を置き、それぞれ異なるステータスと項目を使えます。

## インストール

Vellymプロジェクトのルートで実行します。

```sh
npm install @vellym/tickets
```

peer dependencyの`@vellym/plugin-api`はnpmによって自動的にインストールされます。

## 設定

`vellym.config.yaml`の`plugins`へパッケージ名を追加します。

```yaml
plugins:
  - "@vellym/tickets"
```

`vellym dev`を起動し、文書ツリーの追加メニューから「チケット管理」を選びます。

## チケット管理を置く場所

`TicketTracker`は、置いたフォルダとその子孫にあるチケットを管理します。たとえば`30-実装/`へ置けば実装工程を、`40-品質/`へ置けば品質工程を別々に管理できます。

チケットの所属はYAMLの項目ではなく置き場所で決まります。上位に複数の`TicketTracker`がある場合、最も近い祖先のTrackerがそのチケットを所有し、ステータスと項目の定義を与えます。チケットは、さらに上位にあるTrackerの一覧にも表示されます。

画面から作成した新しいチケットは、既定で`<Trackerのフォルダ>/+tickets/`へ保存されます。`+`で始まるフォルダは文書ツリーには出ませんが、チケット一覧、全文検索、内部リンクでは利用できます。

## ステータスと項目

Trackerを開き、「このチケット管理の設定」からステータスと項目を定義します。工程ごとに必要な流れや、優先度、担当、期限などを設定できます。

定義を変更した結果、既存チケットのステータスや項目と食い違っても、Vellymはすべて警告として扱います。チケットは読める状態、編集できる状態を保ち、値を勝手に削除しません。
`select`や`multiselect`の選択肢にない値も警告され、保持されます。

親子関係を使う場合は`reference`型の項目を追加し、設定画面の「親を指す参照項目」で選びます。`@vellym/wbs`を導入すると、その定義に基づく階層をWBS画面で表示できます。循環や見つからない親は警告として示し、チケットは消しません。親を選ばないTrackerの挙動は変わりません。

## YAMLで直接書く

チケットの正本はYAMLファイルです。画面を使わず、エディタや外部のAIエージェントから直接書いても、画面から作ったものと区別されません。

### TicketTracker

フォルダ直下へ1ファイル置きます。ファイル名は自由に決めて構いません。

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
    - { id: parent, label: 親チケット, type: reference }
    - id: estimate
      label: 見積
      type: number
      sort: true  # 一覧の列にはせず、並べ替えにだけ使う
  defaultSort:
    field: estimate
    direction: desc
  hierarchy:
    parentField: parent
```

- `statuses[]`は`id`／`label`／`category`が必須です。`category`は`open`と`closed`の2値だけで、他の値を書いたその要素は読み飛ばされます。
- **配列の先頭が新規作成時の初期値**になり、配列順がそのまま表示順になります。初期値を指定するキーはありません。並べ替えて変えます。
- `fields[]`は`id`／`label`／`type`が必須です。`required`と`listColumn`は省略すると`false`です。
- `required`は**画面から新しく作るときだけ**入力を強制します。既存チケットの編集も、手書きのYAMLも止めません。
- 一覧への参加は列（`listColumn`）・絞り込み（`filter`）・並べ替え（`sort`）を別々に宣言します。`filter`と`sort`を省略すると`listColumn`と同じになります。`listColumn`なしで`filter`か`sort`を宣言した項目は、表に列を出さないまま、絞り込みと並べ替えの選択に使えます。
- `spec.defaultSort: { field: <項目ID>, direction: asc|desc }`は一覧を開いたときの並べ替えです。列に出していない項目でも、並べ替えを有効にしていれば指定できます。`direction`の省略時は`asc`。存在しない項目や並べ替えが無効な項目を指すと警告になり、一覧は今までどおりタイトルの昇順で開きます。個人設定で並べ替えを変えた場合はそちらが優先されます。

### Ticket

Trackerのフォルダか、その子孫へ置きます。既定の保存先は`<Trackerのフォルダ>/+tickets/`です。

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
    parent: ticket-01m0m000000000000000000001
  blocks:
    - id: description
      type: rich-text
      content: |
        アウトラインが深くなりすぎて、右の見出し一覧が読みにくい。
```

- `spec.status`は所有Trackerの`statuses[].id`を指します。
- `spec.fields`は**`fields[].id`をキーにしたmap**です。Trackerのような配列ではありません。
- `spec.blocks`はPageと同じ形で、本文をここへ書きます。
- `metadata.labels`は`kind`に依存しない分類軸で、一覧の絞り込みに使えます。Trackerの`fields`とは別のものです。
- `metadata.name`は小文字英数と`-`を使います。画面が作るチケットは`ticket-<小文字ULID>`で、ファイル名も同じにします。手書きでも揃えるとファイルがおおよそ作成順に並び、Gitの差分が読みやすくなります。

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

識別子は**`multiselect`であり、`multi-select`ではありません**。

型に合わない値も、Vellymは削除せず警告として表示します。定義を1つ変えただけで大量のチケットが編集不能になるのを避けるためです。

機械検証には次のJSON Schemaを使えます。

- <https://vellym.tasclub.com/schemas/v1/ticket.schema.json>
- <https://vellym.tasclub.com/schemas/v1/ticket-tracker.schema.json>

## プラグインを外す

`vellym.config.yaml`の`plugins`から`@vellym/tickets`を外すと、チケット一覧と専用の設定画面は表示されなくなります。`Ticket`と`TicketTracker`のYAMLは変更も削除もされず、本文は引き続き読み込まれ、全文検索と内部リンクから利用できます。Vellymがその`kind`を解釈できないことはエラーにはなりません。

## ライセンス

MIT

[English user guide](https://vellym.tasclub.com/en/) | [日本語の利用ガイド](https://vellym.tasclub.com/)
