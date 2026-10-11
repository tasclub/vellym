# @vellym/wbs

`TicketTracker`のチケットを親子階層と日程で表示するVellymプラグインです。
`@vellym/tickets`なしでも使えます。WBS専用のリソース・自前タスク・配置レコードは作りません。

```yaml
plugins:
  - "@vellym/wbs"
```

チケット管理（`TicketTracker`）を開くとWBSが表示されます。
`@vellym/tickets`や`@vellym/kanban`も導入すると、同じ入口からビューを切り替えられます。

```yaml
apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: project-tickets, title: 開発計画 }
spec:
  statuses:
    - { id: todo, label: 未着手, category: open }
    - { id: done, label: 完了, category: closed }
  fields:
    - { id: parent, label: 親チケット, type: reference }
    - { id: start, label: 開始, type: date }
    - { id: due, label: 終了, type: date }
    - { id: sequence, label: 順序, type: number }
  hierarchy:
    parentField: parent
  wbs:
    startField: start
    endField: due
    orderField: sequence
```

チケットは`spec.fields.parent`に親の`metadata.name`を入れます。
`spec.wbs.parentField`で親の参照項目を指定することもできます。
日程・順序に使う項目はチケット管理の定義にある型から選びます。
親の変更や順序の変更は操作したチケットだけを保存します。
一覧・カンバンと同じ上部の「チケットを作成」または各行の「子タスクを追加」から、ホストのチケット作成経路で
新規チケットの編集を始められます。最初の保存まで正本ファイルを作りません。
同じ階層の順序はドラッグハンドルで変更します（キーボードではハンドルにフォーカスし
`Alt + ↑ / ↓`）。上下のボタンは表示しません。
右側の日付タイムラインは表示対象全件の開始・終了から既定範囲を決めます。
表示開始・終了と日／週の目盛りを変更でき、範囲外の行は方向を示します。
目盛りが重ならないよう、日表示は最大31日、週表示は最大182日で区切り、
より先を見る場合は表示開始日を進めます。
日程の無い行も残します。親の変更は各行の「親を変更」から開けます。
「順序を振り直す」は対象件数を示して確認後に1件ずつ順次保存します。
静的出力は閲覧のみです。親・日程が未設定のチケットも表示されます。
