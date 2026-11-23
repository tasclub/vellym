import { defineBrowserPlugin } from "@vellym/plugin-api";
import type { PluginRenderContext, PluginViewHandle } from "@vellym/plugin-api";
import {
  CREATE_BOARD_COMMAND_ID,
  DESIGN_CANVAS_VIEW_ID,
  type DesignBoardRow,
  type DesignNotice
} from "./model.js";

/**
 * ブラウザ側エントリ。**段階1aの仮画面**（キャンバス名とアートボード名の一覧と
 * 追加ボタン）をVanilla DOMで出す。キャンバスの描画は次のTicket
 * （ticket-01m7j7pmv7cvxzg1a3r33hktk5）で置き換えるため、Reactもキャンバス
 * ライブラリも今は入れない。
 *
 * 表示するアートボード一覧はNode側のdescriptorが`rendererData`で解決済みである。
 * ブラウザが`spec`を読みにいく経路は作らない。
 */

interface CanvasRendererData {
  canvasName: string;
  canvasTitle: string;
  boards: DesignBoardRow[];
  notices: DesignNotice[];
}

function readRendererData(context: PluginRenderContext): CanvasRendererData {
  const raw = context.rendererData ?? {};
  return {
    canvasName: typeof raw.canvasName === "string" ? raw.canvasName : "",
    canvasTitle: typeof raw.canvasTitle === "string" ? raw.canvasTitle : "",
    boards: Array.isArray(raw.boards) ? (raw.boards as DesignBoardRow[]) : [],
    notices: Array.isArray(raw.notices) ? (raw.notices as DesignNotice[]) : []
  };
}

function text(element: HTMLElement, value: string): void {
  element.textContent = value;
}

function message(notice: DesignNotice, locale: string): string {
  return locale === "ja" ? notice.ja : notice.en;
}

function describeBoard(board: DesignBoardRow, locale: string): string {
  const place =
    board.x !== undefined && board.y !== undefined && board.w !== undefined && board.h !== undefined
      ? `x ${board.x} y ${board.y} ${board.w}×${board.h}`
      : locale === "ja"
        ? "配置が未設定"
        : "position unset";
  return `${board.title}（${place}）`;
}

function draw(element: HTMLElement, context: PluginRenderContext): void {
  const locale = context.locale;
  const data = readRendererData(context);
  element.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "design-canvas-1a";
  wrap.style.cssText = "display:grid;gap:12px;padding:12px;";

  const heading = document.createElement("h2");
  heading.style.cssText = "margin:0;font-size:1.1rem;";
  text(
    heading,
    data.canvasTitle || data.canvasName
      ? `${locale === "ja" ? "キャンバス" : "Canvas"}: ${data.canvasTitle || data.canvasName}`
      : (locale === "ja" ? "キャンバス" : "Canvas")
  );
  wrap.append(heading);

  if (data.notices.length > 0) {
    const noticeBox = document.createElement("ul");
    noticeBox.setAttribute("role", "alert");
    noticeBox.style.cssText = "margin:0;padding-left:1.2em;color:#8a4b00;";
    for (const notice of data.notices) {
      const item = document.createElement("li");
      text(item, message(notice, locale));
      noticeBox.append(item);
    }
    wrap.append(noticeBox);
  }

  const list = document.createElement("ul");
  if (data.boards.length === 0) {
    const item = document.createElement("li");
    text(item, locale === "ja" ? "アートボードはまだありません" : "No artboards yet");
    list.append(item);
  } else {
    for (const board of data.boards) {
      const item = document.createElement("li");
      text(item, describeBoard(board, locale));
      list.append(item);
    }
  }
  wrap.append(list);

  if (!context.isStatic && context.runCommand) {
    const button = document.createElement("button");
    button.type = "button";
    text(button, locale === "ja" ? "アートボードを追加" : "New artboard");
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    button.addEventListener("click", () => {
      void context.runCommand?.(CREATE_BOARD_COMMAND_ID, {}).then((result) => {
        if (result && result.ok === false) text(status, result.message);
        else text(status, "");
      });
    });
    wrap.append(button, status);
  }

  element.append(wrap);
}

export default defineBrowserPlugin({
  activate(host) {
    host.registerViewRenderer(DESIGN_CANVAS_VIEW_ID, {
      mount(element, context): PluginViewHandle {
        draw(element, context);
        return {
          update(next: PluginRenderContext): void {
            draw(element, next);
          },
          unmount(): void {
            element.replaceChildren();
          }
        };
      }
    });
  }
});
