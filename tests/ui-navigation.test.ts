import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocumentNavigation } from "@vellym-internal/core";
import { DocumentTree } from "../packages/ui-react/src/document-tree.js";
import { FolderView } from "../packages/ui-react/src/folder-view.js";
import { AdminView } from "../packages/ui-react/src/admin-view.js";

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
});
