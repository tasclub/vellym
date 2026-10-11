import { describe, expect, it } from "vitest";
import { buildTimeline, timelineBar } from "../packages/plugin-wbs/src/timeline.js";

describe("WBS timeline", () => {
  it("uses the entire date range, including rows beyond the initial rendering limit", () => {
    const rows = Array.from({ length: 23 }, (_, index) => ({ name: `task-${index}`, title: `Task ${index}`,
      values: { "field:start": index === 22 ? "2027-01-01" : "2026-10-01",
        "field:end": index === 22 ? "2027-01-03" : "2026-10-02" } }));
    const timeline = buildTimeline(rows, "start", "end")!;
    expect(new Date(timeline.start).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(new Date(timeline.end).toISOString().slice(0, 10)).toBe("2027-01-04");
    expect(timeline.ticks.length).toBeLessThanOrEqual(13);
    expect(timelineBar(timeline, "2027-01-01", "2027-01-03")?.left).toBeGreaterThan(90);
  });

  it("keeps undated rows, shows one-day dates, and discards invalid calendar dates", () => {
    expect(buildTimeline([{ name: "a", title: "A", values: {} }], "start", "end")).toBeUndefined();
    expect(buildTimeline([{ name: "a", title: "A", values: { "field:start": "2026-02-31" } }], "start", "end"))
      .toBeUndefined();
    const timeline = buildTimeline([{ name: "a", title: "A", values: { "field:start": "2026-10-01" } }], "start", "end")!;
    expect(timelineBar(timeline, "2026-10-01", undefined)).toMatchObject({ left: 0, width: 100 });
    expect(timelineBar(timeline, undefined, undefined)).toBeUndefined();
  });

  it("bounds daily and weekly viewports and marks bars outside or crossing their edges", () => {
    const rows = [
      { name: "early", title: "Early", values: { "field:start": "2025-12-01", "field:end": "2026-01-03" } },
      { name: "late", title: "Late", values: { "field:start": "2026-03-01", "field:end": "2026-03-02" } }
    ];
    const daily = buildTimeline(rows, "start", "end", {
      mode: "day", from: "2026-01-01", to: "2026-12-31"
    })!;
    expect(daily.ticks).toHaveLength(31);
    expect(new Date(daily.end).toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(timelineBar(daily, "2025-12-01", "2025-12-31")).toMatchObject({
      outside: "before", before: true, after: false
    });
    expect(timelineBar(daily, "2026-03-01", "2026-03-02")).toMatchObject({
      outside: "after", before: false, after: true
    });
    expect(timelineBar(daily, "2025-12-31", "2026-01-03")).toMatchObject({
      left: 0, before: true, after: false
    });
    const weekly = buildTimeline(rows, "start", "end", {
      mode: "week", from: "2026-01-01", to: "2026-02-01"
    })!;
    expect(weekly.ticks).toHaveLength(4);
    expect(weekly.ticks[0]?.label).toBe("2026-01-05");
    expect(weekly.ticks.at(-1)!.position).toBeLessThan(100);
    expect(buildTimeline(rows, "start", "end", { from: "2026-02-01", to: "2026-01-01" }))
      .toBeUndefined();
  });
});
