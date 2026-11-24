import type { PluginDefinitionContext, PluginDiagnostic, PluginResourceRecord } from "@vellym/plugin-api";
import { designText as text } from "../i18n.js";
import {
  DESIGN_CANVAS_KIND, DESIGN_BOARD_KIND, DESIGN_COMPONENT_KIND, DESIGN_STYLES_KIND
} from "./index.js";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

/** Visit only structural nodes; extensions, overrides and property data are opaque. */
export function nodesOf(spec: Readonly<ObjectValue>): { node: ObjectValue; path: string }[] {
  const result: { node: ObjectValue; path: string }[] = [];
  function visit(value: unknown, path: string) {
    const node = object(value);
    if (!Object.keys(node).length) return;
    result.push({ node, path });
    array(node.children).forEach((child, i) => visit(child, `${path}/children/${i}`));
  }
  visit(spec.root, "/spec/root");
  array(spec.variants).forEach((variant, i) =>
    visit(object(variant).root, `/spec/variants/${i}/root`));
  return result;
}

export function validateDesign(context: Pick<PluginDefinitionContext, "records">): PluginDiagnostic[] {
  const canvases = new Map(context.records(DESIGN_CANVAS_KIND).map((r) => [r.name, r]));
  const components = new Map(context.records(DESIGN_COMPONENT_KIND).map((r) => [r.name, r]));
  const boards = new Set(context.records(DESIGN_BOARD_KIND).map((r) => r.name));
  const styles = new Map(context.records(DESIGN_STYLES_KIND).map((r) => [r.name, r]));
  const diagnostics: PluginDiagnostic[] = [];
  function report(record: PluginResourceRecord, path: string, code: string, key: keyof typeof text) {
    diagnostics.push({ file: record.relativePath, path, code, severity: "error", message: text[key] });
  }
  for (const canvas of canvases.values()) {
    if (typeof canvas.spec.styles === "string" && !styles.has(canvas.spec.styles)) {
      report(canvas, "/spec/styles", "DESIGN_STYLES_NOT_FOUND", "stylesMissing");
    }
  }
  const edges = new Map<string, Set<string>>();
  for (const record of [...context.records(DESIGN_BOARD_KIND), ...components.values()]) {
    const canvas = canvases.get(String(record.spec.canvas));
    if (!canvas) report(record, "/spec/canvas", "DESIGN_CANVAS_NOT_FOUND", "canvasMissing");
    const styleRecord = canvas && styles.get(String(canvas.spec.styles));
    const availableStyles = object(styleRecord?.spec.styles);
    const refs = new Set<string>();
    function reference(value: unknown, path: string) {
      if (typeof value !== "string") return;
      refs.add(value);
      if (!components.has(value)) report(record, path, "DESIGN_COMPONENT_NOT_FOUND", "componentMissing");
    }
    for (const [key, value] of Object.entries(object(record.spec.properties))) {
      const property = object(value);
      if (property.type === "instanceSwap") reference(property.default, `/spec/properties/${key}/default`);
    }
    const ids = new Set<unknown>();
    for (const { node, path } of nodesOf(record.spec)) {
      if (typeof node.id === "string") {
        if (ids.has(node.id)) report(record, `${path}/id`, "DESIGN_NODE_ID_DUPLICATE", "duplicateId");
        ids.add(node.id);
      }
      if (node.type === "instance") {
        reference(node.component, `${path}/component`);
        const definition = components.get(String(node.component));
        for (const [key, value] of Object.entries(object(node.properties))) {
          if (object(object(definition?.spec.properties)[key]).type === "instanceSwap") {
            reference(value, `${path}/properties/${key}`);
          }
        }
      }
      array(node.styles).forEach((style, i) => {
        if (typeof style === "string" && !Object.hasOwn(availableStyles, style)) {
          report(record, `${path}/styles/${i}`, "DESIGN_STYLE_NOT_FOUND", "styleMissing");
        }
      });
      array(node.reactions).forEach((value, i) => {
        const reaction = object(value);
        if (["navigate", "overlay", "swapOverlay"].includes(String(reaction.action)) &&
            (typeof reaction.destination !== "string" || !boards.has(reaction.destination))) {
          report(record, `${path}/reactions/${i}/destination`, "DESIGN_BOARD_NOT_FOUND", "boardMissing");
        }
      });
    }
    array(record.spec.implementedBy).forEach((value, i) => {
      if (typeof value === "string" && (/^(?:\/|[a-z]:)/i.test(value) || value.includes("\\"))) {
        report(record, `/spec/implementedBy/${i}`, "DESIGN_IMPLEMENTED_BY_INVALID", "implementedBy");
      }
    });
    if (record.kind === DESIGN_COMPONENT_KIND) edges.set(record.name, refs);
  }
  // Three-colour DFS: shared subgraphs are visited once, back edges diagnose cycles.
  const active = new Set<string>(), complete = new Set<string>();
  function visit(name: string) {
    if (complete.has(name)) return;
    active.add(name);
    for (const ref of edges.get(name) ?? []) {
      if (active.has(ref)) report(components.get(name)!, "/spec", "DESIGN_COMPONENT_CYCLE", "cycle");
      else if (components.has(ref)) visit(ref);
    }
    active.delete(name);
    complete.add(name);
  }
  for (const name of components.keys()) visit(name);
  return diagnostics;
}
