import type {
  EllipseNode, LineNode, PathNode, PolygonNode, RectangleNode, StarNode
} from "../model/types.js";

export type VectorNode = EllipseNode | LineNode | PolygonNode | StarNode | PathNode | RectangleNode;
export interface VectorPath {
  d: string;
  fillRule: "nonzero" | "evenodd";
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("Non-finite vector coordinate");
  // Avoid floating point noise and -0 at cardinal vertices.
  return String(Number(value.toFixed(10)));
}

/** Local coordinates: placement / rotation belongs to the containing SVG or DOM. */
export function vectorPath(node: VectorNode): VectorPath {
  if (node.type === "path") return { d: node.d, fillRule: node.fillRule ?? "nonzero" };
  const w = node.width ?? 0, h = node.height ?? 0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) {
    throw new RangeError("Invalid vector dimensions");
  }
  const W = number(w), H = number(h);
  let d: string;
  switch (node.type) {
    case "rectangle":
      d = `M0 0H${W}V${H}H0Z`;
      break;
    case "line":
      d = `M0 0L${W} ${H}`;
      break;
    case "ellipse": {
      const rx = number(w / 2), ry = number(h / 2);
      d = w === 0 || h === 0 ? "" : `M${W} ${ry}A${rx} ${ry} 0 1 1 0 ${ry}A${rx} ${ry} 0 1 1 ${W} ${ry}Z`;
      break;
    }
    case "polygon":
    case "star": {
      if (!Number.isInteger(node.pointCount) || node.pointCount < 3) {
        throw new RangeError("A polygon or star needs at least three points");
      }
      if (node.type === "star" && (!Number.isFinite(node.innerRadius) || node.innerRadius < 0 || node.innerRadius > 1)) {
        throw new RangeError("Invalid star inner radius");
      }
      const count = node.pointCount * (node.type === "star" ? 2 : 1);
      const points = Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
        const radius = node.type === "star" && i % 2 ? node.innerRadius : 1;
        return `${number(w / 2 + Math.cos(angle) * w / 2 * radius)} ${number(h / 2 + Math.sin(angle) * h / 2 * radius)}`;
      });
      d = `M${points.join("L")}Z`;
      break;
    }
  }
  return { d, fillRule: "nonzero" };
}
