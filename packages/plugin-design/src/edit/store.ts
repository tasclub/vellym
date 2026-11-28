import type { PluginRenderContext } from "@vellym/plugin-api";
import type { CanvasRendererData } from "../render/board-view.js";
import type { DesignNode } from "../model/types.js";
import { Autosave } from "./autosave.js";
import { DesignHistory } from "./history.js";
import { fieldOf, sameValue, type BoardPosition, type DesignOperation } from "./operations.js";

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
  private dirtyFields = new Map<string, Set<"root" | "position">>();
  private known: Snapshot;
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
  private adoptRoots(data: CanvasRendererData) {
    for (const row of [...data.boards, ...data.components]) {
      if (row.spec.root && !this.dirty.has(row.name)) this.roots.set(row.name, row.spec.root);
    }
    for (const row of data.boards) {
      if (!this.dirty.has(row.name) && typeof row.spec.x === "number" && typeof row.spec.y === "number")
        this.positions.set(row.name, { x: row.spec.x, y: row.spec.y });
    }
  }
  observe(data: CanvasRendererData) {
    if (!this.editable) return;
    // The host refreshes rendererData before context.save resolves with its hash.
    if (this.saving) { this.deferred = data; return; }
    const incoming = hashes(data);
    if (!unchangedHashes(this.known, incoming)) { this.externalChange(); return; }
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
      const current = fieldOf(change) === "position" ? this.positions.get(change.targetName) : this.roots.get(change.targetName);
      if (names.has(key) || !this.known.get(change.targetName) || !sameValue(current, change.before)) return false;
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
        ...(fields.has("position") && position ? [{ path: ["x"], value: position.x }, { path: ["y"], value: position.y }] : [])
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
