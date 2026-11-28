import type { CSSProperties } from "react";
import type { Transition } from "../model/types.js";

/** CSS transitions only; reversing also exchanges the entering/leaving roles. */
export function transitionStyles(transition: Transition | undefined, reverse: boolean, reduced: boolean,
  entering: boolean, running: boolean): CSSProperties {
  if (!transition || transition.type === "instant" || reduced) return {};
  const duration = Math.max(0, transition.duration ?? 300);
  const direction = transition.direction ?? "left";
  const vector = ({ left: [-100, 0], right: [100, 0], top: [0, -100], bottom: [0, 100] } as const)[direction];
  const [x, y] = vector;
  const incoming = reverse ? !entering : entering;
  const phase = reverse ? !running : running;
  const type = transition.type;
  const moving = type === "push" || (incoming ? type === "slideIn" || type === "moveIn" : type === "slideOut" || type === "moveOut");
  const displaced = incoming ? !phase : phase;
  // Incoming starts opposite the travel direction; outgoing travels in that direction.
  const sign = incoming ? -1 : 1;
  return {
    transition: `transform ${duration}ms ${transition.easing ?? "ease-out"}, opacity ${duration}ms ${transition.easing ?? "ease-out"}`,
    transform: moving && displaced ? `translate(${sign * x}%, ${sign * y}%)` : "translate(0%, 0%)",
    opacity: type === "dissolve" ? (incoming === phase ? 1 : 0) : 1,
    zIndex: type === "slideOut" || type === "moveOut" ? (incoming ? 0 : 1) : (incoming ? 1 : 0)
  };
}
