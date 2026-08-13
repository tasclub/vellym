import { describe, expect, it } from "vitest";
import {
  documentPagePath,
  localeDirection,
  resolveDocumentLocation
} from "../packages/ui-react/src/routing.js";

describe("locale document routing", () => {
  it("resolves a canonical locale page pathname and heading", () => {
    expect(resolveDocumentLocation({
      pathname: "/en/pages/getting-started/",
      hash: "#install"
    })).toEqual({
      locale: "en",
      page: "getting-started",
      heading: "install",
      legacy: false
    });
  });

  it("canonicalizes locale casing and safely encodes generated paths", () => {
    expect(resolveDocumentLocation({
      pathname: "/zh-hant/pages/guide/",
      hash: ""
    }).locale).toBe("zh-Hant");
    expect(documentPagePath("zh-Hant", "first page", "概要")).toBe(
      "/zh-hant/pages/first%20page/#%E6%A6%82%E8%A6%81"
    );
  });

  it("retains the legacy hash entry point", () => {
    expect(resolveDocumentLocation({
      pathname: "/",
      hash: "#page=welcome&heading=overview"
    })).toEqual({
      page: "welcome",
      heading: "overview",
      legacy: true
    });
  });

  it("retains the pathname locale for legacy links inside a localized page", () => {
    expect(resolveDocumentLocation({
      pathname: "/en/pages/welcome/",
      hash: "#page=guide&heading=setup"
    })).toEqual({
      locale: "en",
      page: "guide",
      heading: "setup",
      legacy: true
    });
  });

  it("does not interpret reserved or malformed locale paths", () => {
    expect(resolveDocumentLocation({
      pathname: "/api/pages/welcome/",
      hash: ""
    })).toEqual({ legacy: true, page: undefined, heading: undefined });
  });

  it("resolves writing direction from the document locale", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
  });

  it("resolves a default-locale page under a static subdirectory", () => {
    expect(resolveDocumentLocation({
      pathname: "/manual/pages/getting-started/",
      hash: "#overview",
      basePath: "/manual",
      defaultLocale: "ja"
    })).toEqual({
      locale: "ja",
      page: "getting-started",
      heading: "overview",
      legacy: false
    });
  });
});
