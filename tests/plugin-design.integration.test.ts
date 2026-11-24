import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  PluginCommandContext,
  PluginResourceDraft,
  PluginResourceRecord,
  PluginViewContext,
  VellymBrowserPluginHost,
  VellymPluginHost
} from "@vellym/plugin-api";
import { validateKindSpec, validatePluginManifest } from "@vellym-internal/core";
import { startDevServer } from "@vellym-internal/runtime-node";
import plugin from "@vellym/design";
import browserPlugin from "../packages/plugin-design/src/browser.js";
import {
  CREATE_BOARD_COMMAND_ID,
  CREATE_CANVAS_COMMAND_ID,
  DESIGN_BOARD_KIND,
  DESIGN_BOARD_SPEC_SCHEMA,
  DESIGN_CANVAS_KIND,
  DESIGN_CANVAS_SPEC_SCHEMA,
  DESIGN_CANVAS_VIEW_ID,
  nextBoardPosition,
  resolveCanvasBoards
} from "../packages/plugin-design/src/model/index.js";

function record(
  kind: string,
  name: string,
  relativePath: string,
  spec: Record<string, unknown> = {}
): PluginResourceRecord {
  return { kind, name, title: name, relativePath, spec, readOnly: false };
}

const canvas = record(DESIGN_CANVAS_KIND, "ux-canvas", "30-設計/ux-canvas.yaml", {});

function board(
  name: string,
  spec: Record<string, unknown>,
  file = `30-設計/+boards/${name}.yaml`
): PluginResourceRecord {
  return record(DESIGN_BOARD_KIND, name, file, spec);
}

function validBoardSpec(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { canvas: "ux-canvas", x: 0, y: 0, w: 390, h: 844, title: "M1 ホーム", html: "", ...extra };
}

function viewContext(
  target: PluginResourceRecord | undefined,
  definitions: PluginResourceRecord[]
): PluginViewContext {
  return {
    locale: "ja",
    isStatic: false,
    ...(target ? { target } : {}),
    records: (kind) => definitions.filter((item) => item.kind === kind)
  };
}

interface CommandCapture {
  drafts: PluginResourceDraft[];
}

function commandContext(
  options: {
    target?: PluginResourceRecord;
    input?: Record<string, unknown>;
    definitions?: PluginResourceRecord[];
    locale?: string;
    capture: CommandCapture;
  }
): PluginCommandContext {
  const definitions = options.definitions ?? [];
  return {
    locale: options.locale ?? "ja",
    ...(options.input ? { input: options.input as PluginCommandContext["input"] } : {}),
    ...(options.target ? { target: options.target } : {}),
    records: (kind) => definitions.filter((item) => item.kind === kind),
    createResource: async (draft) => {
      options.capture.drafts.push(draft);
      const name = draft.name ?? "unnamed-draft";
      return { ok: true, name, draft: { ...draft, name } };
    }
  };
}

function activated() {
  const kinds = new Map<string, Parameters<VellymPluginHost["registerKind"]>[0]>();
  const views = new Map<string, Parameters<VellymPluginHost["registerView"]>[0]>();
  const projections = new Map<string, unknown>();
  const commands = new Map<string, Parameters<VellymPluginHost["registerCommand"]>[0]>();
  plugin.activate({
    pluginId: "design",
    hostVersion: "0.5.0-beta",
    registerKind: (value) => kinds.set(value.kind, value),
    registerView: (value) => views.set(value.id, value),
    registerCommand: (value) => commands.set(value.id, value),
    registerRecordProjection: (kind, value) => projections.set(kind, value),
    registerRecordSetValidator: () => {},
    reportDiagnostic: () => {}
  });
  return { kinds, views, projections, commands };
}

function manifest(): {
  vellym: {
    id: string;
    contributes: {
      kinds: { kind: string; showInDocumentTree?: boolean; hasBlocks?: boolean }[];
      views: { id: string; kind: string; type: string; static: boolean }[];
      commands: { id: string; static: boolean; placement?: string }[];
    };
  };
} {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "packages/plugin-design/package.json"), "utf8")
  );
}

describe("design plugin manifest", () => {
  it("ships a valid manifest with both kinds and no dependencies", () => {
    const raw = manifest();
    expect(validatePluginManifest(raw.vellym).errors).toEqual([]);
    expect(raw.vellym.contributes.kinds).toEqual([
      { kind: DESIGN_CANVAS_KIND, showInDocumentTree: true, hasBlocks: false },
      { kind: DESIGN_BOARD_KIND, showInDocumentTree: false, hasBlocks: false }
    ]);
    expect(raw.vellym.contributes.views).toEqual([
      { id: DESIGN_CANVAS_VIEW_ID, kind: DESIGN_CANVAS_KIND, type: "detail", static: false }
    ]);
    expect(raw.vellym.contributes.commands).toEqual([
      expect.objectContaining({ id: CREATE_CANVAS_COMMAND_ID, static: false, placement: "document-tree" }),
      expect.objectContaining({ id: CREATE_BOARD_COMMAND_ID, static: false })
    ]);
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "packages/plugin-design/package.json"), "utf8")
    ) as { dependencies?: unknown };
    expect(packageJson.dependencies).toBeUndefined();
  });

  it("registers both kinds with a specSchema and no record projection", () => {
    const { kinds, projections, views, commands } = activated();
    expect(kinds.get(DESIGN_CANVAS_KIND)?.specSchema).toBeDefined();
    expect(kinds.get(DESIGN_BOARD_KIND)?.specSchema).toBeDefined();
    expect(kinds.get(DESIGN_CANVAS_KIND)?.showInDocumentTree).toBe(true);
    expect(kinds.get(DESIGN_BOARD_KIND)?.showInDocumentTree).toBe(false);
    expect(kinds.get(DESIGN_CANVAS_KIND)?.hasBlocks).toBe(false);
    expect(kinds.get(DESIGN_BOARD_KIND)?.hasBlocks).toBe(false);
    /*
     * 索引projectorを登録しない。projectorを持つkindは`definitionRecords`から
     * 除かれ、ビューの`context.records()`でアートボードを集められなくなる
     * （`packages/runtime-node/src/repository.ts`）。アートボードは少数集合で、
     * 配置解決は`records()`で行う。
     */
    expect(projections.size).toBe(0);
    expect(views.has(DESIGN_CANVAS_VIEW_ID)).toBe(true);
    expect([...commands.keys()].sort()).toEqual([CREATE_BOARD_COMMAND_ID, CREATE_CANVAS_COMMAND_ID]);
  });

  it("registers the placeholder canvas screen from the browser entry", () => {
    // 画面そのものの確認（キャンバス名とアートボード名の一覧と追加ボタン）は、
    // 画面を作る次のTicketで実機確認する。ここでは登録の口だけ押さえる。
    const renderers = new Map<string, Parameters<VellymBrowserPluginHost["registerViewRenderer"]>[1]>();
    browserPlugin.activate({
      pluginId: "design",
      hostVersion: "0.5.0-beta",
      registerViewRenderer: (viewId, renderer) => renderers.set(viewId, renderer)
    });
    const renderer = renderers.get(DESIGN_CANVAS_VIEW_ID);
    expect(renderer).toBeDefined();
    expect(typeof renderer?.mount).toBe("function");
  });
});

describe("design kind schemas", () => {
  it("accepts the documented board and canvas shapes", () => {
    expect(validateKindSpec(
      { canvas: "ux-canvas", x: 0, y: 0, root: { id: "root", type: "frame", children: [] } },
      "30-設計/+boards/m1.yaml", DESIGN_BOARD_SPEC_SCHEMA))
      .toEqual([]);
    expect(validateKindSpec(
      { formatVersion: 1, pages: [{ id: "mobile", title: "スマホ" }], notes: [{ x: 0, y: -260, text: "スマホ", kind: "title" }], tokens: { files: ["tokens.tokens.json"] } },
      "30-設計/ux-canvas.yaml",
      DESIGN_CANVAS_SPEC_SCHEMA
    )).toEqual([]);
    expect(validateKindSpec({ formatVersion: 1 }, "30-設計/ux-canvas.yaml", DESIGN_CANVAS_SPEC_SCHEMA)).toEqual([]);
  });

  it("warns instead of rejecting when x is a string or root is missing", () => {
    const withStringX = validateKindSpec(
      { ...validBoardSpec(), x: "30px" },
      "30-設計/+boards/bad-x.yaml",
      DESIGN_BOARD_SPEC_SCHEMA
    );
    expect(withStringX.length).toBeGreaterThan(0);
    expect(withStringX.every((item) => item.severity === "warning")).toBe(true);
    expect(withStringX.some((item) => item.code === "PLUGIN_SPEC_SCHEMA_MISMATCH")).toBe(true);

    const withoutRoot = validateKindSpec(
      { canvas: "ux-canvas", x: 0, y: 0 },
      "30-設計/+boards/no-root.yaml",
      DESIGN_BOARD_SPEC_SCHEMA
    );
    expect(withoutRoot.length).toBeGreaterThan(0);
    expect(withoutRoot.every((item) => item.severity === "warning")).toBe(true);
    expect(withoutRoot.some((item) => item.code === "PLUGIN_SPEC_SCHEMA_MISMATCH")).toBe(true);
  });
});

describe("canvas resolution", () => {
  it("collects the boards whose spec.canvas points at the canvas", () => {
    const definitions = [
      canvas,
      record(DESIGN_CANVAS_KIND, "other-canvas", "30-設計/other-canvas.yaml"),
      board("b-front", validBoardSpec({ x: 400, order: 1 })),
      board("b-first", validBoardSpec({ order: 0 })),
      board("other", { ...validBoardSpec(), canvas: "other-canvas" }, "30-設計/+boards/other.yaml")
    ];
    const resolved = resolveCanvasBoards(
      { records: (kind) => definitions.filter((item) => item.kind === kind) },
      "ux-canvas"
    );
    expect(resolved.boards.map((item) => item.name)).toEqual(["b-first", "b-front"]);
    expect(resolved.notices).toEqual([]);
  });

  it("reports a board pointing at a missing canvas through reportDiagnostic", () => {
    const reported: { code?: string; severity?: string; file?: string }[] = [];
    const dangling = board("gone", { ...validBoardSpec(), canvas: "no-such-canvas" });
    const resolved = resolveCanvasBoards(
      {
        records: (kind) => [canvas, dangling].filter((item) => item.kind === kind),
        reportDiagnostic: (diagnostic) => reported.push(diagnostic)
      },
      "ux-canvas"
    );
    expect(reported).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "DESIGN_CANVAS_NOT_FOUND",
        file: "30-設計/+boards/gone.yaml",
        path: "/spec/canvas"
      })
    ]);
    // 画面にも同じ注意を載せる（ビュー用の文脈ではreportDiagnosticが省略される）
    expect(resolved.notices.map((item) => item.code)).toContain("DESIGN_CANVAS_NOT_FOUND");
  });

  it("warns about missing x or w without hiding the board", () => {
    const definitions = [
      canvas,
      board("no-x", { ...validBoardSpec(), x: undefined }),
      board("no-w", { canvas: "ux-canvas", x: 0, y: 0, title: "w欠落", html: "" })
    ];
    const reported: { code?: string; severity?: string }[] = [];
    const resolved = resolveCanvasBoards(
      {
        records: (kind) => definitions.filter((item) => item.kind === kind),
        reportDiagnostic: (diagnostic) => reported.push(diagnostic)
      },
      "ux-canvas"
    );
    expect(reported.map((item) => item.code)).toEqual([
      "DESIGN_BOARD_LAYOUT_INVALID",
      "DESIGN_BOARD_LAYOUT_INVALID"
    ]);
    expect(reported.every((item) => item.severity === undefined || item.severity === "warning")).toBe(true);
    // 壊れた配置でも一覧から隠さない。壊れた位置だけ`undefined`で残る（名前の順）
    expect(resolved.boards.map((item) => item.name)).toEqual(["no-w", "no-x"]);
    expect(resolved.boards.find((item) => item.name === "no-x")?.x).toBeUndefined();
    expect(resolved.boards.find((item) => item.name === "no-w")?.w).toBeUndefined();
  });

  it("warns about a board without spec.canvas", () => {
    const definitions = [canvas, board("loose", { x: 0, y: 0, w: 390, h: 844, title: "参照なし", html: "" })];
    const resolved = resolveCanvasBoards(
      { records: (kind) => definitions.filter((item) => item.kind === kind) },
      "ux-canvas"
    );
    expect(resolved.notices.map((item) => item.code)).toEqual(["DESIGN_BOARD_CANVAS_MISSING"]);
    expect(resolved.boards).toEqual([]);
  });

  it("passes the canvas boards and notices through the view descriptor as rendererData", () => {
    const { views } = activated();
    const contribution = views.get(DESIGN_CANVAS_VIEW_ID);
    expect(typeof contribution?.view).toBe("function");
    const descriptor = (contribution!.view as (context: PluginViewContext) => {
      type: string;
      fields: readonly unknown[];
      body: string;
      rendererData?: Readonly<Record<string, unknown>>;
    })(
      viewContext(canvas, [canvas, board("b1", validBoardSpec())])
    );
    expect(descriptor.type).toBe("detail");
    expect(descriptor.fields).toEqual([]);
    expect(descriptor.body).toBe("none");
    const rendererData = descriptor.rendererData!;
    expect(rendererData.canvasName).toBe("ux-canvas");
    expect((rendererData.boards as { name: string }[]).map((item) => item.name)).toEqual(["b1"]);
    expect(rendererData.notices).toEqual([]);
  });
});

describe("board placement", () => {
  it("starts at the origin and continues 80px right of the rightmost board", () => {
    expect(nextBoardPosition([])).toEqual({ x: 0, y: 0 });
    expect(nextBoardPosition([
      board("a", validBoardSpec({ x: 0, y: 40, w: 390, h: 844 })),
      board("b", validBoardSpec({ x: 500, y: 10, w: 300, h: 600 })),
      board("broken", validBoardSpec({ x: "30px" as unknown as number }))
    ])).toEqual({ x: 880, y: 10 });
  });
});

describe("creation commands", () => {
  it("create-canvas returns an empty draft and writes nothing itself", async () => {
    const { commands } = activated();
    const capture: CommandCapture = { drafts: [] };
    const command = commands.get(CREATE_CANVAS_COMMAND_ID)!;
    const failed = await command.run(
      commandContext({ input: { title: "  " }, capture })
    );
    expect(failed).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "DESIGN_CANVAS_TITLE_REQUIRED" })]
    });
    expect(capture.drafts).toEqual([]);

    const result = await command.run(
      commandContext({ input: { title: "UXキャンバス", folder: "30-設計" }, capture })
    );
    expect(result.ok).toBe(true);
    const draft = capture.drafts[0]!;
    expect(draft.kind).toBe(DESIGN_CANVAS_KIND);
    expect(draft.title).toBe("UXキャンバス");
    expect(draft.folder).toBe("30-設計");
    expect(draft.spec).toEqual({});
    expect(draft.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("create-board drafts a board under the canvas's +boards with an empty html", async () => {
    const { commands } = activated();
    const command = commands.get(CREATE_BOARD_COMMAND_ID)!;
    const noTarget = commandContext({ capture: { drafts: [] } });
    const rejected = await command.run(noTarget);
    expect(rejected).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "DESIGN_BOARD_CANVAS_TARGET_REQUIRED" })]
    });

    const capture: CommandCapture = { drafts: [] };
    const result = await command.run(
      commandContext({ target: canvas, definitions: [canvas], capture })
    );
    expect(result.ok).toBe(true);
    const draft = capture.drafts[0]!;
    expect(draft.kind).toBe(DESIGN_BOARD_KIND);
    expect(draft.folder).toBe("30-設計/+boards");
    expect(draft.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(draft.spec).toEqual({
      canvas: "ux-canvas",
      x: 0,
      y: 0,
      w: 390,
      h: 844,
      title: "新しいアートボード",
      html: ""
    });
  });

  it("places the new board 80px right of the same canvas and page only", async () => {
    const { commands } = activated();
    const command = commands.get(CREATE_BOARD_COMMAND_ID)!;
    const capture: CommandCapture = { drafts: [] };
    const definitions = [
      canvas,
      board("a", validBoardSpec({ x: 0, y: 0, w: 390, h: 844 })),
      board("b", { ...validBoardSpec(), canvas: "no-such-canvas", x: 900, y: 0, w: 400, h: 400 }),
      board("c", validBoardSpec({ x: 800, y: 0, w: 390, h: 844, page: "wide" }))
    ];
    await command.run(commandContext({ target: canvas, definitions, capture }));
    const spec = capture.drafts[0]!.spec as Record<string, unknown>;
    // 既定ページのアートボードは `a` の1枚だけ。`b`（別キャンバス参照）と
    // `c`（別ページ）は数えない
    expect(spec.x).toBe(390 + 80);
    expect(spec.y).toBe(0);
  });
});

describe("design plugin on the real runtime", () => {
  it("drafts with commands, writes one file on save, and reads broken boards as warnings", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "vellym-design-server-"));
    const root = path.join(project, "docs/content");
    await mkdir(path.join(root, "30-design/+boards"), { recursive: true });
    const canvasSource = `apiVersion: vellym.tasclub.com/v1
kind: DesignCanvas
metadata:
  name: ux-canvas
  title: UXキャンバス
spec: { formatVersion: 1 }
`;
    await writeFile(path.join(root, "30-design/ux-canvas.yaml"), canvasSource, "utf8");
    // `x`が文字列で`root`の無いアートボード。警告にはなるが、読めるものとして扱う
    const brokenSource = `apiVersion: vellym.tasclub.com/v1
kind: DesignBoard
metadata:
  name: broken-board
  title: 壊れた枠
spec:
  canvas: ux-canvas
  x: "30px"
  y: 0
  w: 390
  h: 844
  title: 壊れた枠
`;
    await writeFile(path.join(root, "30-design/+boards/broken-board.yaml"), brokenSource, "utf8");
    await mkdir(path.join(project, "node_modules/@vellym"), { recursive: true });
    await symlink(
      path.join(process.cwd(), "packages/plugin-design"),
      path.join(project, "node_modules/@vellym/design"),
      "dir"
    );
    await symlink(
      path.join(process.cwd(), "packages/plugin-api"),
      path.join(project, "node_modules/@vellym/plugin-api"),
      "dir"
    );
    const configPath = path.join(project, "vellym.config.yaml");
    await writeFile(
      configPath,
      `schemaVersion: "1.0"
contentRoot: docs/content
outputDir: dist/vellym
ui:
  language: ja
plugins:
  - "@vellym/design"
`,
      "utf8"
    );
    const ui = await mkdtemp(path.join(tmpdir(), "vellym-design-ui-"));
    await writeFile(path.join(ui, "index.html"), "<h1>UI</h1>", "utf8");
    const hostVersion = (
      JSON.parse(
        await readFile(path.join(process.cwd(), "packages/vellym/package.json"), "utf8")
      ) as { version: string }
    ).version;
    const server = await startDevServer({ configPath, uiRoot: ui, hostVersion, port: 0 });
    try {
      const repository = await fetch(`${server.url}/api/v1/repository`);
      expect(repository.status).toBe(200);
      const repositoryBody = await repository.json() as {
        data: { pages: { name: string }[] };
        diagnostics: { severity: string; code: string; file: string }[];
      };
      const mismatches = repositoryBody.diagnostics.filter(
        (item) => item.code === "PLUGIN_SPEC_SCHEMA_MISMATCH"
      );
      expect(mismatches.length).toBeGreaterThan(0);
      expect(
        mismatches.every(
          (item) => item.severity === "warning" && item.file === "30-design/+boards/broken-board.yaml"
        )
      ).toBe(true);
      expect(
        repositoryBody.diagnostics.filter(
          (item) => item.severity === "error" && item.file === "30-design/+boards/broken-board.yaml"
        )
      ).toEqual([]);
      expect(repositoryBody.data.pages.map((page) => page.name)).toContain("ux-canvas");

      // コマンドはドラフトを返すだけで、ファイルを書かない
      const canvasDraft = await fetch(
        `${server.url}/api/v1/plugins/commands/${CREATE_CANVAS_COMMAND_ID}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: { title: "Second canvas", folder: "30-design" } })
        }
      );
      expect(canvasDraft.status).toBe(200);
      const canvasDraftBody = await canvasDraft.json() as {
        data: { draft: { name: string }; relativePath: string };
      };
      await expect(
        access(path.join(root, canvasDraftBody.data.relativePath))
      ).rejects.toThrow();

      const boardDraft = await fetch(
        `${server.url}/api/v1/plugins/commands/${CREATE_BOARD_COMMAND_ID}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: "ux-canvas" })
        }
      );
      expect(boardDraft.status).toBe(200);
      const boardDraftBody = await boardDraft.json() as {
        data: {
          draft: { name: string; kind: string; spec: Record<string, unknown> };
          relativePath: string;
        };
      };
      expect(boardDraftBody.data.relativePath).toBe(
        `30-design/+boards/${boardDraftBody.data.draft.name}.yaml`
      );
      expect(boardDraftBody.data.draft.kind).toBe(DESIGN_BOARD_KIND);
      expect(boardDraftBody.data.draft.spec.canvas).toBe("ux-canvas");
      expect(boardDraftBody.data.draft.spec.html).toBe("");
      await expect(
        access(path.join(root, boardDraftBody.data.relativePath))
      ).rejects.toThrow();

      // 保存で書かれるのはそのアートボード1ファイルだけ。キャンバスは変わらない
      const saved = await fetch(`${server.url}/api/v1/plugins/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseHash: null, draft: boardDraftBody.data.draft })
      });
      expect(saved.status).toBe(201);
      const savedBoard = await readFile(
        path.join(root, boardDraftBody.data.relativePath),
        "utf8"
      );
      expect(savedBoard).toContain(`kind: ${DESIGN_BOARD_KIND}`);
      expect(savedBoard).toContain("canvas: ux-canvas");
      expect(await readFile(path.join(root, "30-design/ux-canvas.yaml"), "utf8"))
        .toBe(canvasSource);
      expect((await readdir(path.join(root, "30-design/+boards"))).sort()).toEqual([
        "broken-board.yaml",
        `${boardDraftBody.data.draft.name}.yaml`
      ]);

      // 保存済みのキャンバス作成ドラフトも同じ経路で1ファイルになる
      const savedCanvas = await fetch(`${server.url}/api/v1/plugins/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseHash: null, draft: canvasDraftBody.data.draft })
      });
      expect(savedCanvas.status).toBe(201);
      const canvasFile = await readFile(
        path.join(root, canvasDraftBody.data.relativePath),
        "utf8"
      );
      expect(canvasFile).toContain(`kind: ${DESIGN_CANVAS_KIND}`);
    } finally {
      await server.close();
    }
  });
});
