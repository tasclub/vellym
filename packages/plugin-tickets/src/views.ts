import type {
  PluginColumnDescriptor,
  PluginDetailViewDescriptor,
  PluginFieldDescriptor,
  PluginListViewDescriptor,
  PluginSelectOption,
  PluginValueType,
  PluginViewContext
} from "@vellym/plugin-api";
import { readTrackers, trackerFor, type Tracker } from "./definitions.js";
import {
  FIELD_KEY_PREFIX,
  LABELS_KEY,
  STATUS_KEY,
  TRACKERS_KEY,
  fieldKey
} from "./projection.js";

export const LIST_VIEW_ID = "ticket-list";
export const DETAIL_VIEW_ID = "ticket-detail";
export const SETTINGS_VIEW_ID = "ticket-tracker-settings";
export const CREATE_COMMAND_ID = "ticket.create";
export const CREATE_TRACKER_COMMAND_ID = "ticket.create-tracker";

/**
 * ステータスの選択肢。記号は`category`からだけ決める。
 *
 * ステータスごとの記号を推測しない。利用者が付けた表示名から意味を読み取ると、
 * 「保留」を完了として扱うような誤りが起きる。プラグインが知っているのは
 * 未完了か完了かの2値だけである。
 */
function statusOptions(tracker: Tracker): PluginSelectOption[] {
  return tracker.statuses.map((status) => ({
    value: status.id,
    label: status.label,
    symbol: status.category === "closed" ? "✓" : "□"
  }));
}

/**
 * 開いているチケット管理を決める。
 *
 * 一覧なら`target`がその`TicketTracker`、詳細なら`target`がチケットなので、
 * その置き場所から所属を引く。
 */
function trackerOf(context: PluginViewContext): Tracker | undefined {
  const trackers = readTrackers(context);
  const target = context.target;
  if (!target) return trackers[0];
  if (target.kind === "TicketTracker") {
    return trackers.find((tracker) => tracker.name === target.name);
  }
  return trackerFor(trackers, target.relativePath);
}

/**
 * 一覧のdescriptor。列は開いているチケット管理の定義から作る。
 *
 * 定義が空でも一覧は出す。タイトルだけの表になり、定義の作成へ誘導する。
 * エラー画面にしない。
 */
export function ticketListView(context: PluginViewContext): PluginListViewDescriptor {
  const tracker = trackerOf(context);
  const columns: PluginColumnDescriptor[] = [
    {
      id: "title",
      label: { ja: "タイトル", en: "Title" },
      type: "text",
      sortable: true
    }
  ];
  if (tracker && tracker.statuses.length) {
    columns.push({
      id: STATUS_KEY,
      label: { ja: "ステータス", en: "Status" },
      type: "select",
      options: statusOptions(tracker),
      sortable: true,
      filterable: true,
      // まとめて変えられるのはステータスと単一選択まで。自由入力は対象にしない。
      editPath: ["status"]
    });
  }
  // 列にするのは`listColumn`を宣言した項目だけ。項目が増えても一覧が
  // 横に伸び続けないようにする。宣言の無い項目は詳細で読む。
  for (const field of tracker?.fields ?? []) {
    if (!field.listColumn) continue;
    columns.push({
      id: fieldKey(field.id),
      label: field.label,
      type: field.type,
      ...(field.options ? { options: field.options } : {}),
      sortable: true,
      filterable: true,
      ...(field.type === "select" ? { editPath: ["fields", field.id] } : {})
    });
  }
  // 既定で隠すのは完了だけとする。未設定も定義外も「まだ終わっていないもの」であり、
  // 数え上げ漏れで一覧から消えてはならない。
  const closed = (tracker?.statuses ?? [])
    .filter((status) => status.category === "closed")
    .map((status) => status.id);

  // ラベルはkind非依存の分類軸であり、どんなキーが使われるかは定義から分からない。
  // 列を増やさずに畳んで見せ、絞り込みだけできるようにする。
  columns.push({
    id: LABELS_KEY,
    label: { ja: "ラベル", en: "Labels" },
    type: "multiselect",
    filterable: true,
    secondary: true
  });


  return {
    type: "list",
    id: LIST_VIEW_ID,
    kind: "Ticket",
    title: tracker?.title ?? { ja: "チケット", en: "Tickets" },
    columns,
    defaultSort: { columnId: "title", direction: "asc" },
    // 他の工程のチケットを混ぜない。これは利用者が外せない。
    // 子フォルダに別のチケット管理があっても、そこのチケットはここにも出る。
    scopeFilters: [
      { columnId: TRACKERS_KEY, operator: "contains", value: tracker?.name ?? "" }
    ],
    // 既定は完了を除く。ステータスの列の絞り込みは単一選択なので、
    // 「未完了のみ」という複数ステータスの束はそちらでは表せない。
    // 切替は列の絞り込みと同じ帯へ置き、文言で今の表示内容を示す。
    ...(closed.length
      ? {
          defaultFilters: [
            {
              columnId: STATUS_KEY,
              operator: "not-in" as const,
              value: closed,
              toggleLabels: {
                applied: { ja: "未完了のみ", en: "Open only" },
                cleared: { ja: "すべて表示中", en: "Showing all" }
              }
            }
          ]
        }
      : {}),
    emptyState:
      tracker && tracker.statuses.length
        ? {
            message: { ja: "チケットがありません", en: "No tickets yet" },
            ...(context.isStatic ? {} : { commandId: CREATE_COMMAND_ID })
          }
        : {
            message: {
              ja: "このチケット管理にはまだステータスが定義されていません",
              en: "This tracker has no statuses defined yet"
            }
          }
  };
}

/**
 * 詳細のdescriptor。ステータスと項目を上部に、説明本文をその下に置く。
 * 本文は通常のPage編集と同じ経路を使うため`body: "blocks"`とだけ宣言する。
 */
export function ticketDetailView(context: PluginViewContext): PluginDetailViewDescriptor {
  const tracker = trackerOf(context);
  const fields: PluginFieldDescriptor[] = [];
  if (tracker && tracker.statuses.length) {
    fields.push({
      id: STATUS_KEY,
      label: { ja: "ステータス", en: "Status" },
      type: "select",
      path: ["status"],
      valueKey: STATUS_KEY,
      options: statusOptions(tracker)
    });
  }
  for (const field of tracker?.fields ?? []) {
    fields.push({
      id: field.id,
      label: field.label,
      type: field.type,
      path: ["fields", field.id],
      valueKey: fieldKey(field.id),
      ...(field.options ? { options: field.options } : {}),
      ...(field.required ? { required: true } : {})
    });
  }
  return {
    type: "detail",
    id: DETAIL_VIEW_ID,
    kind: "Ticket",
    fields,
    body: "blocks",
    // 定義から消えた項目の値も見せる。勝手に消さない。
    undeclaredFields: "read-only",
    // 索引行のうち、利用者が定義した項目はこの接頭辞を持つ。
    undeclaredKeyPrefix: FIELD_KEY_PREFIX,
    // 保存したら、属するチケット管理の一覧へ戻る。
    ...(tracker ? { parent: { name: tracker.name, title: tracker.title } } : {})
  };
}


/** 項目の型の選択肢。プラグインが対応する8種をそのまま出す */
const TYPE_OPTIONS: PluginSelectOption[] = (
  [
    ["text", "一行テキスト", "Text"],
    ["multiline", "複数行テキスト", "Multiline"],
    ["number", "数値", "Number"],
    ["boolean", "真偽値", "Boolean"],
    ["date", "日付", "Date"],
    ["select", "単一選択", "Select"],
    ["multiselect", "複数選択", "Multi-select"],
    ["reference", "Page参照", "Reference"]
  ] as Array<[PluginValueType, string, string]>
).map(([value, ja, en]) => ({ value, label: { ja, en } }));

/**
 * チケット管理そのものの設定。ステータスと項目の定義を編集する。
 *
 * 定義は正本YAMLなので、保存はCoreの保存経路を通る。設定画面と文書編集の
 * 中間のような画面になるが、専用の保存経路は作らない。
 */
export function ticketTrackerSettingsView(
  context: PluginViewContext
): PluginDetailViewDescriptor {
  const tracker = trackerOf(context);
  return {
    type: "detail",
    id: SETTINGS_VIEW_ID,
    kind: "TicketTracker",
    body: "none",
    undeclaredFields: "read-only",
    fields: [
      {
        id: "statuses",
        type: "group",
        label: { ja: "ステータス", en: "Statuses" },
        path: ["statuses"],
        addLabel: { ja: "ステータスを追加", en: "Add status" },
        description: {
          ja: "idは不変の識別子。既存チケットが指す値なので、変えると定義外になります。先頭が新しいチケットの初期値になります",
          en: "The id is permanent; existing tickets point at it. The first row is the initial status for new tickets."
        },
        fields: [
          { id: "id", label: { ja: "ID", en: "ID" }, type: "text", path: ["id"], required: true },
          {
            id: "label",
            label: { ja: "表示名", en: "Label" },
            type: "text",
            path: ["label"],
            required: true
          },
          {
            id: "category",
            label: { ja: "区分", en: "Category" },
            type: "select",
            path: ["category"],
            required: true,
            options: [
              { value: "open", label: { ja: "未完了", en: "Open" } },
              { value: "closed", label: { ja: "完了", en: "Closed" } }
            ]
          }
        ]
      },
      {
        id: "fields",
        type: "group",
        label: { ja: "項目", en: "Fields" },
        path: ["fields"],
        addLabel: { ja: "項目を追加", en: "Add field" },
        description: {
          ja: "並び順が表示順です。単一選択の初期値は選択肢の先頭になります",
          en: "The order here is the display order. The first option is the initial value."
        },
        fields: [
          { id: "id", label: { ja: "ID", en: "ID" }, type: "text", path: ["id"], required: true },
          {
            id: "label",
            label: { ja: "表示名", en: "Label" },
            type: "text",
            path: ["label"],
            required: true
          },
          {
            id: "type",
            label: { ja: "型", en: "Type" },
            type: "select",
            path: ["type"],
            required: true,
            options: TYPE_OPTIONS
          },
          {
            id: "required",
            label: { ja: "必須", en: "Required" },
            type: "boolean",
            path: ["required"],
            description: {
              ja: "新しく作るときだけ入力を求めます。既存チケットの編集は止めません",
              en: "Only enforced when creating. Editing existing tickets is never blocked."
            }
          },
          {
            id: "listColumn",
            label: { ja: "一覧に出す", en: "Show in list" },
            type: "boolean",
            path: ["listColumn"]
          }
        ]
      }
    ],
    ...(tracker ? { parent: { name: tracker.name, title: tracker.title } } : {})
  };
}
