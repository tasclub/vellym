/**
 * Evaluate a typed number such as `16*2` or `(100 - 8) / 2`: + - * / and parentheses
 * over decimal numbers. Anything else is rejected (no eval).
 */
export function evaluate(text: string): number | undefined {
  const source = text.replace(/\s+/g, "").replace(/,/g, ".");
  let at = 0;
  const peek = () => source[at];
  const number = (): number | undefined => {
    const match = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\./i.exec(source.slice(at));
    if (!match) return;
    at += match[0].length;
    return Number(match[0]);
  };
  const factor = (): number | undefined => {
    if (peek() === "-") { at++; const value = factor(); return value === undefined ? undefined : -value; }
    if (peek() === "+") { at++; return factor(); }
    if (peek() === "(") {
      at++;
      const value = sum();
      if (peek() !== ")") return;
      at++;
      return value;
    }
    return number();
  };
  const product = (): number | undefined => {
    let value = factor();
    while (value !== undefined && (peek() === "*" || peek() === "/")) {
      const op = source[at++], right = factor();
      if (right === undefined) return;
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number | undefined => {
    let value = product();
    while (value !== undefined && (peek() === "+" || peek() === "-")) {
      const op = source[at++], right = product();
      if (right === undefined) return;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  if (!source) return;
  const value = sum();
  return value !== undefined && at === source.length && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}
