import type { DesignNode, TextNode, TextSpan } from "../model/types.js";

/** A run's own style: every TextSpan key except the text itself. */
export type SpanStyle = Omit<TextSpan, "text">;
const styleOf = (span: TextSpan): SpanStyle => { const { text: _text, ...style } = span; return style; };
const sameStyle = (a: SpanStyle, b: SpanStyle) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export function spansOf(node: TextNode): TextSpan[] {
  return node.spans ? node.spans.map(span => ({ ...span })) : [{ text: node.text ?? "" }];
}
export function textOf(node: TextNode): string {
  return node.spans ? node.spans.map(span => span.text).join("") : node.text ?? "";
}

/** Merge neighbours with the same style and drop empty runs. */
export function normalizeSpans(spans: readonly TextSpan[]): TextSpan[] {
  const out: TextSpan[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const last = out.at(-1);
    if (last && sameStyle(styleOf(last), styleOf(span))) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

/** Write runs back: one unstyled run is plain `text`; anything else is `spans`. */
export function withSpans(node: TextNode, spans: readonly TextSpan[]): TextNode {
  const runs = normalizeSpans(spans);
  const { text: _text, spans: _spans, ...rest } = node;
  if (runs.length <= 1 && !Object.keys(styleOf(runs[0] ?? { text: "" })).length)
    return { ...rest, text: runs[0]?.text ?? "" } as TextNode;
  return { ...rest, spans: runs } as TextNode;
}

/** Give characters [start, end) the patch (undefined removes a key), splitting runs at the edges. */
export function styleRange(node: TextNode, start: number, end: number, patch: Partial<SpanStyle>): TextNode {
  const out: TextSpan[] = [];
  let at = 0;
  for (const span of spansOf(node)) {
    const from = at, to = at + span.text.length;
    at = to;
    const cut = [from, Math.max(from, Math.min(to, start)), Math.max(from, Math.min(to, end)), to];
    for (let i = 0; i < 3; i++) {
      const text = span.text.slice(cut[i]! - from, cut[i + 1]! - from);
      if (!text) continue;
      const piece: TextSpan = { ...span, text };
      if (i === 1) for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (piece as Record<string, unknown>)[key];
        else (piece as Record<string, unknown>)[key] = value;
      }
      out.push(piece);
    }
  }
  return withSpans(node, out);
}

/** A whole-node style change: set it on the node and clear the same key from every run. */
export function styleWhole(node: TextNode, patch: Partial<SpanStyle>): TextNode {
  const next = { ...node } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key]; else next[key] = value;
  }
  if (!node.spans) return next as TextNode;
  const runs = node.spans.map(span => {
    const copy = { ...span } as Record<string, unknown>;
    for (const key of Object.keys(patch)) delete copy[key];
    return copy as TextSpan;
  });
  return withSpans(next as TextNode, runs);
}

/** A new text node: a click makes it grow with its text; a drag fixes its width. */
export function newText(id: string, box: { x: number; y: number; width: number; height: number; rotation?: number },
  dragged: boolean, placed: boolean): DesignNode {
  return {
    id, type: "text", text: "", fontSize: 16, fills: [{ color: "#000000" }],
    ...(placed ? { x: Math.round(box.x * 100) / 100, y: Math.round(box.y * 100) / 100 } : {}),
    ...(dragged ? { width: Math.max(1, Math.round(box.width)), autoResize: "height" as const } : { autoResize: "widthAndHeight" as const }),
    ...(box.rotation ? { rotation: box.rotation } : {})
  } as DesignNode;
}

/**
 * Read the editor's DOM back into runs. Each text node keeps the style of the run element
 * (`data-span`) it sits in; text typed outside any run takes the run before it.
 */
export function readEditor(element: HTMLElement, runs: readonly TextSpan[]): TextSpan[] {
  const out: TextSpan[] = [];
  let last: SpanStyle = runs[0] ? styleOf(runs[0]) : {};
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const owner = (node.parentElement?.closest("[data-span]") as HTMLElement | null);
      const index = owner && element.contains(owner) ? Number(owner.dataset.span) : NaN;
      if (Number.isInteger(index) && runs[index]) last = styleOf(runs[index]!);
      out.push({ ...last, text: node.textContent ?? "" });
    } else if (node.nodeName === "BR") out.push({ ...last, text: "\n" });
    else node.childNodes.forEach(walk);
  };
  element.childNodes.forEach(walk);
  return normalizeSpans(out);
}

/** Character offsets of a DOM selection inside the editor, or undefined when it is elsewhere. */
export function rangeOffsets(element: HTMLElement, range: Range): { start: number; end: number } | undefined {
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
  const measure = (container: Node, offset: number) => {
    const probe = document.createRange();
    probe.selectNodeContents(element);
    probe.setEnd(container, offset);
    return probe.toString().length;
  };
  const start = measure(range.startContainer, range.startOffset), end = measure(range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
