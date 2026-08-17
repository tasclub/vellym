import type { RichTextBlock } from "@vellym-internal/core";

import { PageLanguageControls } from "./page-language-controls.js";
import {
  addPageLocale,
  deleteInvalidPageTranslation,
  removePageLocale,
  repairInvalidPageTranslation,
  type PageEditSession
} from "./page-edit-session.js";

export interface PageDraft {
  title: string;
  blocks: RichTextBlock[];
  /**
   * URL名。**言語を切り替えたときだけ入る。**
   *
   * 言語の追加や削除ではURL名は動かさない。編集中の値を持っている利用者から
   * それを取り上げないためである。
   */
  slug?: string;
}

/**
 * 編集中のセッションから、いま表示すべき下書きを取り出す。
 *
 * 言語を足す・消す・直すのいずれも、**活きている言語が入れ替わる**。
 * 入れ替わったことに気づかず前の言語の題名と本文を出したままにすると、
 * 書いた内容が別の言語へ入る。取り出しを1か所にまとめて、呼ぶ側が
 * 忘れられないようにする。
 */
export function activeDraft(session: PageEditSession): PageDraft {
  const active = session.locales.find(
    (item) => item.locale === session.activeLocale
  );
  return {
    title: active?.title ?? "",
    blocks: (active?.blocks ?? []).map((block) => ({ ...block }))
  };
}

/**
 * 編集中のページの言語を操作する帯。
 *
 * 操作はどれも「セッションを作り直して、表示中の下書きを合わせる」という
 * 同じ形になる。`onChange`へまとめ、呼ぶ側は下書きの入れ替えだけを見る。
 */
export function PageLanguagePanel(props: {
  session: PageEditSession;
  uiLocale: string;
  disabled: boolean;
  /**
   * セッションが変わったとき。`draft`は表示中の言語の題名と本文で、
   * 入れ替えが不要な操作（壊れた翻訳の削除）では`undefined`になる。
   */
  onChange(next: PageEditSession, draft?: PageDraft): void;
}) {
  const { session } = props;
  const withDraft = (next: PageEditSession) => props.onChange(next, activeDraft(next));
  return (
    <PageLanguageControls
      session={session}
      uiLocale={props.uiLocale}
      disabled={props.disabled}
      onSelect={(locale) => {
        // 消した言語へは切り替えない。表示だけ移って書けない状態を作らない。
        const target = session.locales.find(
          (item) => item.locale === locale && !item.removed
        );
        if (!target) return;
        const next = { ...session, activeLocale: locale };
        props.onChange(next, { ...activeDraft(next), slug: session.slug });
      }}
      onAdd={(locale, initialize) => withDraft(addPageLocale(session, locale, initialize))}
      onRemove={(locale) => withDraft(removePageLocale(session, locale))}
      onRepairInvalid={(rawKey) => withDraft(repairInvalidPageTranslation(session, rawKey))}
      // 壊れた翻訳を捨てるだけなので、表示中の言語は動かない。
      onDeleteInvalid={(rawKey) =>
        props.onChange(deleteInvalidPageTranslation(session, rawKey))
      }
    />
  );
}
