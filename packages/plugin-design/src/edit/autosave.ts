/** A debounce that never runs two saves concurrently, even when edits arrive during I/O. */
export class Autosave {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private due = false;
  private stopped = false;
  constructor(private readonly save: () => Promise<void>) {}

  schedule() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.due = false;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.due = true;
      void this.flush();
    }, 800);
  }
  private async flush() {
    if (this.running || this.stopped || !this.due) return;
    this.running = true;
    this.due = false;
    try { await this.save(); }
    finally {
      this.running = false;
      if (this.due) void this.flush();
    }
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.due = false;
  }
}
