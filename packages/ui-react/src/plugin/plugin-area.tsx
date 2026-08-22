import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PageView } from "@vellym-internal/core";
import {
  resolveLocalizedText,
  type PluginInputValue,
  type PluginRenderContext,
  type PluginViewRenderer
} from "@vellym/plugin-api";

import { DocumentView } from "../editor/view.js";
import { PluginDetailView } from "./plugin-detail-view.js";
import {
  PluginListView,
  type PluginBulkChange,
  type PluginViewPayload
} from "./plugin-list-view.js";
import type { PluginSpecValue } from "../shared/field-input.js";
import { PluginRendererView } from "./plugin-renderer-view.js";
import { Button } from "../shared/button.js";
import styles from "./plugin.module.css";

/**
 * プラグインが一覧を出すときの画面。文書の紙の中へ一覧を差し込む。
 *
 * 同じ資源に複数のビューがある場合、切り替えの導線を紙の見出しの脇へ出す。
 * 表示名を持つビューだけが並ぶ。**hostが名前を推測しない。**
 */
export function PluginListPage(props: {
  payload: PluginViewPayload;
  view: PageView;
  uiLocale: string;
  showAll: boolean;
  onToggleShowAll(value: boolean): void;
  onNavigate(name: string): void;
  onSwitchView(viewId: string): void | Promise<void>;
  onRunCommand(commandId: string, input: Record<string, PluginInputValue>): void;
  /** 編集不能な静的版では一括操作そのものを渡さない */
  editable: boolean;
  onBulkChange(change: PluginBulkChange): Promise<string[]>;
  onBulkArchive(names: string[]): Promise<string[]>;
  /**
   * プラグインが自分で描くrenderer。あれば**宣言の一覧の代わりに**これを描く。
   * 無ければdescriptorのまま。宣言で足りる画面はプラグイン側を持たなくてよい。
   */
  renderer?: PluginViewRenderer;
  renderContext?: PluginRenderContext;
  /**
   * プラグインの読み込みに失敗したことの知らせ。
   *
   * **一覧の画面はEditorWorkspaceを通らない。** 本文の画面と同じ経路で
   * 知らせが出ると思い込むと、ここだけ黙って何も出なくなる。実際にそうなった。
   */
  notice?: string;
}) {
  const { payload, view } = props;
  const body = props.renderer && props.renderContext ? (
    <PluginRendererView
      viewId={payload.viewId}
      renderer={props.renderer}
      context={props.renderContext}
    />
  ) : (
    <PluginListView
      payload={payload}
      hideTitle
      locale={view.locale ?? view.baseLocale ?? "ja"}
      allRows={payload.allRows}
      showAll={props.showAll}
      onToggleShowAll={props.onToggleShowAll}
      onOpen={props.onNavigate}
      onRunCommand={props.onRunCommand}
      {...(props.editable
        ? {
            onBulkChange: props.onBulkChange,
            onBulkArchive: props.onBulkArchive
          }
        : {})}
    />
  );
  return (
    <section className="workspace browse-workspace">
      {props.notice ? (
        <p className="notice warning" role="status">
          {props.notice}
        </p>
      ) : null}
      <div className="document-paper">
        <DocumentView
          view={view}
          onNavigatePage={props.onNavigate}
          headerActions={(payload.siblings ?? [])
            .filter((sibling) => sibling.id !== payload.viewId && sibling.label)
            .map((sibling) => (
              <Button
                key={sibling.id}
                onClick={() => void props.onSwitchView(sibling.id)}
              >
                {resolveLocalizedText(sibling.label!, props.uiLocale)}
              </Button>
            ))}
          beforeBody={body}
        />
      </div>
    </section>
  );
}

/**
 * プラグインが詳細を出すときの、本文の上に差し込む部分。
 *
 * 定義そのものの編集だけは、本文もタイトルも持たないため単独で保存する。
 * チケットは参照と編集を分け、編集の保存はページ全体の保存に合わせる。
 */
export function PluginDetailPanel(props: {
  payload: PluginViewPayload;
  view: PageView;
  editing: boolean;
  /** プラグインが自分で描くrenderer。あれば宣言の詳細の代わりにこれを描く */
  renderer?: PluginViewRenderer;
  renderContext?: PluginRenderContext;
  onChange(changes: Array<{ path: string[]; value: PluginSpecValue }>): void;
  onSave(changes: Array<{ path: string[]; value: PluginSpecValue }>): Promise<void>;
}): ReactNode {
  const { payload, view } = props;
  if (payload.descriptor.type !== "detail") return undefined;
  if (props.renderer && props.renderContext) {
    return (
      <PluginRendererView
        viewId={payload.viewId}
        renderer={props.renderer}
        context={props.renderContext}
      />
    );
  }
  return (
    <PluginDetailView
      payload={payload}
      locale={view.locale ?? view.baseLocale ?? "ja"}
      mode={
        payload.descriptor.body === "none"
          ? "settings"
          : props.editing
            ? "edit"
            : "read"
      }
      onChange={props.onChange}
      onSave={props.onSave}
    />
  );
}

/**
 * 一覧へ戻る導線。**紙の中身ではないので、紙の外のいちばん上へ置く。**
 */
export function PluginParentLink(props: {
  payload: PluginViewPayload;
  uiLocale: string;
  onBack(name: string): void;
}): ReactNode {
  const { t } = useTranslation();
  const { payload } = props;
  if (payload.descriptor.type !== "detail" || !payload.descriptor.parent) {
    return undefined;
  }
  const parent = payload.descriptor.parent;
  return (
    <p className={styles["plugin-detail-parent"]}>
      <Button onClick={() => props.onBack(parent.name)}>
        ← {t("plugin.backToList")}
      </Button>
      <span className={styles["plugin-detail-parent-name"]}>
        {resolveLocalizedText(parent.title, props.uiLocale)}
      </span>
    </p>
  );
}
