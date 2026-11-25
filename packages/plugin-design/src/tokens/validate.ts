import type { PluginDiagnostic } from "@vellym/plugin-api";
import { designText } from "../i18n.js";
import { object, tokenTypes } from "./dtcg.js";

export type TokenIssue = "invalidToken" | "tokenCycle" | "tokenMissing" | "invalidResolver";
export function tokenDiagnostic(file: string, path: string, issue: TokenIssue): PluginDiagnostic {
  return { file, path, severity: "error", code: {
    invalidToken: "DESIGN_TOKEN_INVALID", tokenCycle: "DESIGN_TOKEN_CYCLE",
    tokenMissing: "DESIGN_TOKEN_REFERENCE_MISSING", invalidResolver: "DESIGN_RESOLVER_INVALID"
  }[issue], message: designText[issue] };
}
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const between = (v: unknown, min: number, max: number) => number(v) && v >= min && v <= max;
export const fontWeights: Readonly<Record<string, number>> = {
  thin: 100, hairline: 100, "extra-light": 200, "ultra-light": 200, light: 300,
  normal: 400, regular: 400, book: 400, medium: 500, "semi-bold": 600, "demi-bold": 600,
  bold: 700, "extra-bold": 800, "ultra-bold": 800, black: 900, heavy: 900,
  "extra-black": 950, "ultra-black": 950
};
const spaces = ["srgb", "srgb-linear", "hsl", "hwb", "lab", "lch", "oklab", "oklch",
  "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d65", "xyz-d50"];

/** Validate resolved values (aliases must already have been substituted). */
export function validTokenValue(type: string | undefined, v: unknown): boolean {
  const valid = validTokenValue;
  const fields = (schema: Record<string, string>, optional: string[] = []) =>
    object(v) && Object.entries(schema).every(([k, t]) => valid(t, v[k]))
      && Object.keys(v).every(k => k in schema || optional.includes(k));
  switch (type) {
    case "number": return number(v);
    case "dimension": return object(v) && number(v.value) && ["px", "rem"].includes(String(v.unit));
    case "duration": return object(v) && number(v.value) && ["ms", "s"].includes(String(v.unit));
    case "fontFamily": return typeof v === "string" || (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === "string"));
    case "fontWeight": return between(v, 1, 1000) || (typeof v === "string" && Object.hasOwn(fontWeights, v));
    case "cubicBezier": return Array.isArray(v) && v.length === 4 && v.every(number) && between(v[0], 0, 1) && between(v[2], 0, 1);
    case "color": {
      if (!object(v)) return false;
      if (v.hex !== undefined && (typeof v.hex !== "string" || !/^#[\da-f]{6}$/i.test(v.hex))) return false;
      if (v.alpha !== undefined && !between(v.alpha, 0, 1)) return false;
      return spaces.includes(String(v.colorSpace)) && Array.isArray(v.components) && v.components.length === 3
        && v.components.every((c, i) => {
          if (c === "none") return true;
          if (!number(c)) return false;
          const space = v.colorSpace;
          if (space === "hsl" || space === "hwb") return i === 0 ? c >= 0 && c < 360 : between(c, 0, 100);
          if (space === "lab" || space === "oklab") return i === 0 ? between(c, 0, space === "lab" ? 100 : 1) : true;
          if (space === "lch" || space === "oklch") return i === 0 ? between(c, 0, space === "lch" ? 100 : 1)
            : i === 1 ? c >= 0 : c >= 0 && c < 360;
          return between(c, 0, 1);
        });
    }
    case "strokeStyle": return typeof v === "string"
      ? ["solid", "dashed", "dotted", "double", "groove", "ridge", "outset", "inset"].includes(v)
      : object(v) && Array.isArray(v.dashArray) && v.dashArray.every(x => valid("dimension", x))
        && ["round", "butt", "square"].includes(String(v.lineCap));
    case "border": return fields({ color: "color", width: "dimension", style: "strokeStyle" });
    case "transition": return fields({ duration: "duration", delay: "duration", timingFunction: "cubicBezier" });
    case "typography": return fields({ fontFamily: "fontFamily", fontSize: "dimension", fontWeight: "fontWeight",
      letterSpacing: "dimension", lineHeight: "number" });
    case "shadow": return Array.isArray(v) ? v.every(x => !Array.isArray(x) && valid("shadow", x))
      : fields({ color: "color", offsetX: "dimension", offsetY: "dimension", blur: "dimension", spread: "dimension" }, ["inset"])
        && object(v) && (v.inset === undefined || typeof v.inset === "boolean");
    case "gradient": return Array.isArray(v) && v.every(x => object(x) && valid("color", x.color) && number(x.position)
      && Object.keys(x).every(k => k === "color" || k === "position"));
    default: return false;
  }
}
export const isTokenType = (v: string): boolean => (tokenTypes as readonly string[]).includes(v);
