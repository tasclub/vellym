import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  PluginRenderContext,
  PluginViewRenderer
} from "@vellym/plugin-api";

import { ErrorBoundary } from "../shared/error-boundary.js";
import styles from "./plugin.module.css";

/**
 * プラグインのrendererをmount契約に沿って動かす。
 *
 * 契約（[[decision-plugin-mechanism]] 6-1）で決めた呼び分けを守る。
 *
 * - `mount`は1つの要素につき1回だけ。渡す前に要素を空にする
 * - 文脈が変わったら`update`。**省略されていれば張り直す**
 * - 画面を閉じるときに`unmount`。戻り値は待たない
 * - `unmount`のあとに`update`を呼ばない
 */
function RendererHost({
  renderer,
  context
}: {
  renderer: PluginViewRenderer;
  context: PluginRenderContext;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReturnType<PluginViewRenderer["mount"]>>(undefined);
  // 最新の文脈をrefで持つ。mountの引数に閉じ込めると、張り直しのたびに
  // 古い文脈で描いてしまう。
  const contextRef = useRef(context);
  contextRef.current = context;
  /**
   * 最後に渡した文脈。
   *
   * **mountの直後にupdateを呼ばないためにある。** これが無いと、文脈の効果が
   * 初回にも走り、`mount`と同じ文脈で`update`が続けて呼ばれる。契約は
   * 「文脈が変わったときにupdate」なので、それは規約違反であり無駄でもある。
   * 実際に最初の実装がそうなっていた。
   */
  const deliveredRef = useRef<PluginRenderContext | undefined>(undefined);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // 要素の中身はプラグインのものになる。渡す前にhostが空にする。
    element.replaceChildren();
    deliveredRef.current = contextRef.current;
    handleRef.current = renderer.mount(element, contextRef.current);
    return () => {
      const handle = handleRef.current;
      // 取っ手を先に捨てる。解体のあとにupdateが走る余地を残さない。
      handleRef.current = undefined;
      deliveredRef.current = undefined;
      handle?.unmount();
    };
  }, [renderer]);

  useEffect(() => {
    const handle = handleRef.current;
    // `update`を持たないrendererは、Reactが要素を作り直したときに
    // 張り直される。ここでは何もしない。
    if (!handle?.update) return;
    if (deliveredRef.current === context) return;
    deliveredRef.current = context;
    handle.update(context);
  }, [context]);

  return <div ref={elementRef} />;
}

/**
 * プラグインの画面1つを、1つのエラー境界で包む。
 *
 * **壊れる範囲をこの区画に区切る。** そのプラグインの画面が使えなくなることは
 * 許容するが、文書ツリー・全文検索・本文の編集が触れなくなることは許容しない。
 */
export function PluginRendererView({
  viewId,
  renderer,
  context
}: {
  viewId: string;
  renderer: PluginViewRenderer;
  context: PluginRenderContext;
}) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      resetKey={viewId}
      fallback={(error) => (
        <p className={styles["plugin-list-error"]} role="alert">
          {t("plugin.rendererFailed")}
          {/* 原因を隠さない。どのプラグインの何が失敗したかを出す */}
          <span className={styles["plugin-detail-note"]}>{error.message}</span>
        </p>
      )}
    >
      <RendererHost renderer={renderer} context={context} />
    </ErrorBoundary>
  );
}
