import type { PluginFileRecord } from "@vellym/plugin-api";
import { mergeTokens, object, readTokens } from "./dtcg.js";
import { resolveTokens, type TokenResolution } from "./resolve.js";
import { tokenDiagnostic } from "./validate.js";

export interface ResolverResult extends TokenResolution {
  document: unknown;
  modifiers: Readonly<Record<string, readonly string[]>>;
}
const normalize = (s: string): string => {
  const parts: string[] = [];
  for (const p of s.split("/")) {
    if (p === "..") { if (!parts.length) throw new Error("Outside content root"); parts.pop(); }
    else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
};
const pointer = (root: unknown, fragment: string): unknown => {
  if (!fragment) return root;
  if (!fragment.startsWith("/")) throw new Error("Invalid pointer");
  let value = root;
  for (const part of fragment.slice(1).split("/")) {
    const key = decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~");
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) throw new Error("Missing reference");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};

/**
 * Registered documents only: no filesystem, network or global state.
 * Local $ref siblings override shallowly (Resolver §4.2.2).
 */
function prepareResolver(value: unknown, file: string, files: readonly PluginFileRecord[]) {
  const origins = new WeakMap<object, string>();
  const referencedFiles = new Set<string>();
  const documents = new Map(files.map(f => [f.relativePath, f.value]));
  documents.set(file, value);
  function expand(v: unknown, currentFile: string, stack: Set<unknown>, allowModifier = false): unknown {
    if (Array.isArray(v)) return v.map(x => expand(x, currentFile, stack));
    if (!object(v)) return v;
    if (stack.has(v)) throw new Error("Circular reference");
    const next = new Set(stack).add(v);
    if ("$ref" in v) {
      if (typeof v.$ref !== "string") throw new Error("Invalid reference");
      const [uri = "", fragment = ""] = v.$ref.split("#");
      if (/^[a-z][a-z\d+.-]*:|^[/\\]/i.test(uri) || uri.includes("\\")) throw new Error("Unsupported URI");
      if (/^\/resolutionOrder(?:\/|$)/.test(fragment) ||
          (!allowModifier && /^\/modifiers(?:\/|$)/.test(fragment))) throw new Error("Invalid pointer target");
      const targetFile = uri ? normalize(`${currentFile.split("/").slice(0, -1).join("/")}/${uri}`) : currentFile;
      if (!documents.has(targetFile)) throw new Error("Missing registered source");
      if (uri) referencedFiles.add(targetFile);
      const target = pointer(documents.get(targetFile), fragment);
      const base = expand(target, targetFile, next);
      const local = Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$ref")
        .map(([k, x]) => [k, expand(x, currentFile, next)]));
      if (!Object.keys(local).length) return base;
      const result = { ...(object(base) ? base : {}), ...local };
      origins.set(result, currentFile);
      return result;
    }
    const result = Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
      k === "resolutionOrder" && Array.isArray(x)
        ? x.map(item => expand(item, currentFile, next, true))
        : expand(x, currentFile, next)]));
    origins.set(result, currentFile);
    return result;
  }
  if (!object(value) || value.version !== "2025.10" || !Array.isArray(value.resolutionOrder)) throw new Error("Invalid resolver");
  const expanded = expand(value, file, new Set());
  if (!object(expanded) || !Array.isArray(expanded.resolutionOrder)) throw new Error("Invalid resolver");
  const modifiers: Record<string, Record<string, unknown>> = Object.create(null);
  if (expanded.modifiers !== undefined && !object(expanded.modifiers)) throw new Error("Invalid modifiers");
  for (const [name, modifier] of Object.entries(expanded.modifiers ?? {})) {
    if (!object(modifier)) throw new Error("Invalid modifier");
    modifiers[name] = modifier;
  }
  const names = new Set<string>();
  const order = expanded.resolutionOrder.map((item, index) => {
    if (!object(item)) throw new Error("Invalid resolutionOrder");
    const original = value.resolutionOrder as unknown[];
    const entry = original[index];
    const ref = object(entry) && typeof entry.$ref === "string" ? entry.$ref : undefined;
    const name = ref ? ref.split("/").at(-1)!.replaceAll("~1", "/").replaceAll("~0", "~") : item.name;
    if (typeof name !== "string" || names.has(name)) throw new Error("Duplicate or missing name");
    names.add(name);
    const type = ref ? ("contexts" in item ? "modifier" : "set") : item.type;
    if (type !== "set" && type !== "modifier") throw new Error("Invalid inline type");
    if (type === "modifier") modifiers[name] = item;
    return { name, type, item };
  });
  for (const modifier of Object.values(modifiers)) {
    if (!object(modifier.contexts) || !Object.keys(modifier.contexts).length
      || !Object.values(modifier.contexts).every(Array.isArray)
      || (modifier.default !== undefined && (typeof modifier.default !== "string"
        || !Object.hasOwn(modifier.contexts, modifier.default)))) throw new Error("Invalid modifier contexts/default");
  }
  function sources(v: unknown): unknown {
    if (!Array.isArray(v)) throw new Error("Invalid sources");
    return v.reduce<unknown>((result, source) => {
      if (!object(source)) throw new Error("Invalid source");
      if ("contexts" in source) throw new Error("Modifier as source");
      return mergeTokens(result, "sources" in source ? sources(source.sources) : source);
    }, {});
  }
  // Validate every declared set, including ones not selected in resolutionOrder.
  if (expanded.sets !== undefined && !object(expanded.sets)) throw new Error("Invalid sets");
  for (const set of Object.values(expanded.sets ?? {})) {
    if (!object(set)) throw new Error("Invalid set");
    sources(set.sources);
  }
  for (const modifier of Object.values(modifiers)) {
    for (const context of Object.values(modifier.contexts as Record<string, unknown>)) sources(context);
  }
  return { modifiers, order, sources, origins, referencedFiles };
}

export function resolverReferencedFiles(value: unknown, files: readonly PluginFileRecord[], file: string): ReadonlySet<string> {
  try { return prepareResolver(value, file, files).referencedFiles; } catch { return new Set(); }
}

export function resolveResolver(value: unknown, files: readonly PluginFileRecord[] = [],
  input: Readonly<Record<string, string>> = {}, file = "."): ResolverResult {
  try {
    const { modifiers, order, sources, origins } = prepareResolver(value, file, files);
    for (const [name, context] of Object.entries(input)) {
      if (!Object.hasOwn(modifiers, name) || typeof context !== "string"
        || !Object.hasOwn(modifiers[name]!.contexts as object, context)) throw new Error("Invalid input");
    }
    const selected: Record<string, string> = Object.create(null);
    for (const [name, modifier] of Object.entries(modifiers)) {
      const context = input[name] ?? modifier.default;
      if (typeof context !== "string" || !Object.hasOwn(modifier.contexts as object, context)) throw new Error("Missing input");
      selected[name] = context;
    }
    let document: unknown = {};
    for (const { name, type, item } of order) {
      const source = type === "set" ? item.sources
        : (item.contexts as Record<string, unknown>)[selected[name]!];
      document = mergeTokens(document, sources(source));
    }
    const resolution = resolveTokens(document, file);
    const tokenOrigins = new Map(readTokens(document).map(t => [t.path, origins.get(t.definition) ?? file]));
    return { document, ...resolution,
      diagnostics: resolution.diagnostics.map(d => ({ ...d, file: tokenOrigins.get(d.path ?? "") ?? file })),
      modifiers: Object.fromEntries(Object.entries(modifiers).map(([k, m]) => [k, Object.keys(m.contexts as object)])) };
  } catch {
    return { document: {}, tokens: [], modifiers: {}, diagnostics: [tokenDiagnostic(file, "", "invalidResolver")] };
  }
}

/** CLI validation checks all permutations, not just the default theme. */
export function* resolverInputs(value: unknown, files: readonly PluginFileRecord[], file: string):
  Generator<Record<string, string>> {
  let entries: [string, string[]][];
  try {
    entries = Object.entries(prepareResolver(value, file, files).modifiers)
      .map(([k, m]) => [k, Object.keys(m.contexts as object)]);
  } catch { yield {}; return; }
  function* walk(index: number, input: Record<string, string>): Generator<Record<string, string>> {
    if (index === entries.length) { yield input; return; }
    const [name, contexts] = entries[index]!;
    for (const context of contexts) yield* walk(index + 1, { ...input, [name]: context });
  }
  yield* walk(0, {});
}
