import { useEffect, useRef, useState, type RefObject } from "react";
import type { Viewport } from "./viewport.js";

const SIZE = 20;
/** A tick step in world units that keeps labels about 80px apart on screen (1, 2, 5 × 10ⁿ). */
export function tickStep(scale: number): number {
  const raw = 80 / Math.max(scale, 1e-6), power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(n => n * power).find(step => step >= raw) ?? raw;
}

/** Top and left rulers in world units, following pan and zoom (`design-view` from the viewport). */
export function Rulers({ world }: { world: RefObject<HTMLDivElement | null> }) {
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const box = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = world.current;
    if (!element) return;
    const matrix = new DOMMatrix(element.style.transform || "none");
    setView({ x: matrix.e, y: matrix.f, scale: matrix.a || 1 });
    const listener = (event: Event) => setView((event as CustomEvent<Viewport>).detail);
    element.addEventListener("design-view", listener);
    return () => element.removeEventListener("design-view", listener);
  }, [world]);
  const step = tickStep(view.scale);
  const ticks = (length: number, offset: number) => {
    const first = Math.ceil(-offset / view.scale / step) * step, out: number[] = [];
    for (let value = first; (value * view.scale + offset) < length; value += step) out.push(value);
    return out;
  };
  return <div ref={box} className="design-rulers" aria-hidden="true" data-testid="design-rulers">
    <svg className="design-ruler design-ruler-x" width={width} height={SIZE} data-testid="design-ruler-x">
      {ticks(width, view.x).map(value => { const at = value * view.scale + view.x;
        return <g key={value}><line x1={at} x2={at} y1={SIZE * 0.4} y2={SIZE} /><text x={at + 2} y={10}>{Math.round(value)}</text></g>; })}
    </svg>
    <svg className="design-ruler design-ruler-y" width={SIZE} height={height} data-testid="design-ruler-y">
      {ticks(height, view.y).map(value => { const at = value * view.scale + view.y;
        return <g key={value}><line y1={at} y2={at} x1={SIZE * 0.4} x2={SIZE} /><text x={2} y={at - 2}>{Math.round(value)}</text></g>; })}
    </svg>
  </div>;
}
