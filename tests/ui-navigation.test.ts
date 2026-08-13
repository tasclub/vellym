import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocumentNavigation } from "@vellym-internal/core";
import { DocumentTree } from "../packages/ui-react/src/document-tree.js";
import { FolderView } from "../packages/ui-react/src/folder-view.js";
import { AdminView } from "../packages/ui-react/src/admin-view.js";
import { LanguageSwitcher } from "../packages/ui-react/src/language-switcher.js";
import { FolderLanguageControls } from "../packages/ui-react/src/folder-language-controls.js";
import { createFolderEditSession } from "../packages/ui-react/src/folder-edit-session.js";

describe("DocumentTree", () => {
  it("renders physical folders and document titles as an accessible tree", () => {
    const navigation = buildDocumentNavigation([
      {
        name: "architecture",
        title: "アーキテクチャ",
        relativePath: "design/architecture.yaml",
        readOnly: false
      },
      {
        name: "requirements",
        title: "要求一覧",
        relativePath: "requirements.yaml",
        readOnly: false
      }
    ]);

    const html = renderToStaticMarkup(
      createElement(DocumentTree, {
        nodes: navigation.tree,
        selected: "architecture",
        canManage: true,
        onSelect: () => undefined,
        onSelectFolder: () => undefined,
        onCreate: () => undefined,
        onItemAction: () => undefined
      })
    );

    expect(html).toContain('role="treegrid"');
    expect(html).toContain('role="row"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("design");
    expect(html).toContain("アーキテクチャ");
    expect(html).toContain("要求一覧");
    expect(html).not.toContain("architecture.yaml");
    expect(html).toContain("アーキテクチャの操作");
    expect(html).not.toContain("構成を管理");
  });

  it("hides row management menus in read-only mode", () => {
    const navigation = buildDocumentNavigation([
      {
        name: "architecture",
        title: "アーキテクチャ",
        relativePath: "design/architecture.yaml",
        readOnly: false
      }
    ]);
    const html = renderToStaticMarkup(
      createElement(DocumentTree, {
        nodes: navigation.tree,
        selected: "architecture",
        canManage: false,
        onSelect: () => undefined,
        onSelectFolder: () => undefined,
        onCreate: () => undefined,
        onItemAction: () => undefined
      })
    );
    expect(html).toContain("アーキテクチャ");
    expect(html).not.toContain("アーキテクチャの操作");
  });

  it("renders folder children and the empty repository state", () => {
    const navigation = buildDocumentNavigation([
      {
        name: "architecture",
        title: "アーキテクチャ",
        relativePath: "design/architecture.yaml",
        readOnly: false
      }
    ]);
    const folder = navigation.tree.find(
      (node) => node.kind === "folder"
    );
    const folderHtml = renderToStaticMarkup(
      createElement(FolderView, {
        folder: folder?.kind === "folder" ? folder : undefined,
        onSelectPage: () => undefined,
        onSelectFolder: () => undefined
      })
    );
    const emptyHtml = renderToStaticMarkup(
      createElement(FolderView, {
        onSelectPage: () => undefined,
        onSelectFolder: () => undefined
      })
    );
    expect(folderHtml).toContain("アーキテクチャ");
    expect(emptyHtml).toContain("まだ文書がありません");
  });

  it("renders source information and isolated loading problems", () => {
    const html = renderToStaticMarkup(
      createElement(AdminView, {
        contentRoot: "docs/content",
        projectRoot: "/project",
        resolvedContentRoot: "/project/docs/content",
        configPath: "vellym.config.yaml",
        diagnostics: [{
          file: "broken.yaml",
          severity: "error",
          code: "YAML_PARSE",
          message: "YAMLを解析できません"
        }],
        language: "ja",
        canManageStructure: false,
        onConfigApplied: () => undefined
      })
    );
    expect(html).toContain("設定・管理詳細");
    expect(html).toContain("broken.yaml");
    expect(html).toContain("他の文書は利用できます");
  });

  it("renders only the current Page's published locales using self names", () => {
    const page = {
      page: {
        apiVersion: "vellym.tasclub.com/v1alpha1" as const,
        kind: "Page" as const,
        metadata: { name: "guide", title: "ガイド" },
        spec: { blocks: [] }
      },
      knownBlocks: [],
      relativePath: "guide.yaml",
      hash: "hash",
      readOnly: false,
      readOnlyReasons: [],
      availableLocales: ["ja", "en"]
    };
    const switcher = createElement(LanguageSwitcher, {
      page,
      currentLocale: "en",
      uiLocale: "ja",
      slug: "guide"
    });
    const html = renderToStaticMarkup(switcher);

    expect(html).toContain('aria-label="文書の言語"');
    expect(html).toContain('href="/ja/pages/guide/"');
    expect(html).toContain('href="/en/pages/guide/"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("日本語");
    expect(html).toContain("English");
    expect(html).not.toContain('data-translation="missing"');

    page.availableLocales = ["ja"];
    expect(renderToStaticMarkup(createElement(LanguageSwitcher, {
      page,
      currentLocale: "ja",
      uiLocale: "en",
      slug: "guide"
    }))).toBe("");
  });

  it("renders Folder locale editing as ARIA tabs", () => {
    const session = createFolderEditSession({
      folderPath: "guides",
      hash: "hash",
      baseLocale: "ja",
      locales: [
        {
          locale: "ja",
          isBaseLocale: true,
          visibility: "published",
          title: "ガイド",
          baselineHash: "ja-hash"
        },
        {
          locale: "en",
          isBaseLocale: false,
          visibility: "draft",
          title: "Guides",
          baselineHash: "en-hash"
        }
      ],
      invalidTranslations: [],
      readOnly: false,
      readOnlyReasons: []
    });
    const html = renderToStaticMarkup(createElement(FolderLanguageControls, {
      session,
      uiLocale: "ja",
      onChange: () => undefined
    }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("言語を追加");
    expect(html).toContain("ガイド");
  });
});
