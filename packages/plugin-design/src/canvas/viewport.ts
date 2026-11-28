import { useLayoutEffect, useRef } from "react";

export interface Viewport { x: number; y: number; scale: number }
export interface Bounds { x: number; y: number; width: number; height: number }
const clamp = (scale: number) => Math.min(4, Math.max(0.05, scale));

/** Cursor-relative coordinates stay fixed in world space. Trackpad pinch emits ctrl+wheel. */
export function zoomAt(view: Viewport, scale: number, x: number, y: number): Viewport {
  const next = clamp(scale);
  return { x: x - (x - view.x) * next / view.scale, y: y - (y - view.y) * next / view.scale, scale: next };
}

export function fitBounds(boxes: Bounds[], width: number, height: number): Viewport {
  if (!boxes.length) return { x: 40, y: 60, scale: 1 };
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y - 28));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  const scale = clamp(Math.min((width - 80) / Math.max(1, right - x), (height - 80) / Math.max(1, bottom - y)));
  return { x: (width - (right - x) * scale) / 2 - x * scale,
    y: (height - (bottom - y) * scale) / 2 - y * scale, scale };
}

/** Navigation never sets React state or revisits a board's node tree. */
export function useViewport({ hand, onHand, bounds, selected, pageKey }: {
  hand: boolean; onHand: (hand: boolean) => void; bounds: Bounds[]; selected?: Bounds; pageKey: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const zoomLabel = useRef<HTMLOutputElement>(null);
  const view = useRef<Viewport>({ x: 40, y: 60, scale: 1 });
  const options = useRef({ hand, onHand, bounds, selected });
  options.current = { hand, onHand, bounds, selected };
  const apply = () => {
    const v = view.current;
    if (world.current) world.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    world.current?.style.setProperty("--design-scale", String(v.scale));
    if (zoomLabel.current) zoomLabel.current.value = `${Math.round(v.scale * 100)}%`;
    // Rulers follow the view without re-rendering the canvas.
    world.current?.dispatchEvent(new CustomEvent("design-view", { detail: { ...v } }));
  };
  const fit = (selection = false) => {
    const el = viewport.current;
    if (!el) return;
    const opts = options.current;
    if (selection && !opts.selected) return;
    view.current = fitBounds(selection ? [opts.selected!] : opts.bounds, el.clientWidth, el.clientHeight);
    apply();
  };
  const reset = () => {
    const el = viewport.current;
    if (el) view.current = zoomAt(view.current, 1, el.clientWidth / 2, el.clientHeight / 2);
    apply();
  };
  useLayoutEffect(() => {
    view.current = { x: 40, y: 60, scale: 1 };
    apply();
  }, [pageKey]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let space = false;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { id: number; x: number; y: number } | undefined;
    let pinch: { distance: number; x: number; y: number } | undefined;
    const cursor = () => { el.style.cursor = drag || pinch ? "grabbing" : space || options.current.hand ? "grab" : "default"; };
    const point = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const p = point(event.clientX, event.clientY);
        view.current = zoomAt(view.current, view.current.scale * Math.exp(-event.deltaY * unit * 0.01), p.x, p.y);
      } else {
        view.current.x -= event.deltaX * unit;
        view.current.y -= event.deltaY * unit;
      }
      apply();
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        pointers.set(event.pointerId, point(event.clientX, event.clientY));
        pinch = pinchState();
      } else if (event.button !== 1 && !(event.button === 0 && (options.current.hand || space))) return;
      event.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      cursor();
    };
    const move = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, point(event.clientX, event.clientY));
        const next = pinchState();
        if (pinch && next) {
          const v = zoomAt(view.current, view.current.scale * next.distance / Math.max(1, pinch.distance), pinch.x, pinch.y);
          view.current = { ...v, x: v.x + next.x - pinch.x, y: v.y + next.y - pinch.y };
          pinch = next;
          apply();
          return;
        }
      }
      if (drag?.id !== event.pointerId) return;
      view.current.x += event.clientX - drag.x;
      view.current.y += event.clientY - drag.y;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      apply();
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      pinch = pinchState();
      const remaining = [...pointers.entries()][0];
      const rect = el.getBoundingClientRect();
      drag = remaining ? { id: remaining[0], x: remaining[1].x + rect.left, y: remaining[1].y + rect.top } : undefined;
      cursor();
    };
    const editable = (event: KeyboardEvent) => event.composedPath().some(target =>
      target instanceof HTMLElement && (target.matches("input, textarea, select, button, a") || target.isContentEditable));
    const keydown = (event: KeyboardEvent) => {
      if (editable(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Space") { event.preventDefault(); space = true; cursor(); }
      else if (event.shiftKey && ["Digit0", "Digit1", "Digit2"].includes(event.code)) {
        event.preventDefault();
        if (event.code === "Digit0") reset();
        else fit(event.code === "Digit2");
      } else if (event.key.toLowerCase() === "h") options.current.onHand(true);
      else if (event.key.toLowerCase() === "v") options.current.onHand(false);
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === "Space") { space = false; cursor(); } };
    const blur = () => { space = false; pointers.clear(); pinch = undefined; drag = undefined; cursor(); };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("keydown", keydown);
    el.addEventListener("keyup", keyup);
    el.addEventListener("blur", blur);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("keydown", keydown);
      el.removeEventListener("keyup", keyup);
      el.removeEventListener("blur", blur);
    };
  }, []);
  return { viewport, world, zoomLabel, fit, reset };
}
