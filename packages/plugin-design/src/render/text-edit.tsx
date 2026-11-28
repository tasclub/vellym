import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { TextNode, TextSpan } from "../model/types.js";
import { nodeCss } from "./css.js";
import type { ResolveContext } from "./resolve.js";
import { readEditor, rangeOffsets, spansOf } from "../tools/text-tool.js";

/** The text being edited in place, and what to do with the result. */
export interface TextEditing {
  id: string;
  /** The model node (unresolved): its runs are what the edit reads back into. */
  source: TextNode;
  label: string;
  onCommit(spans: TextSpan[]): void;
  /** The selected characters while editing (undefined for a caret). */
  onRange(range: { start: number; end: number } | undefined): void;
}
export const TextEditingContext = createContext<TextEditing | undefined>(undefined);
export const useTextEditing = () => useContext(TextEditingContext);

/**
 * Method A (decision-design-rendering): a contenteditable inside the board's Shadow DOM.
 * React renders no children here, so it never touches the DOM while the user types or an
 * input method composes; the runs are read back only when the edit ends.
 */
export function TextEditor({ resolved, ctx }: { resolved: TextNode; ctx: ResolveContext }) {
  const editing = useTextEditing()!;
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false), done = useRef(false);
  const runs = spansOf(editing.source);
  useLayoutEffect(() => {
    const element = ref.current!;
    const shown = spansOf(resolved);
    element.replaceChildren(...runs.map((span, i) => {
      const run = document.createElement("span");
      run.dataset.span = String(i);
      const style = nodeCss({ id: `${resolved.id}-${i}`, type: "text", ...(shown[i] ?? span) }, undefined, ctx).declarations;
      const { position: _p, boxSizing: _b, width: _w, whiteSpace: _s, ...appearance } = style;
      Object.assign(run.style, appearance as CSSProperties);
      run.textContent = span.text;
      return run;
    }));
    element.focus({ preventScroll: true });
    const root = element.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
    const selection = root.getSelection?.() ?? document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const changed = () => {
      const current = (root.getSelection?.() ?? document.getSelection());
      if (!current?.rangeCount) return;
      const offsets = rangeOffsets(element, current.getRangeAt(0));
      // A selection that left the editor (e.g. into the panel) keeps the last range.
      if (offsets) editing.onRange(offsets.start === offsets.end ? undefined : offsets);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
    // Built once per edit: later renders must not reset what the user typed.
  }, []);
  const finish = () => {
    if (done.current || composing.current) return;
    done.current = true;
    editing.onCommit(readEditor(ref.current!, runs));
  };
  return <div ref={ref} className="design-text-editor" data-testid="design-text-editor" contentEditable
    suppressContentEditableWarning spellCheck={false} role="textbox" aria-multiline="true" aria-label={editing.label}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onBlur={finish}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || composing.current) return;
      if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        finish();
      } else if (event.key === "Enter") {
        // A plain line break, not a new block element.
        event.preventDefault();
        document.execCommand("insertLineBreak");
      }
    }} />;
}
