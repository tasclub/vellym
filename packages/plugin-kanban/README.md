# @vellym/kanban

[English](#english) | [日本語](#日本語)

## English

A Vellym plugin that displays `TicketTracker` tickets on a Kanban board. It can be installed independently of `@vellym/tickets`. It adds no Kanban-specific resource; open a ticket tracker and switch between its list and Kanban views.

English user guide: <https://vellym.tasclub.com/en/>

```yaml
plugins:
  - "@vellym/kanban"
```

The ticket-management YAML remains unchanged:

```yaml
apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: quality-tickets
  title: Quality tickets
spec:
  statuses:
    - { id: todo, label: To do, category: open }
    - { id: doing, label: In progress, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - { id: priority, label: Priority, type: select, options: [{ value: high, label: High }] }
    - { id: estimate, label: Estimate, type: number }
    - { id: order, label: Order, type: number }
  kanban:
    card: [priority, estimate]
    summary:
      - { field: estimate, method: sum }
    orderField: order
```

When Kanban is the only view plugin installed, opening a ticket tracker shows the Kanban board. With `@vellym/tickets` installed as well, you can switch between the list and Kanban views from the same tracker. Columns follow the tracker's status definition order. Unset and out-of-definition statuses appear in their own columns.

`spec.kanban` is optional. `card` lists defined field IDs to show on cards; `summary` configures per-column aggregates. Numbers support `sum`, `average`, `max`, `min`, and `count`; dates support `earliest`, `latest`, and `count`; booleans support `true` and `false`; text, select, and reference fields support `count` and `breakdown`.

`orderField` refers to a defined numeric field. If omitted, the plugin uses a numeric field whose ID is `order`, when present. The order is saved to `Ticket.spec.fields.<id>` one ticket at a time. The **Reassign order** action is the only operation that updates multiple tickets in sequence, after confirmation.

Each column shows up to 20 tickets by default; the user can explicitly reveal the rest. Without filters, column counts and summaries cover every ticket; while filtering, they cover every matching ticket.

Fields marked `listColumn: true` in the tracker can be used to filter tickets through FILTER. Select options use exact matches; text input uses a case-insensitive substring match. Columns remain visible when empty during filtering. Column selection, ordering, filter criteria, and whether FILTER is open are personal settings for each tracker.

Set `spec.summary` on the Tracker, for example `[{ field: priority, method: breakdown }]`. When present, `spec.kanban.summary` takes precedence; existing configurations remain supported.

Use `{ field: estimate, method: sum, groupBy: sprint }` in `spec.summary` to group by a select, multiselect, reference, or text field. Missing values are grouped together; multiselect values contribute to each group.

## 日本語

`TicketTracker`のチケットをカンバンで表示するVellymプラグインです。`@vellym/tickets`とは独立して導入できます。カンバン専用のリソースは作らず、チケット管理を開いて一覧とカンバンを切り替えます。

日本語の利用ガイド: <https://vellym.tasclub.com/>

```yaml
plugins:
  - "@vellym/kanban"
```

チケット管理のYAMLは従来どおりです。

```yaml
apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata:
  name: quality-tickets
  title: 品質チケット
spec:
  statuses:
    - { id: todo, label: 未着手, category: open }
    - { id: doing, label: 対応中, category: open }
    - { id: done, label: 完了, category: closed }
  fields:
    - { id: priority, label: 優先度, type: select, options: [{ value: high, label: 高 }] }
    - { id: estimate, label: 見積, type: number }
    - { id: order, label: 順序, type: number }
  kanban:
    card: [priority, estimate]
    summary:
      - { field: estimate, method: sum }
    orderField: order
```

カンバンだけを導入した場合はチケット管理を開くとカンバンが表示されます。`@vellym/tickets`も導入すると、同じチケット管理から一覧とカンバンを切り替えられます。列はTrackerのstatus定義順です。未設定値と定義外値も独立した列に表示します。

`spec.kanban`は任意です。`card`はカードに表示する定義済み項目のID、`summary`は列ごとの集計です。数値は`sum` / `average` / `max` / `min` / `count`、日付は`earliest` / `latest` / `count`、真偽は`true` / `false`、テキスト・選択・参照は`count` / `breakdown`を使えます。

`orderField`は定義済みの数値項目を指します。指定しない場合はIDが`order`の数値項目があれば使用します。順序はTicketの`spec.fields.<id>`へ1件ずつ保存され、列の「順序を振り直す」操作のみ確認後に複数件を順次更新します。

列内の表示は既定で20件までです。残りは明示的な操作で表示できます。絞り込みが無ければ列の件数と集計は全件を対象とし、有効時は一致した全件を対象にします。

Trackerで一覧列（`listColumn: true`）に指定した項目は、FILTERからチケットを絞り込めます。選択肢は完全一致、文字入力は大文字小文字を区別しない部分一致です。絞り込み中も列は消えず、0件の列として残ります。列の選択・並べ替え・絞り込み条件とFILTERの開閉状態はtrackerごとの個人設定です。


Trackerの `spec.summary` に `[{ field: priority, method: breakdown }]` を指定できます。`spec.kanban.summary` がある場合はそちらを優先し、既存の設定も引き続き使えます。

`spec.summary` に `{ field: estimate, method: sum, groupBy: sprint }` と書くと、select・multiselect・reference・text の値ごとに集計します。未設定はまとめ、multiselect は各値に重複計上します。
