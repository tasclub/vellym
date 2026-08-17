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
 * 見つからない場合は`fallbackLocale`、それも無ければ最初に定義された値を返す。
 * **空文字列を返さない。** 未翻訳を空欄で見せると、値が無いのか訳が無いのかを
 * 利用者が区別できなくなる。
 */
export function resolveLocalizedText(
  text: PluginLocalizedText,
  locale: string,
  fallbackLocale = "en"
): string {
  if (typeof text === "string") return text;
  const exact = text[locale];
  if (exact !== undefined) return exact;
  const base = locale.split("-")[0];
  if (base !== undefined && base !== locale) {
    const baseMatch = text[base];
    if (baseMatch !== undefined) return baseMatch;
  }
  const fallback = text[fallbackLocale];
  if (fallback !== undefined) return fallback;
  for (const value of Object.values(text)) {
    if (value !== undefined) return value;
  }
  return "";
}
