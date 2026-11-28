import { mergeOperations, type DesignOperation } from "./operations.js";

export class DesignHistory {
  private past: DesignOperation[] = [];
  private future: DesignOperation[] = [];
  private lastTime = -Infinity;

  get undoCount() { return this.past.length; }
  get redoCount() { return this.future.length; }

  push(operation: DesignOperation, now = Date.now()) {
    const previous = this.past.at(-1);
    const merged = !this.future.length && previous && now - this.lastTime < 500
      ? mergeOperations(previous, operation) : undefined;
    if (merged) this.past[this.past.length - 1] = structuredClone(merged);
    else {
      this.past.push(structuredClone(operation));
      if (this.past.length > 100) this.past.shift();
    }
    this.future = [];
    this.lastTime = now;
  }
  undo() {
    const operation = this.past.pop();
    if (operation) this.future.push(operation);
    this.lastTime = -Infinity;
    return operation;
  }
  redo() {
    const operation = this.future.pop();
    if (operation) this.past.push(operation);
    this.lastTime = -Infinity;
    return operation;
  }
  /** Drop every step that touches a resource that no longer exists (it cannot be undone or redone). */
  forget(name: string) {
    const keep = (operation: DesignOperation) => !operation.changes.some(change => change.targetName === name);
    this.past = this.past.filter(keep);
    this.future = this.future.filter(keep);
  }
  clear() {
    this.past = [];
    this.future = [];
    this.lastTime = -Infinity;
  }
}
