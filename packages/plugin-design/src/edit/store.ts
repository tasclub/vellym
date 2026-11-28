import type { PluginRenderContext } from "@vellym/plugin-api";
import type { CanvasRendererData } from "../render/board-view.js";
import type { DesignNode } from "../model/types.js";
import { Autosave } from "./autosave.js";
import { DesignHistory } from "./history.js";
import { fieldOf, sameValue, type BoardPosition, type DesignChange, type DesignOperation, type DesignPage } from "./operations.js";

type Snapshot = Map<string, string | undefined>;
function hashes(data: CanvasRendererData): Snapshot {
  return new Map([
    ...(data.canvas ? [[data.canvas.name, data.canvas.hash] as const] : []),
    ...[...data.boards, ...data.components, ...data.styles].map(row => [row.name, row.hash] as const),
    ...data.tokenFiles.map(row => [row.relativePath, row.hash] as const)
  ]);
}
const unchangedHashes = (a: Snapshot, b: Snapshot) =>
  [...a].every(([name, hash]) => b.has(name) && b.get(name) === hash);

/** Model operations, not DOM/file diffs. This foundation edits board/component roots. */
export class DesignStore {
  readonly history = new DesignHistory();
  private roots = new Map<string, DesignNode>();
  private positions = new Map<string, BoardPosition>();
  /** Which parts of each resource are unsaved. */
  private dirtyFields = new Map<string, Set<DesignChange["field"] & string | "root">>();
  /** Canvas page lists and board pages, like roots: the model's own copy while editing. */
  private pageLists = new Map<string, DesignPage[]>();
  private boardPages = new Map<string, string | undefined>();
  private known: Snapshot;
  /** Hashes our own saves replaced: data still showing one of them is stale, not an external edit. */
  private replaced = new Map<string, Set<string>>();
  private dirty = new Map<string, number>();
  private revision = 0;
  private saving = false;
  private deferred?: CanvasRendererData;
  private stopped = false;
  private listeners = new Set<() => void>();
  private version = 0;
  readonly autosave: Autosave;
  status: "" | "saving" | "saved" | "saveFailed" = "";
  error = "";

  constructor(data: CanvasRendererData, public context: PluginRenderContext,
    private readonly reload: () => void) {
    this.known = hashes(data);
    this.adoptRoots(data);
    this.autosave = new Autosave(() => this.save());
  }
  get editable() { return !this.stopped && !this.context.isStatic && !this.context.target?.readOnly; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  private emit() { this.version++; this.listeners.forEach(listener => listener()); }
  root(name: string) { return this.roots.get(name); }
  position(name: string) { return this.positions.get(name); }
  pages(name: string) { return this.pageLists.get(name); }
  /** A board's page as the model has it: `undefined` when it has no explicit page; `null` when unknown. */
  pageOf(name: string): string | undefined | null { return this.boardPages.has(name) ? this.boardPages.get(name) : null; }
  /**
   * Before deleting a resource ourselves: stop tracking it, so the refresh without it is not taken
   * for an external change, and drop the history steps that touch it.
   */
  forget(name: string) {
    this.known.delete(name);
    this.roots.delete(name); this.positions.delete(name); this.boardPages.delete(name);
    this.dirty.delete(name); this.dirtyFields.delete(name); this.replaced.delete(name);
    this.history.forget(name);
    this.emit();
  }
  private current(change: DesignChange): unknown {
    const field = fieldOf(change);
    return field === "position" ? this.positions.get(change.targetName)
      : field === "pages" ? this.pageLists.get(change.targetName) ?? []
      : field === "page" ? this.boardPages.get(change.targetName) : this.roots.get(change.targetName);
  }
  private adoptRoots(data: CanvasRendererData) {
    for (const row of [...data.boards, ...data.components]) {
      if (row.spec.root && !this.dirty.has(row.name)) this.roots.set(row.name, row.spec.root);
    }
    for (const row of data.boards) {
      if (this.dirty.has(row.name)) continue;
      if (typeof row.spec.x === "number" && typeof row.spec.y === "number") this.positions.set(row.name, { x: row.spec.x, y: row.spec.y });
      this.boardPages.set(row.name, typeof row.spec.page === "string" ? row.spec.page : undefined);
    }
    if (data.canvas && !this.dirty.has(data.canvas.name))
      this.pageLists.set(data.canvas.name, (data.canvas.spec.pages ?? []) as DesignPage[]);
  }
  observe(data: CanvasRendererData) {
    if (!this.editable) return;
    // The host refreshes rendererData before context.save resolves with its hash.
    if (this.saving) { this.deferred = data; return; }
    const incoming = hashes(data);
    // A refresh taken between the files of one multi-file save still carries the hashes this save
    // replaced: it is out of date, so wait for the next one instead of reloading everything.
    const stale = [...this.known].some(([name, hash]) => incoming.get(name) !== hash && this.replaced.get(name)?.has(incoming.get(name) ?? ""));
    if (stale) return;
    if (!unchangedHashes(this.known, incoming)) { this.externalChange(); return; }
    this.replaced.clear();
    // Newly created resources have no previous model/hash to invalidate. In
    // particular, the host's "New board" flow must not look like an external edit.
    this.known = incoming;
    this.adoptRoots(data);
  }
  apply(operation: DesignOperation, now = Date.now()) {
    if (!this.editable || !operation.changes.length) return false;
    const names = new Set<string>();
    for (const change of operation.changes) {
      const key = `${change.targetName}:${fieldOf(change)}`;
      if (names.has(key) || !this.known.get(change.targetName) || !sameValue(this.current(change), change.before)) return false;
      names.add(key);
    }
    if (operation.changes.every(change => sameValue(change.before, change.after))) return false;
    this.history.push(operation, now);
    this.write(operation, false);
    return true;
  }
  undo() {
    if (!this.editable) return;
    const operation = this.history.undo();
    if (operation) this.write(operation, true);
  }
  redo() {
    if (!this.editable) return;
    const operation = this.history.redo();
    if (operation) this.write(operation, false);
  }
  private write(operation: DesignOperation, reverse: boolean) {
    for (const change of operation.changes) {
      const value = structuredClone(reverse ? change.before : change.after);
      if (change.field === "position") this.positions.set(change.targetName, value as BoardPosition);
      else if (change.field === "pages") this.pageLists.set(change.targetName, value as DesignPage[]);
      else if (change.field === "page") this.boardPages.set(change.targetName, value as string | undefined);
      else this.roots.set(change.targetName, value as DesignNode);
      this.dirty.set(change.targetName, ++this.revision);
      const fields = this.dirtyFields.get(change.targetName) ?? new Set();
      fields.add(fieldOf(change));
      this.dirtyFields.set(change.targetName, fields);
    }
    this.status = "";
    this.error = "";
    this.autosave.schedule();
    this.emit();
  }
  private externalChange() {
    if (this.stopped) return;
    this.dispose();
    this.history.clear();
    this.dirty.clear();
    this.dirtyFields.clear();
    this.roots.clear();
    this.positions.clear();
    this.pageLists.clear();
    this.boardPages.clear();
    this.reload(); // Reload the whole canvas, including partially saved multi-file operations.
  }
  private async save() {
    if (!this.editable || !this.dirty.size) return;
    this.saving = true;
    this.status = "saving";
    this.error = "";
    this.emit();
    const batch = [...this.dirty].map(([name, revision]) => {
      const fields = this.dirtyFields.get(name) ?? new Set(["root" as const]);
      const position = this.positions.get(name);
      // Only what changed is written: a moved board does not rewrite its node tree.
      const writes = [
        ...(fields.has("root") ? [{ path: ["root"], value: structuredClone(this.roots.get(name)!) }] : []),
        ...(fields.has("position") && position ? [{ path: ["x"], value: position.x }, { path: ["y"], value: position.y }] : []),
        ...(fields.has("pages") ? [{ path: ["pages"], value: structuredClone(this.pageLists.get(name) ?? []) }] : []),
        // A board back on "the first page" loses its key (null deletes it).
        ...(fields.has("page") ? [{ path: ["page"], value: this.boardPages.get(name) ?? null }] : [])
      ];
      return { name, revision, writes };
    });
    try {
      for (const item of batch) {
        if (!this.editable) return;
        const baseHash = this.known.get(item.name);
        if (!baseHash) throw new Error("Missing resource hash");
        const result = await this.context.save(item.writes, { targetName: item.name, baseHash });
        if (this.stopped) return;
        if (!result.ok) {
          if (result.reason === "conflict") { this.externalChange(); return; }
          this.error = result.message;
          this.status = "saveFailed";
          return;
        }
        // A persisted root save must return a hash; never fall back to a fresh blind save.
        if (!result.hash) throw new Error("Missing saved resource hash");
        const old = this.known.get(item.name);
        if (old) this.replaced.set(item.name, new Set([...this.replaced.get(item.name) ?? [], old]));
        this.known.set(item.name, result.hash);
        if (this.dirty.get(item.name) === item.revision) { this.dirty.delete(item.name); this.dirtyFields.delete(item.name); }
      }
      this.status = this.dirty.size ? "" : "saved";
    } catch {
      this.status = "saveFailed";
    } finally {
      this.saving = false;
      const deferred = this.deferred;
      this.deferred = undefined;
      if (!this.stopped && deferred) this.observe(deferred);
      if (!this.stopped) this.emit();
    }
  }
  dispose() { this.stopped = true; this.autosave.stop(); }
}
