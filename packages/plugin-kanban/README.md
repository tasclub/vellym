# @vellym/kanban

`TicketTracker`のチケットをカンバンで表示するVellymプラグインです。
`@vellym/tickets`とは独立して導入できます。カンバン専用のリソースは作らず、
チケット管理を開いて一覧とカンバンを切り替えます。

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

カンバンだけを導入した場合はチケット管理を開くとカンバンが表示されます。
`@vellym/tickets`も導入すると、同じチケット管理から一覧とカンバンを切り替えられます。
列はTrackerのstatus定義順です。未設定値と定義外値も独立した列に表示します。

`spec.kanban`は任意です。`card`はカードに表示する定義済み項目のID、
`summary`は列ごとの集計です。数値は`sum` / `average` / `max` / `min` / `count`、
日付は`earliest` / `latest` / `count`、真偽は`true` / `false`、
テキスト・選択・参照は`count` / `breakdown`を使えます。
`orderField`は定義済みの数値項目を指します。指定しない場合はIDが`order`の
数値項目があれば使用します。順序はTicketの`spec.fields.<id>`へ1件ずつ保存され、
列の「順序を振り直す」操作のみ確認後に複数件を順次更新します。
列内の表示は既定で20件までです。残りは明示的な操作で表示できます。絞り込みが
無ければ列の件数と集計は全件を対象とし、有効時は一致した全件を対象にします。
Trackerで一覧列（`listColumn: true`）に
指定した項目は、FILTERからチケットを絞り込めます。選択肢は完全一致、文字入力は
大文字小文字を区別しない部分一致です。絞り込み中も列は消えず、0件の列として残ります。
列の選択・並べ替え・絞り込み条件とFILTERの開閉状態はtrackerごとの個人設定です。
