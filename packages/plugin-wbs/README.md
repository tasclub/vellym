# @vellym/wbs

[English](#english) | [日本語](#日本語)

## English

A Vellym plugin that displays `TicketTracker` tickets as a parent-child hierarchy with dates. It works without `@vellym/tickets` and creates no WBS-specific resources, tasks, or placement records.

English user guide: <https://vellym.tasclub.com/en/>

```yaml
plugins:
  - "@vellym/wbs"
```

Open a ticket tracker (`TicketTracker`) to see the WBS. If `@vellym/tickets` or `@vellym/kanban` is also installed, you can switch views from the same entry point.

Configure `spec.summary`, for example `[{ field: sequence, method: sum }]`, to show totals for all WBS tickets, including collapsed and attention-needed rows, in both live and static views. Invalid values are reported as excluded; there are no per-parent subtotals.

```yaml
apiVersion: vellym.tasclub.com/v1
kind: TicketTracker
metadata: { name: project-tickets, title: Development plan }
spec:
  statuses:
    - { id: todo, label: To do, category: open }
    - { id: done, label: Done, category: closed }
  fields:
    - { id: parent, label: Parent ticket, type: reference }
    - { id: start, label: Start date, type: date }
    - { id: due, label: End date, type: date }
    - { id: sequence, label: Order, type: number }
  hierarchy:
    parentField: parent
  wbs:
    startField: start
    endField: due
    orderField: sequence
```

Set `spec.fields.parent` on each ticket to its parent's `metadata.name`. You can also specify the parent reference field in `spec.wbs.parentField`. Choose fields for dates and ordering from the types declared in the ticket tracker. Changing a parent or an order saves only the ticket you changed.

Start creating a ticket from the shared **New ticket** action above the list or Kanban, or from **Add child task** on a row. The host's normal ticket-creation flow opens the editor; no source file is created until the first save.

Reorder tickets at the same hierarchy level with the drag handle (`Alt` + `↑` / `↓` on the keyboard). There are no up/down buttons.

The date timeline on the right calculates its default range from the start and end dates of all visible tickets. Change the start and end dates and switch between day and week scales. Rows outside the range show which direction they are in. To prevent tick labels from overlapping, day view is limited to 31 days and week view to 182 days; advance the start date to see further ahead.

Tickets without dates remain visible. Change a parent from **Change parent** on its row. **Reassign order** reports the number of affected tickets, asks for confirmation, then saves each ticket in sequence. Static output is read-only. Tickets without a parent or dates are still shown.

## 日本語

`TicketTracker`のチケットを親子階層と日程で表示するVellymプラグインです。`@vellym/tickets`なしでも使えます。WBS専用のリソース・自前タスク・配置レコードは作りません。

日本語の利用ガイド: <https://vellym.tasclub.com/>

```yaml
plugins:
  - "@vellym/wbs"
```

チケット管理（`TicketTracker`）を開くとWBSが表示されます。`@vellym/tickets`や`@vellym/kanban`も導入すると、同じ入口からビューを切り替えられます。

`spec.summary`（例: `[{ field: sequence, method: sum }]`）を指定すると、折りたたみ中や要確認の行を含むWBSの全チケットの集計を、通常画面と静的出力に表示します。型が合わない値は除外件数を示します。親ごとの小計はありません。

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

チケットは`spec.fields.parent`に親の`metadata.name`を入れます。`spec.wbs.parentField`で親の参照項目を指定することもできます。日程・順序に使う項目はチケット管理の定義にある型から選びます。親の変更や順序の変更は操作したチケットだけを保存します。

一覧・カンバンと同じ上部の「チケットを作成」または各行の「子タスクを追加」から、ホストのチケット作成経路で新規チケットの編集を始められます。最初の保存まで正本ファイルを作りません。

同じ階層の順序はドラッグハンドルで変更します（キーボードではハンドルにフォーカスし`Alt + ↑ / ↓`）。上下のボタンは表示しません。

右側の日付タイムラインは表示対象全件の開始・終了から既定範囲を決めます。表示開始・終了と日／週の目盛りを変更でき、範囲外の行は方向を示します。目盛りが重ならないよう、日表示は最大31日、週表示は最大182日で区切り、より先を見る場合は表示開始日を進めます。

日程の無い行も残します。親の変更は各行の「親を変更」から開けます。「順序を振り直す」は対象件数を示して確認後に1件ずつ順次保存します。静的出力は閲覧のみです。親・日程が未設定のチケットも表示されます。
