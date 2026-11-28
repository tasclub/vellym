import { describe, expect, it } from "vitest";
import type { TextNode } from "../packages/plugin-design/src/model/types.js";
import { newText, normalizeSpans, styleRange, styleWhole, textOf, withSpans } from "../packages/plugin-design/src/tools/text-tool.js";

const plain: TextNode = { id: "t", type: "text", text: "こんにちは世界", fontSize: 16 };

describe("runs", () => {
  it("splits a range into its own run and merges back when styles match", () => {
    const bold = styleRange(plain, 5, 7, { fontWeight: 700 });
    expect(bold).toEqual({ id: "t", type: "text", fontSize: 16, spans: [{ text: "こんにちは" }, { text: "世界", fontWeight: 700 }] });
    expect(textOf(bold)).toBe("こんにちは世界");
    // Removing the style again goes back to plain text.
    expect(styleRange(bold, 0, 7, { fontWeight: undefined })).toEqual(plain);
    const middle = styleRange(plain, 2, 4, { fontSize: 24 });
    expect(middle.spans!.map(span => span.text)).toEqual(["こん", "にち", "は世界"]);
  });
  it("sets whole-text styles on the node and clears them from runs", () => {
    const mixed = styleRange(plain, 0, 2, { fontSize: 30 });
    expect(styleWhole(mixed, { fontSize: 12 })).toEqual({ id: "t", type: "text", fontSize: 12, text: "こんにちは世界" });
    expect(styleWhole(plain, { textAlign: "center" })).toMatchObject({ textAlign: "center", text: "こんにちは世界" });
  });
  it("drops empty runs and writes one unstyled run as text", () => {
    expect(normalizeSpans([{ text: "" }, { text: "a" }, { text: "b" }, { text: "c", fontWeight: 700 }]))
      .toEqual([{ text: "ab" }, { text: "c", fontWeight: 700 }]);
    expect(withSpans({ id: "t", type: "text", spans: [{ text: "x" }] }, [{ text: "x" }, { text: "y" }])).toEqual({ id: "t", type: "text", text: "xy" });
  });
  it("creates growing text on click and fixed-width text on drag", () => {
    expect(newText("text-1", { x: 10, y: 20, width: 0, height: 0 }, false, true)).toMatchObject({ autoResize: "widthAndHeight", x: 10, y: 20, text: "" });
    expect(newText("text-1", { x: 10, y: 20, width: 150, height: 40 }, true, true)).toMatchObject({ autoResize: "height", width: 150 });
  });
});
