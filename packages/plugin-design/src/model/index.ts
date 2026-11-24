import type {
  PluginDefinitionContext,
  PluginDiagnostic,
  PluginResourceRecord
} from "@vellym/plugin-api";

export * from "./types.js";
export * from "./values.js";
export * from "./schema.js";

/**
 * `@vellym/design`の共通モデル。
 *
 * 配置はアートボード側が持つ（`spec.canvas`・`x`・`y`・`w`・`h`）。キャンバスは
 * アートボードを保持しない。1枚動かす保存がそのアートボード1ファイルだけに
 * 収まるようにするためで、作成も`createResource`1件で済む
 * （ticket-01m7j7pmv6hpx9s68hcdc3hzq1「実装方針」）。
 */

export const DESIGN_CANVAS_KIND = "DesignCanvas";
export const DESIGN_BOARD_KIND = "DesignBoard";
export const DESIGN_COMPONENT_KIND = "DesignComponent";
export const DESIGN_STYLES_KIND = "DesignStyles";
export const DESIGN_CANVAS_VIEW_ID = "design-canvas";
export const CREATE_CANVAS_COMMAND_ID = "design.create-canvas";
export const CREATE_BOARD_COMMAND_ID = "design.create-board";

/** 新規アートボードの既定サイズ（モバイル1画面）。 */
export const DEFAULT_BOARD_W = 390;
export const DEFAULT_BOARD_H = 844;
/** 同じキャンバス・同じページで既存のアートボードの右端から空ける距離。 */
export const BOARD_GAP = 80;

/** `rendererData`に載せるアートボード1枚。画面が最小限に読む形 */
export interface DesignBoardRow {
  name: string;
  title: string;
  page?: string;
  order?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** `rendererData`に載せる注意1件。ブラウザ側はlocaleで本文を選ぶ */
export interface DesignNotice {
  code: string;
  file: string;
  ja: string;
  en: string;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** アートボードの`spec.canvas`が指すキャンバス名。無ければ`undefined` */
export function boardCanvasName(board: PluginResourceRecord): string | undefined {
  return stringOf(board.spec.canvas);
}

/** このキャンバスと同じページに属するか。`page`省略は既定ページ同士で揃える */
export function boardPage(board: PluginResourceRecord, page: string | undefined): boolean {
  const value = stringOf(board.spec.page);
  return value === page;
}

interface NoticeSeed {
  file: string;
  path?: string;
  code: string;
  ja: string;
  en: string;
}

function toDiagnostic(seed: NoticeSeed): PluginDiagnostic {
  return {
    file: seed.file,
    ...(seed.path ? { path: seed.path } : {}),
    severity: "warning",
    code: seed.code,
    message: { ja: seed.ja, en: seed.en }
  };
}

/**
 * キャンバスのビューが読むデータ。
 *
 * - `spec.canvas`がそのキャンバスを指す`DesignBoard`を集める
 *   （キャンバス側の`spec.boards`は読まない。配置はアートボード側）
 * - 配置が壊れているアートボード（`x`・`w`などが数値でない）は、
 *   警告を添えたうえで一覧に載せる。読めるものを隠さない
 * - `spec.canvas`が存在しないキャンバスを指すアートボードも警告を出す。
 *   `reportDiagnostic`が生えている文脈（読み込み・定義解決）ではそこに
 *   報告し、ビューの文脈では`notices`だけに残す
 *   （`PluginDefinitionContext.reportDiagnostic`はビュー用の文脈では省略される）
 */
export function resolveCanvasBoards(
  context: Pick<PluginDefinitionContext, "records" | "reportDiagnostic">,
  canvasName: string
): { boards: DesignBoardRow[]; notices: DesignNotice[] } {
  const boards: DesignBoardRow[] = [];
  const notices: DesignNotice[] = [];
  const canvasNames = new Set(
    context
      .records(DESIGN_CANVAS_KIND)
      .map((record) => record.name)
  );
  const report = (seed: NoticeSeed) => {
    notices.push({ code: seed.code, file: seed.file, ja: seed.ja, en: seed.en });
    context.reportDiagnostic?.(toDiagnostic(seed));
  };
  for (const board of context.records(DESIGN_BOARD_KIND)) {
    const canvasRef = boardCanvasName(board);
    if (canvasRef === undefined) {
      report({
        file: board.relativePath,
        path: "/spec/canvas",
        code: "DESIGN_BOARD_CANVAS_MISSING",
        ja: `アートボード ${board.name} はspec.canvasを持ちません。キャンバス ${canvasName} の一覧には出しません`,
        en: `Artboard ${board.name} has no spec.canvas. It is left out of canvas ${canvasName}`
      });
      continue;
    }
    if (!canvasNames.has(canvasRef)) {
      report({
        file: board.relativePath,
        path: "/spec/canvas",
        code: "DESIGN_CANVAS_NOT_FOUND",
        ja: `アートボード ${board.name} のspec.canvas ${canvasRef} に該当するDesignCanvasがありません`,
        en: `No DesignCanvas named ${canvasRef} matches the spec.canvas of artboard ${board.name}`
      });
    }
    if (canvasRef !== canvasName) continue;
    const row: DesignBoardRow = {
      name: board.name,
      title: board.title ?? board.name,
      ...(stringOf(board.spec.page) !== undefined ? { page: stringOf(board.spec.page) } : {}),
      ...(numberOf(board.spec.order) !== undefined ? { order: numberOf(board.spec.order) } : {}),
      ...(numberOf(board.spec.x) !== undefined ? { x: numberOf(board.spec.x) } : {}),
      ...(numberOf(board.spec.y) !== undefined ? { y: numberOf(board.spec.y) } : {}),
      ...(numberOf(board.spec.w) !== undefined ? { w: numberOf(board.spec.w) } : {}),
      ...(numberOf(board.spec.h) !== undefined ? { h: numberOf(board.spec.h) } : {})
    };
    const x = numberOf(board.spec.x);
    const y = numberOf(board.spec.y);
    const w = numberOf(board.spec.w);
    const h = numberOf(board.spec.h);
    if (x === undefined || y === undefined || w === undefined || h === undefined || w <= 0 || h <= 0) {
      report({
        file: board.relativePath,
        code: "DESIGN_BOARD_LAYOUT_INVALID",
        ja: `アートボード ${board.name} のx・y・w・hを確認してください。キャンバス ${canvasName} では配置を表示できません`,
        en: `Check x, y, w and h on artboard ${board.name}. Canvas ${canvasName} cannot place it`
      });
    }
    boards.push(row);
  }
  boards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  return { boards, notices };
}

/**
 * 同じキャンバス・同じページの既存アートボードの右端から80px空けた位置。
 * 配置が読めるものがない場合は原点。`y`は最も上寄りに揃える。
 */
export function nextBoardPosition(
  siblings: readonly PluginResourceRecord[]
): { x: number; y: number } {
  const placed = siblings
    .map((board) => ({
      x: numberOf(board.spec.x),
      y: numberOf(board.spec.y),
      w: numberOf(board.spec.w),
      h: numberOf(board.spec.h)
    }))
    .filter(
      (box): box is { x: number; y: number; w: number; h: number } =>
        box.x !== undefined && box.y !== undefined &&
        box.w !== undefined && box.h !== undefined && box.w > 0 && box.h > 0
    );
  if (placed.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...placed.map((box) => box.x + box.w));
  const top = Math.min(...placed.map((box) => box.y));
  return { x: right + BOARD_GAP, y: top };
}

/** `metadata.name`の規則に収めるスラッグ。`ticket-engine`のtrackerNameと同じ手つき */
function slugOf(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Crockford base32の短い接尾辞。衝突と「名前から作って空になる」への保険 */
function suffix(): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % 32];
  return out;
}

/** 新規`DesignCanvas`の`metadata.name`。`metadata.title`（人が見る名）からは作らない */
export function canvasResourceName(title: string): string {
  const base = slugOf(title);
  return base ? `${base}-${suffix()}` : `design-canvas-${suffix()}`;
}

/** 新規`DesignBoard`の`metadata.name`。キャンバス名を接頭辞に置く */
export function boardResourceName(canvasName: string): string {
  const base = slugOf(canvasName) || "design-board";
  return `${base}-board-${suffix()}`;
}

/** 相対パスから所属フォルダ。`ticket-engine`のfolderOfと同じ */
export function folderOf(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}
