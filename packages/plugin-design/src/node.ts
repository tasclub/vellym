import { definePlugin } from "@vellym/plugin-api";
import type { PluginCommandContext, PluginViewContext } from "@vellym/plugin-api";
import {
  CREATE_BOARD_COMMAND_ID,
  CREATE_CANVAS_COMMAND_ID,
  DEFAULT_BOARD_H,
  DEFAULT_BOARD_W,
  DESIGN_BOARD_KIND,
  DESIGN_BOARD_SPEC_SCHEMA,
  DESIGN_CANVAS_KIND,
  DESIGN_CANVAS_SPEC_SCHEMA,
  DESIGN_CANVAS_VIEW_ID,
  boardPage,
  boardResourceName,
  canvasResourceName,
  folderOf,
  nextBoardPosition,
  resolveCanvasBoards
} from "./model.js";

/**
 * 公開済み`@vellym/design`のNode entry。
 *
 * 種別・スキーマ・キャンバスのビュー・作成コマンドだけを登録し、画面（キャンバス
 * の描画）はブラウザ側エントリの仮画面で出す。キャンバスのビューは
 * `rendererData`で「そのキャンバスを指すアートボード」と注意をNode側で解決して
 * 渡す（配置はアートボード側。キャンバスはアートボードを保持しない）。
 */
export default definePlugin({
  activate(host) {
    host.registerKind({
      kind: DESIGN_CANVAS_KIND,
      specSchema: DESIGN_CANVAS_SPEC_SCHEMA,
      showInDocumentTree: true,
      hasBlocks: false
    });
    host.registerKind({
      kind: DESIGN_BOARD_KIND,
      specSchema: DESIGN_BOARD_SPEC_SCHEMA,
      showInDocumentTree: false,
      hasBlocks: false
    });

    host.registerView({
      id: DESIGN_CANVAS_VIEW_ID,
      label: { ja: "キャンバス", en: "Canvas" },
      static: false,
      view: (context: PluginViewContext) => {
        const canvasName = context.target?.kind === DESIGN_CANVAS_KIND
          ? context.target.name
          : "";
        const resolved = resolveCanvasBoards(context, canvasName);
        return {
          type: "detail",
          id: DESIGN_CANVAS_VIEW_ID,
          kind: DESIGN_CANVAS_KIND,
          // 画面はプラグインが自分で描く。hostにspecを読ませないため、
          // 項目宣言は空にし、解決済みのものをrendererDataで渡す。
          fields: [],
          body: "none",
          undeclaredFields: "hidden",
          rendererData: {
            canvasName,
            canvasTitle: context.target?.title ?? "",
            boards: resolved.boards,
            notices: resolved.notices
          }
        };
      }
    });

    host.registerCommand({
      id: CREATE_CANVAS_COMMAND_ID,
      title: { ja: "デザインキャンバスを作成", "en": "New design canvas" },
      static: false,
      placement: "document-tree",
      inputs: [
        {
          id: "title",
          label: { ja: "名前", en: "Name" },
          type: "text",
          path: ["title"],
          required: true
        }
      ],
      run: (context: PluginCommandContext) => {
        const title =
          typeof context.input?.title === "string" ? context.input.title.trim() : "";
        if (!title) {
          return {
            ok: false,
            diagnostics: [
              {
                file: ".",
                severity: "warning",
                code: "DESIGN_CANVAS_TITLE_REQUIRED",
                message: { ja: "名前を入力してください", en: "Enter a name." }
              }
            ]
          };
        }
        const requested =
          typeof context.input?.folder === "string" ? context.input.folder.trim() : "";
        const folder = requested || (context.target ? folderOf(context.target.relativePath) : "");
        return context.createResource({
          kind: DESIGN_CANVAS_KIND,
          name: canvasResourceName(title),
          title,
          ...(folder ? { folder } : {}),
          // 空のキャンバス。アートボードは持たない（配置はアートボード側）
          spec: {}
        });
      }
    });

    host.registerCommand({
      id: CREATE_BOARD_COMMAND_ID,
      title: { ja: "アートボードを追加", en: "New artboard" },
      static: false,
      run: (context: PluginCommandContext) => {
        const canvas =
          context.target?.kind === DESIGN_CANVAS_KIND ? context.target : undefined;
        if (!canvas) {
          return {
            ok: false,
            diagnostics: [
              {
                file: ".",
                severity: "warning",
                code: "DESIGN_BOARD_CANVAS_TARGET_REQUIRED",
                message: {
                  ja: "キャンバスを開いた状態でのみアートボードを追加できます",
                  en: "Open a canvas before adding an artboard."
                }
              }
            ]
          };
        }
        // 同じキャンバス・同じページ（既定ページ）のアートボードの右端+80px。
        const siblings = context
          .records(DESIGN_BOARD_KIND)
          .filter(
            (board) =>
              board.spec.canvas === canvas.name && boardPage(board, undefined)
          );
        const position = nextBoardPosition(siblings);
        const title =
          context.locale === "ja" ? "新しいアートボード" : "New artboard";
        const canvasFolder = folderOf(canvas.relativePath);
        return context.createResource({
          kind: DESIGN_BOARD_KIND,
          name: boardResourceName(canvas.name),
          title,
          ...(canvasFolder ? { folder: `${canvasFolder}/+boards` } : { folder: "+boards" }),
          spec: {
            canvas: canvas.name,
            x: position.x,
            y: position.y,
            w: DEFAULT_BOARD_W,
            h: DEFAULT_BOARD_H,
            title,
            // 空のHTML。中身は次の段階で編集する
            html: ""
          }
        });
      }
    });
  }
});
