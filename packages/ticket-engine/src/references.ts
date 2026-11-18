import type {
  PluginDefinitionContext,
  PluginDiagnostic,
  PluginIndexRow
} from "@vellym/plugin-api";
import { readTrackers } from "./definitions.js";
import { buildTicketHierarchy } from "./hierarchy.js";
import { fieldKey, TRACKER_KEY, TRACKERS_KEY } from "./projection.js";

/**
 * 同じTrackerの一覧に出る行か（`values.trackers`に名前を含むか）。
 *
 * 一覧・カンバン・WBSはこれで絞られる。参照の解決も同じ顔ぶれに対して行い、
 * 画面に見える行と警告の基準をずれさせない。
 */
function listedIn(row: PluginIndexRow, trackerName: string): boolean {
  const listed = row.values[TRACKERS_KEY];
  if (Array.isArray(listed)) return listed.includes(trackerName);
  // `trackers`を載せない行（古い索引など）は、所有者と同じTrackerにだけ出す。
  return row.values[TRACKER_KEY] === trackerName;
}

/** 索引行の項目値。文字と文字列の配列の両方を受け取る */
function referenceValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

/**
 * チケットをまたぐ参照を検査する。索引行がすべてそろった後に1回呼ばれる。
 *
 * projectorはレコード1件ずつしか見えないため、参照先の存在や循環は
 * ここでしか書けない。WBS画面が`buildTicketHierarchy`から得ていた
 * 親の警告（`TICKET_PARENT_UNRESOLVED`・`TICKET_PARENT_CYCLE`）は、
 * validateと画面の両方に出すためここでも返す。画面側は今までどおり
 * `buildTicketHierarchy`を使ってよい。
 *
 * Trackerごとに分けて検査する。
 *
 * - 解決の顔ぶれは「そのTrackerの一覧に出る行」。画面と同じ基準である。
 * - 診断を出すのは**定義を与える所有者**（`values.tracker`）のTrackerだけ。
 *   祖先のTrackerの一覧にも同じ行は出るが、同じチケットへ二重に警告しない。
 * - `reference`項目のうち、Trackerが`hierarchy.parentField`に選んだ項目は
 *   親として検査し、残りは参照として検査する。
 *
 * 例外にはしない。壊れた定義や行は読み飛ばし、読めた分だけ警告する
 * （`readTrackers`と同じ方針）。
 */
export function validateTicketReferences(
  rows: readonly PluginIndexRow[],
  context: PluginDefinitionContext
): readonly PluginDiagnostic[] {
  const trackers = readTrackers(context);
  const diagnostics: PluginDiagnostic[] = [];

  for (const tracker of trackers) {
    // 解決の顔ぶれ（一覧に出る行）と、このTrackerが定義を与える行。
    const listed = rows.filter((row) => listedIn(row, tracker.name));
    const owned = listed.filter((row) => row.values[TRACKER_KEY] === tracker.name);
    if (!listed.length) continue;
    const names = new Set(listed.map((row) => row.name));
    const ownedNames = new Set(owned.map((row) => row.name));

    // 親: 既存の階層検査の診断をそのまま使う。所有者の行だけ残すのは
    // 祖先のTrackerと同じチケットを2度数えないためである。
    const hierarchy = buildTicketHierarchy(tracker, listed);
    for (const diagnostic of hierarchy.diagnostics) {
      if (ownedNames.has(diagnostic.file)) diagnostics.push(diagnostic);
    }

    // 参照（親項目以外）。参照先はこのTrackerの一覧にあるTicket。
    for (const field of tracker.fields) {
      if (field.type !== "reference" || field.id === tracker.parentField) continue;
      for (const row of owned) {
        for (const target of referenceValues(row.values[fieldKey(field.id)])) {
          if (!target) continue;
          if (target === row.name) {
            diagnostics.push({
              file: row.name,
              path: `/spec/fields/${field.id}`,
              severity: "warning",
              code: "TICKET_REFERENCE_SELF",
              message: {
                ja: `自分自身を参照しています: ${target}`,
                en: `The reference points to this ticket itself: ${target}`
              }
            });
          } else if (!names.has(target)) {
            diagnostics.push({
              file: row.name,
              path: `/spec/fields/${field.id}`,
              severity: "warning",
              code: "TICKET_REFERENCE_UNRESOLVED",
              message: {
                ja: `参照先のチケットが見つかりません: ${target}`,
                en: `Referenced ticket not found: ${target}`
              }
            });
          }
        }
      }
    }
  }

  return diagnostics;
}
