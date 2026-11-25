/** DTCG 2025.10. These functions never read files or mutate source documents. */
export const tokenTypes = ["color", "dimension", "fontFamily", "fontWeight", "number",
  "duration", "cubicBezier", "shadow", "gradient", "typography", "border", "strokeStyle", "transition"] as const;
export type TokenType = typeof tokenTypes[number];
export interface DesignToken {
  path: string;
  type?: string;
  value: unknown;
  /** Original token including vendor metadata, retained for round-tripping. */
  definition: Readonly<Record<string, unknown>>;
}
export const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const aliasPath = (v: unknown): string | undefined =>
  typeof v === "string" ? /^\{([^{}]+)\}$/.exec(v)?.[1] : undefined;

export function readTokens(document: unknown): DesignToken[] {
  const tokens: DesignToken[] = [];
  function visit(v: unknown, path: string[], inherited?: string) {
    if (!object(v)) return;
    const type = typeof v.$type === "string" ? v.$type : inherited;
    if (Object.hasOwn(v, "$value")) {
      tokens.push({ path: path.join("."), type, value: v.$value, definition: v });
      return;
    }
    for (const [key, child] of Object.entries(v)) {
      if (!key.startsWith("$") || key === "$root") visit(child, [...path, key], type);
    }
  }
  visit(document, []);
  return tokens;
}

/** Whole tokens replace; groups merge. Never merge the fields of two tokens. */
export function mergeTokens(a: unknown, b: unknown): unknown {
  if (!object(a) || !object(b) || "$value" in a || "$value" in b) return b;
  const result = Object.fromEntries(Object.entries(a));
  for (const [key, value] of Object.entries(b)) {
    Object.defineProperty(result, key, { value: Object.hasOwn(result, key)
      ? mergeTokens(result[key], value) : value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
