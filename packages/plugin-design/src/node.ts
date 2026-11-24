import { definePlugin } from "@vellym/plugin-api";
import type { PluginResourceRecord } from "@vellym/plugin-api";
import {
  CREATE_BOARD_COMMAND_ID, CREATE_CANVAS_COMMAND_ID, DESIGN_CANVAS_VIEW_ID,
  DESIGN_CANVAS_KIND, DESIGN_BOARD_KIND, DESIGN_COMPONENT_KIND, DESIGN_STYLES_KIND,
  DESIGN_CANVAS_SPEC_SCHEMA, DESIGN_BOARD_SPEC_SCHEMA,
  DESIGN_COMPONENT_SPEC_SCHEMA, DESIGN_STYLES_SPEC_SCHEMA
} from "./model/index.js";
import { canvasResourceName, childResourceName, folderOf } from "./model/names.js";
import { validateDesign } from "./model/validate.js";
import { designText as text } from "./i18n.js";

function row(record: PluginResourceRecord) {
  return { name: record.name, title: record.title, relativePath: record.relativePath, spec: record.spec };
}
const root = () => ({ id: "root", type: "frame", width: 390, height: 844, children: [] });

export default definePlugin({
  activate(host) {
    for (const [kind, specSchema] of [
      [DESIGN_CANVAS_KIND, DESIGN_CANVAS_SPEC_SCHEMA],
      [DESIGN_BOARD_KIND, DESIGN_BOARD_SPEC_SCHEMA],
      [DESIGN_COMPONENT_KIND, DESIGN_COMPONENT_SPEC_SCHEMA],
      [DESIGN_STYLES_KIND, DESIGN_STYLES_SPEC_SCHEMA]
    ] as const) {
      host.registerKind({ kind, specSchema, showInDocumentTree: kind === DESIGN_CANVAS_KIND, hasBlocks: false });
    }
    // Keep all four kinds as definition records so views and validation read the same source.
    host.registerRecordSetValidator(DESIGN_CANVAS_KIND, (_rows, context) => validateDesign(context));
    host.registerView({
      id: DESIGN_CANVAS_VIEW_ID, label: text.canvas, static: false,
      view(context) {
        const canvas = context.target?.kind === DESIGN_CANVAS_KIND ? context.target : undefined;
        const children = (kind: string) => context.records(kind)
          .filter((r) => r.spec.canvas === canvas?.name)
          .slice().sort((a, b) => a.name.localeCompare(b.name)).map(row);
        return {
          type: "detail", id: DESIGN_CANVAS_VIEW_ID, kind: DESIGN_CANVAS_KIND,
          fields: [], body: "none", undeclaredFields: "hidden",
          rendererData: {
            canvas: canvas ? row(canvas) : null,
            boards: children(DESIGN_BOARD_KIND), components: children(DESIGN_COMPONENT_KIND),
            styles: context.records(DESIGN_STYLES_KIND).filter((r) => r.name === canvas?.spec.styles).map(row),
            tokenFiles: [],
            notices: validateDesign(context).map((d) => ({
              code: d.code, file: d.file,
              ...(typeof d.message === "string" ? { ja: d.message, en: d.message } : d.message)
            }))
          }
        };
      }
    });
    host.registerCommand({
      id: CREATE_CANVAS_COMMAND_ID, title: text.createCanvas, static: false, placement: "document-tree",
      inputs: [{ id: "title", label: text.name, type: "text", path: ["title"], required: true }],
      run(context) {
        const title = typeof context.input?.title === "string" ? context.input.title.trim() : "";
        if (!title) return { ok: false, diagnostics: [{
          file: ".", severity: "warning", code: "DESIGN_CANVAS_TITLE_REQUIRED", message: text.nameRequired
        }] };
        const name = canvasResourceName(title);
        const parent = typeof context.input?.folder === "string" ? context.input.folder.trim()
          : context.target ? folderOf(context.target.relativePath) : "";
        return context.createResource({
          kind: DESIGN_CANVAS_KIND, name, title, folder: [parent, name].filter(Boolean).join("/"),
          spec: { formatVersion: 1 }
        });
      }
    });
    for (const [kind, id, title] of [
      [DESIGN_BOARD_KIND, CREATE_BOARD_COMMAND_ID, text.createBoard],
      [DESIGN_COMPONENT_KIND, "design.create-component", text.createComponent],
      [DESIGN_STYLES_KIND, "design.create-styles", text.createStyles]
    ] as const) {
      host.registerCommand({
        id, title, static: false,
        run(context) {
          const canvas = context.target?.kind === DESIGN_CANVAS_KIND ? context.target : undefined;
          if (!canvas) return { ok: false, diagnostics: [{
            file: ".", severity: "warning", code: "DESIGN_BOARD_CANVAS_TARGET_REQUIRED", message: text.canvasRequired
          }] };
          const folder = folderOf(canvas.relativePath);
          const isStyles = kind === DESIGN_STYLES_KIND;
          const isBoard = kind === DESIGN_BOARD_KIND;
          const siblings = context.records(DESIGN_BOARD_KIND).filter((r) =>
            r.spec.canvas === canvas.name && r.spec.page === undefined);
          const x = Math.max(0, ...siblings.map((r) => {
            const width = (r.spec.root as { width?: unknown } | undefined)?.width;
            return typeof r.spec.x === "number" && typeof width === "number" ? r.spec.x + width + 80 : 0;
          }));
          return context.createResource({
            kind, name: isStyles ? `${canvas.name}-styles` : childResourceName(canvas.name, isBoard ? "board" : "component"),
            title: title[context.locale === "ja" ? "ja" : "en"],
            folder: [folder, isStyles ? "" : isBoard ? "+boards" : "+components"].filter(Boolean).join("/"),
            spec: isStyles ? { styles: {} } : { canvas: canvas.name, x: isBoard ? x : 0, y: 0, root: root() }
          });
        }
      });
    }
  }
});
