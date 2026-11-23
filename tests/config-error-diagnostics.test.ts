import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfigErrorDiagnostics } from "../packages/ui-react/src/shell/app.js";
import type { Diagnostic } from "@vellym-internal/core";

function renderDiagnostic(code: string, message: string): string {
  const diagnostic: Diagnostic = {
    file: "vellym.config.yaml",
    severity: "error",
    code,
    message
  };
  return renderToStaticMarkup(
    createElement(ConfigErrorDiagnostics, {
      diagnostics: [diagnostic],
      language: "ja"
    })
  );
}

describe("configuration error diagnostics", () => {
  it("shows the translated summary and original parser detail", () => {
    const html = renderDiagnostic(
      "CONFIG_YAML",
      "設定YAMLを読み込めません: unexpected token at line 2, column 1\nnear schemaVersion"
    );

    expect(html).toContain("設定ファイルのYAMLを解析できません。");
    expect(html).toContain(
      "設定YAMLを読み込めません: unexpected token at line 2, column 1"
    );
    expect(html).toContain("near schemaVersion");
    expect(html).toContain("<pre");
  });

  it("shows an untranslated diagnostic only once", () => {
    const html = renderDiagnostic(
      "UNKNOWN_CONFIG_ERROR",
      "Original diagnostic at line 4, column 2"
    );

    expect(html.match(/Original diagnostic at line 4, column 2/g)).toHaveLength(1);
    expect(html).not.toContain("error.UNKNOWN_CONFIG_ERROR");
    expect(html).toContain("<pre");
  });
});
