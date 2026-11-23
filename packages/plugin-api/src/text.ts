/**
 * 宣言の中に書く表示文字列。localeキーの対応表を書けば、Vellymの言語切替が
 * そのままプラグインの表示へ及ぶ。プラグイン側でi18nライブラリを持たなくてよい。
 *
 * ```ts
 * const label: PluginLocalizedText = { ja: "優先度", en: "Priority" };
 * ```
 */
export type PluginLocalizedText = string | Readonly<Record<string, string>>;

/**
 * 表示localeに合う文字列を選ぶ。
 *
 * 見つからない場合は`fallbackLocale`、それも無ければ最初の非空値を返す。
 * 空の値しかない場合は日本語の「未翻訳」を返す。未翻訳を空欄で見せると、
 * 値が無いのか訳が無いのかを利用者が区別できなくなる。
 */
export function resolveLocalizedText(
  text: PluginLocalizedText,
  locale: string,
  fallbackLocale = "en"
): string {
  const missing = "（未翻訳）";
  if (typeof text === "string") return nonEmpty(text) ?? missing;
  const exact = nonEmpty(text[locale]);
  if (exact !== undefined) return exact;
  const base = locale.split("-")[0];
  if (base !== undefined && base !== locale) {
    const baseMatch = nonEmpty(text[base]);
    if (baseMatch !== undefined) return baseMatch;
  }
  const fallback = nonEmpty(text[fallbackLocale]);
  if (fallback !== undefined) return fallback;
  for (const value of Object.values(text)) {
    const available = nonEmpty(value);
    if (available !== undefined) return available;
  }
  return missing;
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
