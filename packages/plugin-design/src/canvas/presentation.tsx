import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BoardView, type CanvasRendererData, type NodeEvent } from "../render/board-view.js";
import { resolveNode, type ResolveContext } from "../render/resolve.js";
import type { DesignNode, Reaction, Transition } from "../model/types.js";
import { designText } from "../i18n.js";
import { transitionStyles } from "./transitions.js";

interface Entry { id: number; board: string; reaction?: Reaction }
interface Playback { history: Entry[]; overlays: Entry[] }
interface Layer { entry: Entry; x: number; y: number; width: number; height: number; scale: number }
const top = (state: Playback) => state.overlays.at(-1) ?? state.history.at(-1)!;

export function Presentation({ data, start, context, fontsCss, locale, onClose }: {
  data: CanvasRendererData; start: string; context: ResolveContext; fontsCss: string; locale: string; onClose: () => void;
}) {
  const t = (key: keyof typeof designText) => designText[key][locale === "ja" ? "ja" : "en"];
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dismiss = () => {
    // Release native modal inertness before CanvasScreen restores the trigger focus.
    dialog.current?.close();
    onClose();
  };
  const serial = useRef(0);
  const [state, setState] = useState<Playback>({ history: [{ id: 0, board: start }], overlays: [] });
  const current = useRef(state);
  const [notice, setNotice] = useState("");
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [motion, setMotion] = useState<{ before: Playback; transition: Transition; reverse: boolean; running: boolean }>();
  const hovering = useRef<{ key: string; rect: DOMRect; before: Playback; created: number } | undefined>(undefined);
  const boards = useMemo(() => new Map(data.boards.map(board => [board.name, board])), [data.boards]);
  const nodes = useMemo(() => {
    const result = new Map<string, Map<string, DesignNode>>();
    for (const board of data.boards) {
      const index = new Map<string, DesignNode>();
      const visit = (node: DesignNode) => {
        index.set(node.id, node);
        if ("children" in node && Array.isArray(node.children)) node.children.forEach(visit);
      };
      visit(resolveNode(board.spec.root, context));
      result.set(board.name, index);
    }
    return result;
  }, [data.boards, context]);
  useLayoutEffect(() => {
    dialog.current?.showModal();
    close.current?.focus();
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(query.matches);
    query.addEventListener("change", changed);
    return () => { window.removeEventListener("resize", resize); query.removeEventListener("change", changed); };
  }, []);
  useEffect(() => {
    if (!motion) return;
    if (reduced) { setMotion(undefined); return; }
    // Two frames ensure initial transforms are painted before transitioning.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMotion(value => value && { ...value, running: true }));
    });
    const timer = window.setTimeout(() => setMotion(undefined), Math.max(0, motion.transition.duration ?? 300) + 50);
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); clearTimeout(timer); };
  }, [motion?.before, reduced]);
  const commit = useCallback((next: Playback, transition?: Transition, reverse = false) => {
    const before = current.current;
    current.current = next;
    setState(next);
    setMotion(!reduced && transition && transition.type !== "instant"
      ? { before, transition, reverse, running: false } : undefined);
  }, [reduced]);
  const back = useCallback(() => {
    const previous = current.current;
    if (!previous.overlays.length && previous.history.length <= 1) return;
    commit(previous.overlays.length ? { ...previous, overlays: previous.overlays.slice(0, -1) }
      : { history: previous.history.slice(0, -1), overlays: [] }, top(previous).reaction?.transition, true);
  }, [commit]);
  const act = useCallback((reaction: Reaction) => {
    const previous = current.current;
    if (reaction.action === "openUrl") {
      try {
        const url = new URL(reaction.destination ?? "");
        if (!["https:", "http:", "mailto:"].includes(url.protocol)) throw new Error("protocol");
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch { setNotice(designText.unsafeUrl[locale === "ja" ? "ja" : "en"]); }
      return;
    }
    if (reaction.action === "back") { back(); return; }
    if (reaction.action === "closeOverlay") { if (previous.overlays.length) back(); return; }
    if (!reaction.destination || !boards.has(reaction.destination)) return;
    const entry = { id: ++serial.current, board: reaction.destination, reaction };
    if (reaction.action === "navigate") commit({ history: [...previous.history, entry], overlays: [] }, reaction.transition);
    else commit({ ...previous, overlays: [...(reaction.action === "swapOverlay" ? previous.overlays.slice(0, -1) : previous.overlays), entry] }, reaction.transition);
  }, [boards, back, commit, locale]);
  const onNodeEvent = useCallback((event: NodeEvent) => {
    // Hover reversal follows the pointer's original rectangle, not DOM removal or
    // occlusion by the overlay it just opened. Only actual movement out reverses it.
    if (event.trigger === "hover-leave" || event.trigger === "release") return;
    const trigger = event.trigger === "hover-enter" ? "hover" : event.trigger;
    const key = `${event.boardName}/${event.nodeId}`;
    if (trigger === "hover" && hovering.current?.key === key) return;
    const before = current.current;
    const reactions = nodes.get(event.boardName)?.get(event.nodeId)?.reactions ?? [];
    for (const reaction of reactions) if (reaction.trigger === trigger) act(reaction);
    if (trigger === "hover" && current.current !== before) {
      hovering.current = { key, rect: event.rect, before, created: top(current.current).id };
    }
  }, [nodes, act]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const hover = hovering.current;
      if (!hover) return;
      const r = hover.rect;
      if (event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom) return;
      hovering.current = undefined;
      if (top(current.current).id === hover.created)
        commit(hover.before, top(current.current).reaction?.transition, true);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [commit]);
  const layers = (playback: Playback): Layer[] => {
    const base = playback.history.at(-1)!;
    const root = nodes.get(base.board)?.get(boards.get(base.board)!.spec.root.id);
    const width = root?.width ?? 0, height = root?.height ?? 0;
    const scale = Math.max(0, Math.min(1, (size.width - 64) / (width || 1), (size.height - 64) / (height || 1)));
    const result: Layer[] = [{ entry: base, x: (size.width - width * scale) / 2, y: (size.height - height * scale) / 2, width, height, scale }];
    for (const entry of playback.overlays) {
      const below = result.at(-1)!;
      const board = boards.get(entry.board)!;
      const root = nodes.get(entry.board)?.get(board.spec.root.id);
      const w = root?.width ?? 0, h = root?.height ?? 0;
      const position = entry.reaction?.overlay?.position ?? "center";
      const positions: Record<string, [number, number]> = {
        center: [0.5, 0.5], topLeft: [0, 0], topCenter: [0.5, 0], topRight: [1, 0],
        bottomLeft: [0, 1], bottomCenter: [0.5, 1], bottomRight: [1, 1]
      };
      const [x, y] = positions[position] ?? positions.center!;
      result.push({ entry, x: below.x + (below.width - w) * scale * x,
        y: below.y + (below.height - h) * scale * y, width: w, height: h, scale });
    }
    return result;
  };
  const visible = layers(state);
  const old = motion ? layers(motion.before).filter(layer => !visible.some(item => item.entry.id === layer.entry.id)) : [];
  const previousIds = new Set(motion ? layers(motion.before).map(layer => layer.entry.id) : []);
  return createPortal(<dialog ref={dialog} role="dialog" aria-modal="true" aria-label={t("present")}
    data-testid="design-presentation" onCancel={event => { event.preventDefault(); dismiss(); }}
    onPointerDown={event => {
      if (event.button !== 0 || !state.overlays.length) return;
      const inside = event.nativeEvent.composedPath().some(target => target instanceof HTMLElement && target.dataset.presentationOverlay === "true");
      if (!inside && top(state).reaction?.overlay?.closeOnOutsideClick !== false) back();
    }}
    style={{ position: "fixed", inset: 0, margin: 0, padding: 0, border: 0, maxWidth: "none", maxHeight: "none",
      width: "100vw", height: "100vh", overflow: "hidden", background: "#111827", color: "#fff" }}>
    <button ref={close} type="button" data-testid="design-presentation-close" onPointerDown={event => event.stopPropagation()}
      onClick={dismiss} style={{ position: "absolute", right: 4, top: 2, zIndex: 100, color: "#111827", background: "#fff" }}>{t("closePresentation")}</button>
    <span role="status" style={{ position: "absolute", left: 8, top: 4, zIndex: 100 }}>{notice}</span>
    {[...visible, ...old].map(layer => {
      const leaving = old.includes(layer);
      const animated = motion && (leaving || !previousIds.has(layer.entry.id));
      const board = boards.get(layer.entry.board)!;
      const effect = animated ? transitionStyles(motion.transition, motion.reverse, reduced, !leaving, motion.running) : {};
      return <div key={layer.entry.id} data-presentation-layer={layer.entry.board}
        data-presentation-overlay={state.overlays.some(entry => entry.id === layer.entry.id) || undefined} aria-hidden={leaving || undefined}
        style={{ position: "absolute", left: layer.x, top: layer.y, width: layer.width * layer.scale, height: layer.height * layer.scale,
          pointerEvents: leaving ? "none" : "auto", zIndex: animated
            ? visible.length + old.length + Number(effect.zIndex ?? 0) : visible.indexOf(layer) }}>
        <div data-testid="design-presentation-transition" data-leaving={leaving || undefined} style={{
          position: "absolute", inset: 0, ...effect
        }}>
          <div style={{ width: layer.width, height: layer.height, transform: `scale(${layer.scale})`, transformOrigin: "0 0" }}>
            <BoardView board={{ ...board, spec: { ...board.spec, x: 0, y: 0 } }} context={context}
              fontsCss={fontsCss} locale={locale} onNodeEvent={leaving ? undefined : onNodeEvent} />
          </div>
        </div>
      </div>;
    })}
  </dialog>, document.body);
}
