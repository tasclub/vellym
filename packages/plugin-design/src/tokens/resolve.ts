import type { PluginDiagnostic } from "@vellym/plugin-api";
import { aliasPath, object, readTokens, type DesignToken } from "./dtcg.js";
import { fontWeights, tokenDiagnostic, validTokenValue } from "./validate.js";

export interface TokenResolution { tokens: DesignToken[]; diagnostics: PluginDiagnostic[] }
/** Resolve after merging all selected sources. A failed token is not returned as usable. */
export function resolveTokens(document: unknown, file = ".", options: { allowMissing?: boolean; deferAliases?: boolean } = {}): TokenResolution {
  const raw = new Map(readTokens(document).map(t => [t.path, t]));
  const resolved = new Map<string, DesignToken>();
  const diagnostics: PluginDiagnostic[] = [];
  function structure(v: unknown, path: string) {
    if (!object(v)) { diagnostics.push(tokenDiagnostic(file, path, "invalidToken")); return; }
    for (const [key, child] of Object.entries(v)) {
      if (key.startsWith("$") && key !== "$root") continue;
      const next = path ? `${path}.${key}` : key;
      if (/[.{}]/.test(key) || ("$value" in v)) diagnostics.push(tokenDiagnostic(file, next, "invalidToken"));
      else structure(child, next);
    }
  }
  structure(document, "");
  const visiting = new Set<string>();
  const failed = new Set<string>();
  const hasAlias = (v: unknown): boolean => Boolean(aliasPath(v)) ||
    (Array.isArray(v) ? v.some(hasAlias) : object(v) ? Object.values(v).some(hasAlias) : false);
  class Failure extends Error {
    constructor(readonly issue: "tokenCycle" | "tokenMissing" | "invalidToken") { super(issue); }
  }
  function resolve(path: string): DesignToken {
    const cached = resolved.get(path);
    if (cached) return cached;
    if (visiting.has(path)) throw new Failure("tokenCycle");
    const token = raw.get(path);
    if (!token) throw new Failure("tokenMissing");
    visiting.add(path);
    try {
      const alias = aliasPath(token.value);
      const target = alias ? resolve(alias) : undefined;
      const type = token.definition.$type === undefined && target ? target.type : token.type;
      if (target && type !== target.type) throw new Failure("invalidToken");
      const fieldTypes: Record<string, Record<string, string>> = {
        typography: { fontFamily: "fontFamily", fontSize: "dimension", fontWeight: "fontWeight", letterSpacing: "dimension", lineHeight: "number" },
        shadow: { color: "color", offsetX: "dimension", offsetY: "dimension", blur: "dimension", spread: "dimension" },
        border: { color: "color", width: "dimension", style: "strokeStyle" },
        transition: { duration: "duration", delay: "duration", timingFunction: "cubicBezier" },
        gradient: { color: "color", position: "number" },
        strokeStyle: { dashArray: "dimension" }
      };
      function value(v: unknown, expected?: string): unknown {
        const ref = aliasPath(v);
        if (ref) {
          const referenced = resolve(ref);
          if (expected && referenced.type !== expected) throw new Failure("invalidToken");
          return referenced.value;
        }
        if (Array.isArray(v)) return v.map(x => value(x, expected));
        if (object(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x, fieldTypes[expected ?? ""]?.[k])]));
        return v;
      }
      const result = { ...token, type, value: target ? target.value : value(token.value, type) };
      if (!validTokenValue(type, result.value)) throw new Failure("invalidToken");
      resolved.set(path, result);
      return result;
    } finally { visiting.delete(path); }
  }
  for (const path of raw.keys()) {
    // Resolver sources may intentionally contain aliases whose targets are supplied
    // or replaced by a later source. Checking them before ordering is incorrect.
    if (options.deferAliases && hasAlias(raw.get(path)!.value)) continue;
    try { resolve(path); } catch (error) {
      failed.add(path);
      const issue = error instanceof Failure ? error.issue : "invalidToken";
      if (!(options.allowMissing && issue === "tokenMissing")) diagnostics.push(tokenDiagnostic(file, path, issue));
    }
  }
  return { tokens: [...raw.keys()].filter(p => !failed.has(p) && resolved.has(p)).map(p => resolved.get(p)!), diagnostics };
}

/** Typography has no lossless single CSS shorthand (letter-spacing is separate). */
export function typographyToCss(v: unknown): Readonly<Record<string, string>> | undefined {
  if (!validTokenValue("typography", v) || !object(v)) return undefined;
  return {
    fontFamily: tokenToCss("fontFamily", v.fontFamily)!, fontSize: tokenToCss("dimension", v.fontSize)!,
    fontWeight: tokenToCss("fontWeight", v.fontWeight)!, letterSpacing: tokenToCss("dimension", v.letterSpacing)!,
    lineHeight: String(v.lineHeight)
  };
}

/** CSS fallback for object stroke styles is dashed, as allowed by Format §9.3.3. */
export function tokenToCss(type: string, v: unknown, options: { preferColorFallback?: boolean } = {}): string | undefined {
  if (!validTokenValue(type, v)) return undefined;
  const css = (t: string, x: unknown) => tokenToCss(t, x, options)!;
  const o = object(v) ? v : {};
  switch (type) {
    case "number": return String(v);
    case "dimension": case "duration": return `${o.value}${o.unit}`;
    case "fontFamily": return (Array.isArray(v) ? v : [v]).map(x => {
      const name = String(x);
      return ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"].includes(name) ? name : JSON.stringify(name);
    }).join(", ");
    case "fontWeight": return String(typeof v === "string" ? fontWeights[v] : v);
    case "cubicBezier": return `cubic-bezier(${(v as number[]).join(", ")})`;
    case "color": {
      const space = String(o.colorSpace);
      const components = o.components as (number | string)[];
      const alpha = o.alpha ?? 1;
      if (options.preferColorFallback && typeof o.hex === "string") {
        return alpha === 1 ? o.hex : `${o.hex}${Math.round((alpha as number) * 255).toString(16).padStart(2, "0")}`;
      }
      const c = components.map((x, i) => x === "none" ? x
        : (space === "hsl" || space === "hwb") && i > 0 ? `${x}%` : x).join(" ");
      return ["hsl", "hwb", "lab", "lch", "oklab", "oklch"].includes(space)
        ? `${space}(${c} / ${alpha})` : `color(${space} ${c} / ${alpha})`;
    }
    case "strokeStyle": return typeof v === "string" ? v : "dashed";
    case "border": return `${css("dimension", o.width)} ${css("strokeStyle", o.style)} ${css("color", o.color)}`;
    case "transition": return `${css("duration", o.duration)} ${css("cubicBezier", o.timingFunction)} ${css("duration", o.delay)}`;
    case "typography": return `${css("fontWeight", o.fontWeight)} ${css("dimension", o.fontSize)}/${o.lineHeight} ${css("fontFamily", o.fontFamily)}`;
    case "shadow": return Array.isArray(v) ? v.map(x => css("shadow", x)).join(", ")
      : `${o.inset ? "inset " : ""}${["offsetX", "offsetY", "blur", "spread"].map(k => css("dimension", o[k])).join(" ")} ${css("color", o.color)}`;
    case "gradient": return `linear-gradient(${(v as Record<string, unknown>[]).map(s =>
      `${css("color", s.color)} ${Math.min(1, Math.max(0, s.position as number)) * 100}%`).join(", ")})`;
    default: return undefined;
  }
}
