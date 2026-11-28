import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import type {
  PluginCommandContext, PluginResourceDraft, PluginResourceRecord, PluginViewContext, VellymPluginHost
} from "@vellym/plugin-api";
import { validateKindSpec, validatePluginManifest } from "@vellym-internal/core";
import plugin from "../packages/plugin-design/src/node.js";
import { validateDesign } from "../packages/plugin-design/src/model/validate.js";

function record(kind: string, name: string, spec: Record<string, unknown> = {}): PluginResourceRecord {
  return { kind, name, title: name, relativePath: `${name}.yaml`, spec, readOnly: false };
}
function context(records: PluginResourceRecord[]) {
  return { records: (kind: string) => records.filter((r) => r.kind === kind) };
}
function activated() {
  const kinds: Parameters<VellymPluginHost["registerKind"]>[0][] = [];
  const commands: Parameters<VellymPluginHost["registerCommand"]>[0][] = [];
  const views: Parameters<VellymPluginHost["registerView"]>[0][] = [];
  const validators: Parameters<VellymPluginHost["registerRecordSetValidator"]>[1][] = [];
  plugin.activate({
    pluginId: "design", hostVersion: "0.6.0-beta",
    registerKind: (v) => { kinds.push(v); },
    registerCommand: (v) => { commands.push(v); },
    registerView: (v) => { views.push(v); },
    registerRecordProjection: () => { throw new Error("Design resources must stay in records()"); },
    registerRecordSetValidator: (_kind, v) => { validators.push(v); },
    registerFileKind: () => {}, registerFileSetValidator: () => {},
    reportDiagnostic: () => {}
  });
  return { kinds, commands, views, validators };
}
const canvas = record("DesignCanvas", "app", { formatVersion: 1, styles: "app-styles" });
const frame = { id: "root", type: "frame", width: 390, height: 844, children: [] };
const board = (spec = {}) => record("DesignBoard", "home", { canvas: "app", x: 0, y: 0, root: frame, ...spec });
const component = (name = "button", spec = {}) =>
  record("DesignComponent", name, { canvas: "app", root: frame, ...spec });
const styles = record("DesignStyles", "app-styles", { styles: { primary: { radius: 8 } } });

describe("design registration and commands", () => {
  it("registers four matching manifest kinds, commands and a real validator", () => {
    const { kinds, commands, validators } = activated();
    const manifest = JSON.parse(readFileSync("packages/plugin-design/package.json", "utf8")).vellym;
    expect(validatePluginManifest(manifest).errors).toEqual([]);
    expect(kinds.map(({ specSchema: _, ...v }) => v)).toEqual(manifest.contributes.kinds);
    expect(kinds.filter((k) => k.showInDocumentTree).map((k) => k.kind)).toEqual(["DesignCanvas"]);
    expect(commands.map((c) => c.id)).toEqual(manifest.contributes.commands.map((c: { id: string }) => c.id));
    expect(validators).toHaveLength(1);
    expect(validators[0]!([], context([board()]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DESIGN_CANVAS_NOT_FOUND" })
    ]));
  });
  it("creates valid drafts with metadata-name filenames with canvases directly in the chosen folder", async () => {
    const { commands, kinds } = activated();
    const drafts: PluginResourceDraft[] = [];
    const commandContext: PluginCommandContext = {
      ...context([canvas, board()]), target: { ...canvas, relativePath: "design/app/app.yaml" },
      locale: "en", input: { title: "My app", folder: "design" },
      createResource: async (draft) => {
        drafts.push(draft);
        return { ok: true, name: draft.name!, draft: { ...draft, name: draft.name! } };
      }
    };
    for (const c of commands) expect((await c.run(commandContext)).ok).toBe(true);
    expect(drafts[0]!.folder).toBe("design");
    expect(drafts[0]!.spec).toEqual({ formatVersion: 1 });
    expect(drafts[1]!.folder).toBe("design/app/+boards");
    expect(drafts[1]!.spec.x).toBe(470);
    expect(drafts[2]!.folder).toBe("design/app/+components");
    expect(drafts[3]!.folder).toBe("design/app");
    expect(drafts[3]!.name).toBe("app-styles");
    for (const draft of drafts) {
      expect(draft.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(validateKindSpec(draft.spec, `${draft.folder}/${draft.name}.yaml`,
        kinds.find((k) => k.kind === draft.kind)!.specSchema!)).toEqual([]);
    }
    expect((await commands[0]!.run({ ...commandContext, input: { title: " " } })).ok).toBe(false);
    for (const c of commands.slice(1)) {
      expect((await c.run({ ...commandContext, target: undefined })).ok).toBe(false);
    }
    await commands[0]!.run(commandContext);
    expect(drafts.at(-1)!.name).not.toBe(drafts[0]!.name);
  });
  it("passes raw resource specs and paths, scoped by canvas, without hashes or token files", () => {
    const { views } = activated();
    const records = [canvas, board(), component(), styles, board({ canvas: "other" })];
    const view = views[0]!.view as (c: PluginViewContext) => { rendererData?: unknown };
    const data = view({ ...context(records), target: canvas, locale: "en", isStatic: false }).rendererData;
    const row = ({ name, title, relativePath, spec }: PluginResourceRecord) => ({ name, title, relativePath, spec });
    expect(data).toMatchObject({
      canvas: row(canvas), boards: [row(board())], components: [row(component())],
      styles: [row(styles)], tokenFiles: []
    });
    expect(JSON.stringify(data)).not.toContain('"hash"');
  });
});

describe("cross-resource validation", () => {
  function codes(records: PluginResourceRecord[]) {
    return validateDesign(context(records)).map((d) => d.code);
  }
  it("validates the sample canvas and every sample kind schema with zero diagnostics", () => {
    const records: PluginResourceRecord[] = [];
    function load(folder: string) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) load(file);
        else {
          const raw = parse(readFileSync(file, "utf8"));
          records.push({ ...record(raw.kind, raw.metadata.name, raw.spec), relativePath: file });
        }
      }
    }
    load("tests/fixtures/design-canvas");
    expect(records.filter((r) => r.kind === "DesignBoard")).toHaveLength(2);
    expect(validateDesign(context(records))).toEqual([]);
    for (const r of records) expect(validateKindSpec(r.spec, r.relativePath,
      activated().kinds.find((k) => k.kind === r.kind)!.specSchema!)).toEqual([]);
  });
  it("checks canvas, shared style resource, style names, components and board destinations", () => {
    expect(codes([board(), component()])).toEqual(["DESIGN_CANVAS_NOT_FOUND", "DESIGN_CANVAS_NOT_FOUND"]);
    expect(codes([canvas])).toEqual(["DESIGN_STYLES_NOT_FOUND"]);
    const broken = board({ root: { ...frame, children: [{
      id: "button", type: "instance", component: "missing", styles: ["missing"],
      reactions: [{ action: "navigate", destination: "missing" }, { action: "openUrl", destination: "https://example.org" }]
    }] } });
    expect(codes([canvas, styles, broken])).toEqual([
      "DESIGN_COMPONENT_NOT_FOUND", "DESIGN_STYLE_NOT_FOUND", "DESIGN_BOARD_NOT_FOUND"
    ]);
    expect(codes([canvas, styles, board({ root: {
      ...frame, children: [{ id: "button", type: "instance", component: "button", styles: ["primary"] }]
    } }), component()])).toEqual([]);
  });
  it("checks node IDs across variants but not across files or opaque extension data", () => {
    const variants = [{ id: "a", values: {}, root: frame }, { id: "b", values: {}, root: frame }];
    expect(codes([canvas, styles, component("button", { root: undefined, variants })])).toContain("DESIGN_NODE_ID_DUPLICATE");
    expect(codes([canvas, styles, board(), component()])).toEqual([]);
    expect(codes([canvas, styles, board({ extensions: { root: frame } })])).toEqual([]);
    expect(codes([canvas, styles, board({ root: { ...frame, children: [frame] } })])).toEqual(["DESIGN_NODE_ID_DUPLICATE"]);
  });
  it("checks nested component cycles, including instance-swap defaults and values", () => {
    const instance = (name: string) => ({ id: "root", type: "instance", component: name });
    expect(codes([canvas, styles, component("a", { root: instance("b") }),
      component("b", { root: instance("a") })])).toContain("DESIGN_COMPONENT_CYCLE");
    expect(codes([canvas, styles, component("a", { root: instance("a") })])).toContain("DESIGN_COMPONENT_CYCLE");
    expect(codes([canvas, styles, component("a", { root: instance("b") }), component("b")])).toEqual([]);
    expect(codes([canvas, styles, component("a", {
      properties: { icon: { type: "instanceSwap", default: "a" } }
    })])).toContain("DESIGN_COMPONENT_CYCLE");
    expect(codes([canvas, styles, component("a", {
      properties: { icon: { type: "instanceSwap", default: "absent" } }
    })])).toContain("DESIGN_COMPONENT_NOT_FOUND");
  });
  it("rejects absolute and backslash implementation paths with precise diagnostic locations", () => {
    for (const value of ["/src/Home.tsx", "C:/src/Home.tsx", "src\\Home.tsx", "\\\\server\\Home.tsx"]) {
      expect(validateDesign(context([canvas, styles, board({ implementedBy: [value] })]))).toEqual([
        expect.objectContaining({ code: "DESIGN_IMPLEMENTED_BY_INVALID", path: "/spec/implementedBy/0",
          severity: "error", file: "home.yaml", message: { ja: expect.any(String), en: expect.any(String) } })
      ]);
    }
    expect(codes([canvas, styles, board({ implementedBy: ["src/Home.tsx"] })])).toEqual([]);
  });
});
