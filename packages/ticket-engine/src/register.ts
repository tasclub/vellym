import type { VellymPluginHost } from "@vellym/plugin-api";
import { TICKET_KIND, TRACKER_KIND, readTrackers, trackerDefinitionDiagnostics } from "./definitions.js";
import { TICKET_ICON, TICKET_TRACKER_ICON } from "./icons.js";
import { projectTicket } from "./projection.js";
import { validateTicketReferences } from "./references.js";
import { TICKET_SPEC_SCHEMA, TICKET_TRACKER_SPEC_SCHEMA } from "./schemas.js";

/** Ticket kind契約の版。複数プラグインが同梱してもhostが同版として解決する。 */
export const TICKET_ENGINE_VERSION = "1.0.0";

/**
 * ビューを持たない共有エンジンを登録する。
 *
 * 内部パッケージを各公開プラグインのNode bundleへ取り込むため、利用者が
 * `plugins:`へこのパッケージを追加する必要はない。
 */
export function registerTicketEngine(host: VellymPluginHost): void {
  host.registerKind({
    kind: TICKET_KIND,
    engineVersion: TICKET_ENGINE_VERSION,
    specSchema: TICKET_SPEC_SCHEMA,
    showInDocumentTree: false,
    icon: TICKET_ICON
  });
  host.registerKind({
    kind: TRACKER_KIND,
    engineVersion: TICKET_ENGINE_VERSION,
    specSchema: TICKET_TRACKER_SPEC_SCHEMA,
    showInDocumentTree: true,
    hasBlocks: false,
    icon: TICKET_TRACKER_ICON
  });
  host.registerRecordProjection(TICKET_KIND, (context) => {
    for (const diagnostic of trackerDefinitionDiagnostics(context.records(TRACKER_KIND))) {
      context.reportDiagnostic?.(diagnostic);
    }
    const trackers = readTrackers(context);
    return (record) => projectTicket(trackers, record);
  });
  // 行をまたぐ検査（親の未解決・循環、参照の未解決・自分参照）。
  // `registerTicketEngine`は複数プラグインが共有する登録関数なので、
  // ここで渡す関数はモジュール内で1つであり、多重登録してもhostは1回だけ実行する。
  host.registerRecordSetValidator(TICKET_KIND, validateTicketReferences);
}
