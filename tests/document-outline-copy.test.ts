// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentOutline } from "../packages/ui-react/src/shell/document-outline.js";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const headings = [
  { id: "first", text: "First", depth: 2 },
  { id: "日本語", text: "日本語", depth: 2 }
];

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([false, true])("copies the hash heading in compact=%s and clears feedback", async (compact) => {
  history.replaceState(null, "", "/page?x=1#%E6%97%A5%E6%9C%AC%E8%AA%9E");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  act(() => root.render(createElement(DocumentOutline, { headings, compact, onSelect: vi.fn() })));
  await act(async () => host.querySelector("button")!.click());
  expect(writeText).toHaveBeenCalledWith(new URL(location.href).toString());
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("outline.linkCopied");
  act(() => vi.advanceTimersByTime(3000));
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("");
});

it("uses the current heading when the hash is unknown and reports clipboard failure", async () => {
  history.replaceState(null, "", "/page#unknown");
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  act(() => root.render(createElement(DocumentOutline, { headings, onSelect: vi.fn() })));
  await act(async () => host.querySelector("button")!.click());
  expect(writeText).toHaveBeenCalledWith(new URL("/page#first", location.href).toString());
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("outline.copyFailed");
});
