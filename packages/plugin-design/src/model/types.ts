import type { Color, Easing, Extensions, ImageFit, Length, Padding, Radius } from "./values.js";
export type * from "./values.js";

/** Unknown fields are retained by readers/writers for additive format changes. */
export interface OpenObject {
  [key: string]: unknown;
  extensions?: Extensions;
}

export interface PaintBase extends OpenObject {
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}
export interface GradientStop extends OpenObject { position: number; color: Color }
export type Paint =
  | (PaintBase & { type?: "solid"; color: Color })
  | (PaintBase & { type: "linearGradient" | "conicGradient"; angle?: number; stops: GradientStop[] })
  | (PaintBase & { type: "radialGradient"; stops: GradientStop[] })
  | (PaintBase & { type: "image"; asset: string; fit?: ImageFit });

export interface Shadow extends OpenObject {
  x: Length; y: Length; blur: Length; spread?: Length; color: Color; inset?: boolean;
}
export interface TextStyle extends OpenObject {
  fontFamily?: string;
  fontSize?: Length;
  fontWeight?: number | string;
  fontStyle?: string;
  lineHeight?: Length | "auto" | `${number}%`;
  letterSpacing?: Length;
  textAlign?: "left" | "center" | "right" | "justify";
  textDecoration?: string;
  textTransform?: string;
}
export interface Layout extends OpenObject {
  display?: "none" | "flex" | "grid";
  flexDirection?: "row" | "column";
  gap?: Length;
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between";
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch" | "baseline";
  flexWrap?: "nowrap" | "wrap";
  rowGap?: Length;
  columnGap?: Length;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
}
export interface Appearance extends TextStyle {
  opacity?: number;
  blendMode?: string;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWidth?: Length;
  strokeAlign?: "inside" | "center" | "outside";
  strokeDash?: number[];
  strokeCap?: "butt" | "round" | "square";
  strokeJoin?: "miter" | "round" | "bevel";
  radius?: Radius;
  shadows?: Shadow[];
  blur?: Length;
  backgroundBlur?: Length;
}
export interface LayoutGrid extends OpenObject {
  pattern: "columns" | "rows" | "grid";
  count?: number;
  gutter?: Length;
  margin?: Length;
  size?: Length;
  alignment?: "stretch" | "center" | "start" | "end";
  color?: Color;
  visible?: boolean;
}
export interface Transition extends OpenObject {
  type: "instant" | "dissolve" | "slideIn" | "slideOut" | "push" | "moveIn" | "moveOut";
  direction?: "left" | "right" | "top" | "bottom";
  duration?: number;
  easing?: Easing;
}
export interface Reaction extends OpenObject {
  trigger: "click" | "hover" | "press";
  action: "navigate" | "overlay" | "swapOverlay" | "closeOverlay" | "back" | "openUrl";
  destination?: string;
  overlay?: OpenObject & { position?: string; closeOnOutsideClick?: boolean };
  transition?: Transition;
}
export interface NodeBase extends Appearance {
  id: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  x?: number; y?: number; width?: number; height?: number;
  rotation?: number;
  sizing?: OpenObject & { width?: "fixed" | "hug" | "fill"; height?: "fixed" | "hug" | "fill" };
  minWidth?: Length; maxWidth?: Length; minHeight?: Length; maxHeight?: Length;
  position?: "auto" | "absolute";
  constraints?: OpenObject & {
    horizontal?: "left" | "right" | "center" | "leftRight" | "scale";
    vertical?: "top" | "bottom" | "center" | "topBottom" | "scale";
  };
  gridColumn?: string; gridRow?: string;
  mask?: boolean;
  styles?: string[];
  reactions?: Reaction[];
  exports?: (OpenObject & { format: "png" | "svg" | "pdf"; scale?: number })[];
  bind?: OpenObject & { text?: string; visible?: string; component?: string };
}
export interface FrameNode extends NodeBase {
  type: "frame"; children: DesignNode[]; clip?: boolean; layout?: Layout; layoutGrids?: LayoutGrid[]; padding?: Padding;
}
export interface GroupNode extends NodeBase { type: "group"; children: DesignNode[] }
export interface RectangleNode extends NodeBase { type: "rectangle" }
export interface EllipseNode extends NodeBase { type: "ellipse" }
export interface LineNode extends NodeBase { type: "line" }
export interface PolygonNode extends NodeBase { type: "polygon"; pointCount: number }
export interface StarNode extends NodeBase { type: "star"; pointCount: number; innerRadius: number }
export interface PathNode extends NodeBase { type: "path"; d: string; fillRule?: "nonzero" | "evenodd" }
export interface BooleanNode extends NodeBase {
  type: "boolean"; operation: "union" | "subtract" | "intersect" | "exclude"; children: DesignNode[];
}
export interface TextSpan extends TextStyle { text: string; fills?: Paint[] }
export type TextNode = NodeBase & {
  type: "text";
  autoResize?: "none" | "height" | "widthAndHeight";
  verticalAlign?: "top" | "middle" | "bottom";
} & ({ text: string; spans?: never } | { text?: never; spans: TextSpan[] });
export interface ImageNode extends NodeBase { type: "image"; asset: string; fit?: ImageFit; alt?: string }
/** Recognized structural keys cannot be smuggled into appearance-only objects. */
export interface NoNodeStructure {
  id?: never; type?: never; name?: never; locked?: never;
  x?: never; y?: never; width?: never; height?: never; rotation?: never;
  sizing?: never; minWidth?: never; maxWidth?: never; minHeight?: never; maxHeight?: never;
  position?: never; constraints?: never; gridColumn?: never; gridRow?: never;
  mask?: never; styles?: never; reactions?: never; exports?: never; bind?: never;
  children?: never; clip?: never; layoutGrids?: never; pointCount?: never; innerRadius?: never;
  d?: never; fillRule?: never; operation?: never; asset?: never; fit?: never; alt?: never;
  component?: never; variant?: never; properties?: never; overrides?: never;
  autoResize?: never; verticalAlign?: never;
}
export interface NodeOverride extends Appearance {
  text?: string; spans?: TextSpan[]; visible?: boolean;
  children?: never;
}
export interface InstanceNode extends NodeBase {
  type: "instance";
  component: string;
  variant?: Record<string, string>;
  properties?: Record<string, string | boolean>;
  overrides?: Record<string, NodeOverride>;
}
export type DesignNode = FrameNode | GroupNode | RectangleNode | EllipseNode | LineNode |
  PolygonNode | StarNode | PathNode | BooleanNode | TextNode | ImageNode | InstanceNode;

export type ComponentProperty = OpenObject & (
  | { type: "variant"; options: string[]; default: string }
  | { type: "text" | "instanceSwap"; default: string }
  | { type: "boolean"; default: boolean }
);
export interface ComponentVariant extends OpenObject {
  id: string; values: Record<string, string>; root: DesignNode;
}
export interface DesignBoardSpec extends OpenObject {
  canvas: string; page?: string; x: number; y: number;
  implementedBy?: string[]; startingPoint?: boolean; root: DesignNode;
}
export type DesignComponentSpec = OpenObject & {
  canvas: string; page?: string; x?: number; y?: number;
  properties?: Record<string, ComponentProperty>;
} & ({ root: DesignNode; variants?: never } | { root?: never; variants: ComponentVariant[] });
export interface SharedStyle extends Appearance, NoNodeStructure {
  layout?: OpenObject & Pick<Layout, "gap" | "justifyContent" | "alignItems"> & {
    display?: never; flexDirection?: never; flexWrap?: never; rowGap?: never; columnGap?: never;
    gridTemplateColumns?: never; gridTemplateRows?: never;
  };
  padding?: Padding;
  text?: never; spans?: never; visible?: never;
}
export interface DesignStylesSpec extends OpenObject { styles: Record<string, SharedStyle> }
export interface DesignFont extends OpenObject {
  family: string; source: string; weights: (number | string)[]; path: string;
}
export interface DesignCanvasSpec extends OpenObject {
  formatVersion: 1;
  pages?: (OpenObject & { id: string; title?: string })[];
  notes?: (OpenObject & { page?: string; x: number; y: number; text: string; kind?: "title" | "sticky" })[];
  styles?: string;
  tokens?: OpenObject & { files: string[]; resolver?: string };
  fonts?: DesignFont[];
}
export interface DesignResource<K extends string, S> extends OpenObject {
  apiVersion?: string;
  kind: K;
  metadata: OpenObject & { name: string; title?: string };
  spec: S;
}
export type DesignCanvas = DesignResource<"DesignCanvas", DesignCanvasSpec>;
export type DesignBoard = DesignResource<"DesignBoard", DesignBoardSpec>;
export type DesignComponent = DesignResource<"DesignComponent", DesignComponentSpec>;
export type DesignStyles = DesignResource<"DesignStyles", DesignStylesSpec>;
