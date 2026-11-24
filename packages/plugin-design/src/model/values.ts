/** Shared persisted values. CSS strings are kept verbatim, not normalized. */
export type TokenReference = `{${string}}`;
export type Length = number | TokenReference;
export type Color = string;
export type Easing = string;
export type Padding = Length | [Length, Length, Length, Length];
export type Radius = Padding;
export type ImageFit = "cover" | "contain" | "fill" | "tile";
export type Extensions = Record<string, unknown>;

export const NODE_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,39}$";
// DTCG references contain one or more nonempty path segments (single-token roots too).
export const TOKEN_REFERENCE_PATTERN = "^\\{[^{}\\s.]+(?:\\.[^{}\\s.]+)*\\}$";
export const DESIGN_FORMAT_VERSION = 1;
