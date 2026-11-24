import type { DesignComponentSpec, DesignNode, NodeOverride, SharedStyle } from "../model/types.js";

/** Token file loading/mode selection belongs to the caller; values here are CSS-ready. */
export interface ResolveContext {
  styles?: Readonly<Record<string, SharedStyle>>;
  components?: Readonly<Record<string, DesignComponentSpec>>;
  tokens?: Readonly<Record<string, string | number>>;
  resolveToken?: (path: string) => string | number | undefined;
  tokenMode?: "value" | "variable";
  assetUrl?: (asset: string) => string | undefined;
  onDiagnostic?: (diagnostic: ResolveDiagnostic) => void;
}
export interface ResolveDiagnostic {
  code: "missing-token" | "cyclic-token" | "missing-style" | "missing-component" | "cyclic-component" | "missing-variant";
  reference: string;
}
function report(ctx: ResolveContext, code: ResolveDiagnostic["code"], reference: string): void {
  ctx.onDiagnostic?.({ code, reference });
}

/** Undefined means omit this declaration, not emit an invalid token reference. */
export function resolveValue(value: string | number, ctx: ResolveContext = {}, seen = new Set<string>()): string | number | undefined {
  if (typeof value !== "string" || !/^\{[^{}\s]+\}$/.test(value)) return value;
  const path = value.slice(1, -1);
  if (ctx.tokenMode === "variable") return `var(--${path.replaceAll(".", "-")})`;
  if (seen.has(path)) {
    report(ctx, "cyclic-token", path);
    return undefined;
  }
  const result = ctx.resolveToken?.(path) ?? ctx.tokens?.[path];
  if (result === undefined) {
    report(ctx, "missing-token", path);
    return undefined;
  }
  return resolveValue(result, ctx, new Set([...seen, path]));
}

/** Merge only the nested layout object; paint arrays and other values replace. */
function merge<T extends object>(base: T, extra: object): T {
  const result = { ...base, ...extra } as T & { layout?: object };
  const a = (base as { layout?: object }).layout;
  const b = (extra as { layout?: object }).layout;
  if (a || b) result.layout = { ...a, ...b };
  return result;
}

export function resolveStyles(node: DesignNode, ctx: ResolveContext = {}): DesignNode {
  let appearance: object = {};
  for (const name of node.styles ?? []) {
    const style = ctx.styles?.[name];
    if (style) appearance = merge(appearance, style);
    else report(ctx, "missing-style", name);
  }
  return merge(appearance, node) as DesignNode;
}

function applyOverride(node: DesignNode, override: NodeOverride | undefined): DesignNode {
  if (!override) return node;
  // Even when called with untrusted JS, an override must never replace the tree.
  const { children: _children, ...appearance } = override;
  const result = { ...node, ...appearance } as DesignNode;
  if (result.type === "text") {
    if (override.text !== undefined) delete result.spans;
    else if (override.spans !== undefined) delete result.text;
  }
  return result;
}

/**
 * Expand instances without mutating the saved tree. IDs inside an instance remain
 * component-local; renderers should key them by their instance path.
 * A missing/cyclic component remains an instance for the renderer's error box.
 */
export function resolveNode(node: DesignNode, ctx: ResolveContext = {}): DesignNode {
  function visit(
    input: DesignNode,
    stack: readonly string[],
    properties: Readonly<Record<string, string | boolean>> = {},
    overrides: Readonly<Record<string, NodeOverride>> = {},
    path = "",
  ): DesignNode {
    let bound = { ...input } as DesignNode;
    if (input.bind?.text && bound.type === "text" && typeof properties[input.bind.text] === "string") {
      bound = { ...bound, text: properties[input.bind.text] as string } as DesignNode;
      delete (bound as { spans?: unknown }).spans;
    }
    if (input.bind?.visible && typeof properties[input.bind.visible] === "boolean") bound.visible = properties[input.bind.visible] as boolean;
    if (input.bind?.component && bound.type === "instance" && typeof properties[input.bind.component] === "string") {
      bound.component = properties[input.bind.component] as string;
    }
    let current = resolveStyles(applyOverride(bound, overrides[path]), ctx);
    if (current.type === "instance") {
      const instance = current;
      const component = ctx.components?.[instance.component];
      if (!component || stack.includes(instance.component)) {
        report(ctx, component ? "cyclic-component" : "missing-component", instance.component);
        return current;
      }
      const values: Record<string, string | boolean> = {};
      const variants: Record<string, string> = {};
      for (const [key, property] of Object.entries(component.properties ?? {})) {
        values[key] = property.default;
        if (property.type === "variant") variants[key] = property.default;
      }
      Object.assign(values, instance.properties);
      Object.assign(variants, instance.variant);
      const root = component.root ?? component.variants?.find(v =>
        Object.entries(v.values).every(([key, value]) => variants[key] === value))?.root;
      if (!root) {
        report(ctx, "missing-variant", instance.component);
        return current;
      }
      const nestedOverrides: Record<string, NodeOverride> = { ...instance.overrides };
      // Outer instance overrides win over the nested instance's own overrides.
      for (const [key, value] of Object.entries(overrides)) {
        if (key.startsWith(`${path}/`)) {
          const local = key.slice(path.length + 1);
          nestedOverrides[local] = { ...nestedOverrides[local], ...value };
        }
      }
      let expanded = visit(root, [...stack, instance.component], values, nestedOverrides, "");
      const { type: _type, component: _component, variant: _variant, properties: _properties,
        overrides: _overrides, styles: _styles, bind: _bind, ...instanceFields } = instance;
      expanded = merge(expanded, instanceFields);
      return expanded;
    }
    if ("children" in current && Array.isArray(current.children)) {
      current = { ...current, children: current.children.map(child =>
        visit(child, stack, properties, overrides, path ? `${path}/${child.id}` : child.id)) } as DesignNode;
    }
    return current;
  }
  return visit(node, []);
}
