import { ApiError } from "./api.js";

type Translate = (key: string, options?: { defaultValue?: string }) => string;

// serverのRuntimeErrorは日本語固定の文言を返す。UIを英語にしていても
// 保存失敗や競合の文言だけ日本語になるため、安定したcodeから表示文言を引く。
// codeに対応する翻訳が無い場合だけ、serverの文言へ委ねる。
export function errorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.code) {
    const translated = t(`error.${error.code}`, { defaultValue: "" });
    if (translated) return translated;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
