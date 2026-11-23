import type {
  PluginIndexRow,
  PluginRenderContext,
  PluginSaveResult,
  PluginSpecWrite
} from "@vellym/plugin-api";

import { ApiError, fetchPageEdit, isStaticApp, patchPage } from "../shared/api.js";
import type { PluginSpecValue } from "../shared/field-input.js";
import type { PluginViewPayload } from "./plugin-list-view.js";
import { readPluginViewSettings, writePluginViewSettings } from "./view-settings.js";

/**
 * rendererへ渡す文脈を組み立てる。
 *
 * **保存はCoreの経路をそのまま通す。** プラグインへファイルへの書き込みを
 * 渡さない。非破壊往復、realpath境界、hash競合の検出はこの経路で効く。
 *
 * hashは書く直前に取り直す。索引行はhashを持たないため、画面を開いてから
 * 時間が経っていると古い値で衝突する。
 */
export function createRenderContext(options: {
  payload: PluginViewPayload;
  /**
   * 画面の文字列を選ぶUI言語（`bootstrap.project.uiLocale`）。
   * 文書の要求言語（`view.locale`）ではない。
   */
  locale: string;
  /** Stable project identity supplied by bootstrap, independent of host/port. */
  projectRoot: string;
  /** 書き込み先。開いているリソースの`metadata.name` */
  targetKind: string;
  targetName: string;
  targetTitle: string;
  targetPath: string;
  /** 未作成ResourceではPATCHせず、null baselineの初回保存を行う */
  saveDraft?(writes: readonly PluginSpecWrite[]): Promise<void>;
  /** 保存が通ったあとに呼ぶ。読み直しは呼ぶ側の仕事 */
  onSaved(): void | Promise<void>;
  /** metadata.nameでリソースを開く。URL規則は呼び側（host）が吸収する */
  onOpenResource: PluginRenderContext["openResource"];
  onRunCommand?: NonNullable<PluginRenderContext["runCommand"]>;
  /** 保存に失敗したときの1行を作る */
  describeError(error: unknown): string;
}): PluginRenderContext {
  const rows: PluginIndexRow[] = options.payload.allRows.map((row) => ({
    name: row.name,
    title: row.title,
    values: row.values
  }));

  return {
    locale: options.locale,
    rendererData: options.payload.descriptor.rendererData,
    // **静的版では`true`になる。** プラグインはこれを見て操作自体を出さない。
    isStatic: isStaticApp(),
    /*
     * 開いている資源。**`payload.target`の有無で判断しない。**
     *
     * `payload.target`は索引行であり、索引行を持たない種別（`TicketTracker`）
     * では常に空になる。定義編集の画面はまさにその種別なので、これで
     * 判断すると`spec`が空のまま渡り、**行が1つも出ない画面になる。**
     * 実際にそうなった。開いている資源の識別子は呼ぶ側が知っている。
     */
    target: {
      // descriptor.kind is the indexed row kind (Ticket for a Kanban), not the
      // resource hosting the view (TicketTracker).
      kind: options.targetKind,
      name: options.targetName,
      title: options.payload.target?.title ?? options.targetTitle,
      relativePath: options.payload.target?.relativePath ?? options.targetPath,
      spec: options.payload.targetSpec ?? {},
      readOnly: false
    },
    rows,
    // 定義リソースはdescriptorを組み立てるNode側が読む。ブラウザ側では
    // 渡していない。必要になった時点で経路を決める。
    records: () => [],
    openResource(name) {
      return options.onOpenResource(name);
    },
    ...(options.onRunCommand ? { runCommand: options.onRunCommand } : {}),
    getViewSettings() {
      return readPluginViewSettings({
        projectRoot: options.projectRoot,
        pluginId: options.payload.pluginId,
        viewId: options.payload.viewId,
        targetName: options.targetName
      });
    },
    setViewSettings(value) {
      writePluginViewSettings({
        projectRoot: options.projectRoot,
        pluginId: options.payload.pluginId,
        viewId: options.payload.viewId,
        targetName: options.targetName
      }, value);
    },
    async save(
      writes: readonly PluginSpecWrite[],
      saveOptions?: { targetName?: string }
    ): Promise<PluginSaveResult> {
      if (isStaticApp()) {
        const error = new ApiError("Saving is unavailable in static output.", 405, [], "STATIC_WRITE_UNAVAILABLE");
        return { ok: false, reason: "error", message: options.describeError(error) };
      }
      try {
        if (options.saveDraft && !saveOptions?.targetName) {
          await options.saveDraft(writes);
          await options.onSaved();
          return { ok: true };
        }
        const targetName = saveOptions?.targetName ?? options.targetName;
        const edit = await fetchPageEdit(targetName);
        await patchPage(targetName, {
          baseHash: edit.data.hash,
          specValues: writes.map((write) => ({
            path: [...write.path],
            value: write.value as PluginSpecValue
          }))
        });
        await options.onSaved();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof ApiError && error.status === 409 ? "conflict" : "error",
          message: options.describeError(error)
        };
      }
    }
  };
}
