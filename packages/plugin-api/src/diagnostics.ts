/**
 * プラグインが利用者へ伝える診断。
 *
 * Coreの`Diagnostic`と同じ形にしてあるが、**Coreの型を再輸出しない**。
 * 契約パッケージがCoreへ依存すると、内部実装が公開契約に変わってしまう。
 * 構造が一致していることは`tests/plugin-api.test.ts`が型で固定する。
 */
export type PluginDiagnosticSeverity = "warning" | "error";

export interface PluginDiagnostic {
  /** content root相対のファイル位置。プラグインは絶対pathを受け取らない */
  file: string;
  /** リソース内の位置。JSON Pointer形式（例 `/spec/status`） */
  path?: string;
  severity: PluginDiagnosticSeverity;
  /** プラグインIDを前置した安定コード（例 `TICKET_STATUS_UNDEFINED`） */
  code: string;
  message: string;
}
