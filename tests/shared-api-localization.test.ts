import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPage, ApiError } from "../packages/ui-react/src/shared/api.js";
import { i18next } from "../packages/ui-react/src/shared/i18n.js";

const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await i18next.changeLanguage("ja");
  vi.restoreAllMocks();
});

describe("API diagnostic localization", () => {
  it("uses the active UI language for localized server diagnostics", async () => {
    await i18next.changeLanguage("en");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        data: null,
        diagnostics: [{
          file: "page.yaml",
          severity: "error",
          code: "PAGE_INVALID",
          message: {
            ja: "ページが無効です",
            en: "The page is invalid."
          }
        }]
      })
    }) as typeof fetch;

    await expect(fetchPage("page")).rejects.toMatchObject({
      message: "The page is invalid.",
      code: "PAGE_INVALID"
    } satisfies Partial<ApiError>);
  });

  it("localizes malformed server responses", async () => {
    await i18next.changeLanguage("en");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("invalid JSON"); }
    }) as typeof fetch;

    await expect(fetchPage("page")).rejects.toMatchObject({
      message: "The server response could not be parsed.",
      code: "API_RESPONSE_PARSE"
    } satisfies Partial<ApiError>);
  });
});
