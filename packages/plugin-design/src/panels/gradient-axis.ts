import type { Paint } from "../model/types.js";

export type Gradient = Extract<Paint, { stops: unknown }>;
export const isGradient = (paint: Paint | undefined): paint is Gradient =>
  !!paint && (paint.type === "linearGradient" || paint.type === "radialGradient" || paint.type === "conicGradient");

/**
 * Where a stop at `t` (0–1) sits, in the node's own unrotated box, relative to its centre.
 * Matches the CSS: linear-gradient(<angle>deg) runs along (sin, -cos) over |w·sin|+|h·cos|;
 * radial-gradient() is an ellipse to the farthest corner, drawn along +x. Conic has no axis.
 */
export function stopOffset(paint: Gradient, width: number, height: number, t: number): { x: number; y: number } | undefined {
  if (paint.type === "linearGradient") {
    const a = (paint.angle ?? 0) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const length = Math.abs(width * dx) + Math.abs(height * dy);
    return { x: (t - 0.5) * length * dx, y: (t - 0.5) * length * dy };
  }
  if (paint.type === "radialGradient") return { x: t * width / 2 * Math.SQRT2, y: 0 };
}

/** The inverse: a point (relative to the centre, unrotated) projected onto the axis, clamped to 0–1. */
export function positionAt(paint: Gradient, width: number, height: number, point: { x: number; y: number }): number | undefined {
  let t: number | undefined;
  if (paint.type === "linearGradient") {
    const a = (paint.angle ?? 0) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const length = Math.abs(width * dx) + Math.abs(height * dy);
    if (!length) return;
    t = (point.x * dx + point.y * dy) / length + 0.5;
  } else if (paint.type === "radialGradient") {
    const radius = width / 2 * Math.SQRT2;
    if (!radius) return;
    t = point.x / radius;
  }
  return t === undefined ? undefined : Math.round(Math.min(1, Math.max(0, t)) * 100) / 100;
}
