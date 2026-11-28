import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRenderContext, PluginSaveResult } from "@vellym/plugin-api";
import type { DesignNode } from "../packages/plugin-design/src/model/types.js";
import type { CanvasRendererData } from "../packages/plugin-design/src/render/board-view.js";
import { DesignHistory } from "../packages/plugin-design/src/edit/history.js";
import { DesignStore } from "../packages/plugin-design/src/edit/store.js";

const root = (x = 0): DesignNode => ({ id: "root", type: "frame", width: 100, height: 100, x, children: [] });
const op = (before = 0, after = 1, mergeKey?: string) =>
  ({ changes: [{ targetName: "board", before: root(before), after: root(after) }], mergeKey });
function data(hash = "h0", x = 0): CanvasRendererData {
  return {
    canvas: { name: "canvas", hash: "c0", relativePath: "canvas.yaml", spec: { formatVersion: 1 } },
    boards: [{ name: "board", hash, relativePath: "board.yaml", spec: { canvas: "canvas", x: 0, y: 0, root: root(x) } }],
    components: [], styles: [], tokenFiles: [], notices: []
  };
}
function setup(options: Partial<PluginRenderContext> = {}, initial = data()) {
  const save = vi.fn<PluginRenderContext["save"]>(async () => ({ ok: true, hash: "h1" }));
  const reload = vi.fn();
  const context = { save, ...options } as unknown as PluginRenderContext;
  return { store: new DesignStore(initial, context, reload), save, reload };
}
afterEach(() => vi.useRealTimers());

describe("model operation history", () => {
  it("retains only the last 100 operations and redoes them in order", () => {
    const history = new DesignHistory();
    for (let i = 0; i < 110; i++) history.push(op(i, i + 1));
    expect(history.undoCount).toBe(100);
    for (let i = 109; i >= 10; i--) expect(history.undo()?.changes[0]?.before.x).toBe(i);
    expect(history.undo()).toBeUndefined();
    for (let i = 10; i < 110; i++) expect(history.redo()?.changes[0]?.after.x).toBe(i + 1);
    expect(history.redo()).toBeUndefined();
  });
  it("merges only continuous keyed nudges inside 500ms, retaining the first before value", () => {
    const history = new DesignHistory();
    history.push(op(0, 1, "nudge"), 0);
    history.push(op(1, 2, "nudge"), 499);
    history.push(op(2, 3, "nudge"), 999);
    expect(history.undoCount).toBe(2);
    expect(history.undo()?.changes[0]).toMatchObject({ before: { x: 2 }, after: { x: 3 } });
    expect(history.undo()?.changes[0]).toMatchObject({ before: { x: 0 }, after: { x: 2 } });
  });
  it("does not merge separate gestures, different selections, or edits after undo/redo", () => {
    const history = new DesignHistory();
    history.push(op(), 0);
    history.push(op(1, 2), 1);
    history.push(op(2, 3, "nudge"), 2);
    history.push({ changes: [{ targetName: "other", before: root(), after: root(1) }], mergeKey: "nudge" }, 3);
    expect(history.undoCount).toBe(4);
    history.undo();
    history.push(op(3, 4, "nudge"), 4);
    expect(history.redoCount).toBe(0);
    expect(history.undoCount).toBe(4);
    history.undo(); history.redo();
    history.push(op(4, 5, "nudge"), 5);
    expect(history.undoCount).toBe(5);
  });
  it("owns its operation values, not mutable caller references", () => {
    const history = new DesignHistory();
    const operation = op();
    history.push(operation);
    operation.changes[0]!.before.x = 99;
    expect(history.undo()?.changes[0]?.before.x).toBe(0);
  });
});

describe("autosave and external changes", () => {
  it("debounces 800ms, saves each root with the loaded hash, and keeps history after saving", async () => {
    vi.useFakeTimers();
    const { store, save } = setup();
    store.apply(op());
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith([{ path: ["root"], value: root(1) }], { targetName: "board", baseHash: "h0" });
    expect(store.status).toBe("saved");
    store.undo();
    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls[1]).toEqual([[{ path: ["root"], value: root() }], { targetName: "board", baseHash: "h1" }]);
    store.redo();
    expect(store.root("board")?.x).toBe(1);
    store.dispose();
  });
  it("moves a board's position as its own change: undo, merged nudges, and saving x/y without the root", async () => {
    vi.useFakeTimers();
    const { store, save } = setup();
    const nudge = (from: number, to: number) => ({ mergeKey: "nudge:board", changes: [{ targetName: "board", field: "position" as const,
      before: { x: from, y: 0 }, after: { x: to, y: 0 } }] });
    expect(store.position("board")).toEqual({ x: 0, y: 0 });
    expect(store.apply(nudge(0, 1))).toBe(true);
    expect(store.apply(nudge(1, 2))).toBe(true);
    // A stale "before" is refused like a root change.
    expect(store.apply(nudge(0, 5))).toBe(false);
    expect(store.history.undoCount).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledWith([{ path: ["x"], value: 2 }, { path: ["y"], value: 0 }], { targetName: "board", baseHash: "h0" });
    store.undo();
    expect(store.position("board")).toEqual({ x: 0, y: 0 });
    // A root and a position change of the same board in one operation write together.
    store.apply({ changes: [{ targetName: "board", before: root(), after: root(3) },
      { targetName: "board", field: "position", before: { x: 0, y: 0 }, after: { x: 10, y: 20 } }] });
    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls.at(-1)![0]).toEqual([{ path: ["root"], value: root(3) }, { path: ["x"], value: 10 }, { path: ["y"], value: 20 }]);
    store.dispose();
  });

  it("defers the host's self-notification until the save response hash arrives", async () => {
    vi.useFakeTimers();
    const { store, save, reload } = setup();
    save.mockImplementation(async () => {
      store.observe(data("h1", 1));
      return { ok: true, hash: "h1" };
    });
    store.apply(op());
    await vi.advanceTimersByTimeAsync(800);
    expect(reload).not.toHaveBeenCalled();
    expect(store.history.undoCount).toBe(1);
    expect(store.root("board")?.x).toBe(1);
    store.dispose();
  });
  it("serializes edits during saving and uses the successful hash for the next save", async () => {
    vi.useFakeTimers();
    const { store, save } = setup();
    let resolve!: (result: PluginSaveResult) => void;
    save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    store.apply(op());
    await vi.advanceTimersByTimeAsync(800);
    expect(store.status).toBe("saving");
    store.apply(op(1, 2));
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    resolve({ ok: true, hash: "h1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([[{ path: ["root"], value: root(2) }], { targetName: "board", baseHash: "h1" }]);
    store.dispose();
  });
  it("does not save a subsequent edit until 800ms after its own commit", async () => {
    vi.useFakeTimers();
    const { store, save } = setup();
    let resolve!: (result: PluginSaveResult) => void;
    save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    store.apply(op());
    await vi.advanceTimersByTimeAsync(800);
    store.apply(op(1, 2));
    resolve({ ok: true, hash: "h1" });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    store.dispose();
  });
  it("cancels pending work, clears all history, and reloads on an external hash", async () => {
    vi.useFakeTimers();
    const { store, save, reload } = setup();
    store.apply(op());
    store.observe(data("external", 50));
    await vi.advanceTimersByTimeAsync(800);
    expect(save).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.history.undoCount).toBe(0);
    expect(store.history.redoCount).toBe(0);
    expect(store.apply(op())).toBe(false);
  });
  it("adopts newly created boards without invalidating existing operations", () => {
    vi.useFakeTimers();
    const { store, reload } = setup();
    store.apply(op());
    const updated = data();
    updated.boards.push({ ...updated.boards[0]!, name: "new-board", hash: "new0" });
    store.observe(updated);
    expect(reload).not.toHaveBeenCalled();
    expect(store.history.undoCount).toBe(1);
    expect(store.root("board")?.x).toBe(1);
    expect(store.root("new-board")?.x).toBe(0);
    store.dispose();
  });
  it("reloads all resources after a conflict partway through a multi-file operation", async () => {
    vi.useFakeTimers();
    const initial = data();
    initial.boards.push({ ...initial.boards[0]!, name: "second", hash: "s0" });
    const { store, save, reload } = setup({}, initial);
    save.mockResolvedValueOnce({ ok: true, hash: "h1" })
      .mockResolvedValueOnce({ ok: false, reason: "conflict", message: "Conflict" });
    store.apply({ changes: [...op().changes, { targetName: "second", before: root(), after: root(2) }] });
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.root("board")).toBeUndefined();
    expect(store.root("second")).toBeUndefined();
    expect(store.history.undoCount).toBe(0);
  });
  it("detects external changes arriving during a save even if that save succeeds", async () => {
    vi.useFakeTimers();
    const { store, save, reload } = setup();
    save.mockImplementation(async () => {
      store.observe(data("external", 10));
      return { ok: true, hash: "h1" };
    });
    store.apply(op());
    await vi.advanceTimersByTimeAsync(800);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it.each([{ isStatic: true }, { target: { readOnly: true } }])("does nothing when editing is unavailable: %j", async options => {
    vi.useFakeTimers();
    const { store, save, reload } = setup(options as Partial<PluginRenderContext>);
    expect(store.apply(op())).toBe(false);
    store.undo(); store.redo(); store.observe(data("external"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(store.history.undoCount).toBe(0);
    store.dispose();
  });
  it("shows errors, retains unsaved edits/history, and retries with the old hash on the next commit", async () => {
    vi.useFakeTimers();
    const { store, save, reload } = setup();
    save.mockResolvedValueOnce({ ok: false, reason: "error", message: "Disk full" });
    store.apply(op());
    await vi.advanceTimersByTimeAsync(800);
    expect(store.status).toBe("saveFailed");
    expect(store.error).toBe("Disk full");
    expect(store.history.undoCount).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    store.apply(op(1, 2));
    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls[1]?.[1]).toEqual({ targetName: "board", baseHash: "h0" });
    store.dispose();
  });
  it("rejects stale/duplicate operations and missing hashes without silently performing a blind save", async () => {
    vi.useFakeTimers();
    const { store, save } = setup();
    expect(store.apply(op(3, 4))).toBe(false);
    expect(store.apply({ changes: [...op().changes, ...op().changes] })).toBe(false);
    store.dispose();
    const initial = data();
    delete initial.boards[0]!.hash;
    const other = setup({}, initial);
    expect(other.store.apply(op())).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).not.toHaveBeenCalled();
    expect(other.save).not.toHaveBeenCalled();
    other.store.dispose();
  });
});
