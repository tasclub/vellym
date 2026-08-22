import type {
  PluginDiagnostic,
  PluginIndexValue,
  PluginRecordProjection,
  PluginResourceRecord
} from "@vellym/plugin-api";
import {
  fieldById,
  isExcluded,
  statusById,
  trackersFor,
  type FieldDefinition,
  type Tracker
} from "./definitions.js";

/** 索引行のキー */
/** 定義を与える所有者。最も近い祖先 */
export const TRACKER_KEY = "tracker";
/** 上位すべて。一覧はこれで絞るため、子フォルダのチケットが親の一覧にも出る */
export const TRACKERS_KEY = "trackers";
export const STATUS_KEY = "status";
/** 利用者が定義した項目の索引行キーに付ける接頭辞 */
export const FIELD_KEY_PREFIX = "field:";
export const fieldKey = (id: string): string => `${FIELD_KEY_PREFIX}${id}`;
/** `metadata.labels`を`キー=値`の並びで持つ。絞り込みは部分一致で行う */
export const LABELS_KEY = "labels";

/** ステータスが書かれていないチケットを束ねる値 */
export const STATUS_UNSET = "";
/** どのチケット管理にも属さないチケットを束ねる値 */
export const TRACKER_NONE = "";

function warn(
  record: PluginResourceRecord,
  path: string,
  code: string,
  message: string
): PluginDiagnostic {
  return { file: record.relativePath, path, severity: "warning", code, message };
}

/**
 * 値が定義の型に合うか。合わない値も保持し、警告にとどめる。
 * 定義を1つ変えただけで大量のチケットが編集不能になるのを避ける。
 */
function matchesType(field: FieldDefinition, value: unknown): boolean {
  switch (field.type) {
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "multiselect":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    default:
      return typeof value === "string";
  }
}

/** 索引行に載せられる形へ落とす。載らない値は文字列にする */
function toIndexValue(value: unknown): PluginIndexValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return JSON.stringify(value) ?? "";
}

/**
 * チケット1件を索引行へ落とす。
 *
 * 引数の`record`は保持しない。必要な値だけを複写する。2万件のチケットの
 * `spec`が常駐しないための約束である。
 */
export function projectTicket(
  trackers: readonly Tracker[],
  record: PluginResourceRecord
): PluginRecordProjection | undefined {
  // `_`始まりのフォルダ配下は対象外。索引に載せず、警告も出さない。
  // 残しておきたいが、どの一覧にも出したくないチケットの逃げ道である。
  if (isExcluded(record.relativePath)) return undefined;

  const diagnostics: PluginDiagnostic[] = [];
  const values: Record<string, PluginIndexValue> = {};

  // 所属は置き場所で決まる。定義を与えるのは最も近い祖先だけだが、
  // 一覧には上位のものにも出す。任意の属性でフォルダ分けしたときに、
  // 親の一覧から見えなくならないようにするためである。
  const owners = trackersFor(trackers, record.relativePath);
  const tracker = owners[0];
  values[TRACKER_KEY] = tracker?.name ?? TRACKER_NONE;
  values[TRACKERS_KEY] = owners.map((item) => item.name);
  if (!tracker) {
    diagnostics.push(
      warn(
        record,
        "/kind",
        "TICKET_TRACKER_MISSING",
        "上位にTicketTrackerが無いため、どのチケット一覧にも出ません"
      )
    );
  }

  // `metadata.labels`はkind非依存の分類軸。一覧の絞り込みに使えるよう索引へ載せる。
  // どんなキーが使われているかは定義から分からないため、列をキーごとに立てず、
  // `キー=値`を並べた1つの値にする。絞り込みは部分一致で行う。
  const labels = Object.entries(record.labels ?? {});
  if (labels.length) {
    values[LABELS_KEY] = labels.map(([key, value]) => `${key}=${value}`);
  }

  const status = record.spec.status;
  if (status === undefined) {
    values[STATUS_KEY] = STATUS_UNSET;
    diagnostics.push(
      warn(record, "/spec/status", "TICKET_STATUS_MISSING", "ステータスが設定されていません")
    );
  } else if (typeof status !== "string") {
    values[STATUS_KEY] = toIndexValue(status);
    diagnostics.push(
      warn(record, "/spec/status", "TICKET_STATUS_INVALID", "ステータスが文字列ではありません")
    );
  } else {
    values[STATUS_KEY] = status;
    // 所属が無ければ定義も無い。「定義外」とは言えない。
    if (tracker && tracker.statuses.length > 0 && !statusById(tracker, status)) {
      diagnostics.push(
        warn(
          record,
          "/spec/status",
          "TICKET_STATUS_UNDEFINED",
          `${tracker.title}の定義に無いステータスです: ${status}`
        )
      );
    }
  }

  const fields = record.spec.fields;
  const entries =
    typeof fields === "object" && fields !== null && !Array.isArray(fields)
      ? Object.entries(fields as Record<string, unknown>)
      : [];
  if (fields !== undefined && typeof fields !== "object") {
    diagnostics.push(
      warn(record, "/spec/fields", "TICKET_FIELDS_INVALID", "fieldsが対応表ではありません")
    );
  }

  for (const [id, value] of entries) {
    values[fieldKey(id)] = toIndexValue(value);
    if (!tracker) continue;
    const definition = fieldById(tracker, id);
    if (!definition) {
      if (tracker.fields.length > 0) {
        diagnostics.push(
          warn(
            record,
            `/spec/fields/${id}`,
            "TICKET_FIELD_UNDEFINED",
            `${tracker.title}の定義に無い項目です: ${id}`
          )
        );
      }
      continue;
    }
    if (!matchesType(definition, value)) {
      diagnostics.push(
        warn(
          record,
          `/spec/fields/${id}`,
          "TICKET_FIELD_TYPE_MISMATCH",
          `項目の型が定義と合いません: ${id}（定義: ${definition.type}）`
        )
      );
    }
  }

  for (const field of tracker?.fields ?? []) {
    if (!field.required) continue;
    const value = entries.find(([id]) => id === field.id)?.[1];
    if (value === undefined || value === null || value === "") {
      diagnostics.push(
        warn(
          record,
          `/spec/fields/${field.id}`,
          "TICKET_FIELD_REQUIRED_MISSING",
          `必須の項目が空です: ${field.id}`
        )
      );
    }
  }

  return diagnostics.length ? { values, diagnostics } : { values };
}
