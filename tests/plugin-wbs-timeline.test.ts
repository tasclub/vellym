import { describe, expect, it } from "vitest";
import { buildTimeline, timelineBar, presetRange, TIMELINE_PRESETS, timelineLabelSize, timelineCells, DAY_MS } from "../packages/plugin-wbs/src/timeline.js";

describe("WBS timeline", () => {
  it("aligns presets to Monday and chooses the default scale", () => {
    for (const days of TIMELINE_PRESETS) {
      const range = presetRange(Date.parse("2026-08-19T15:00:00Z"), days);
      expect(new Date(range.start).toISOString()).toBe("2026-08-17T00:00:00.000Z");
      expect((range.end - range.start) / DAY_MS).toBe(days);
      expect(range.mode).toBe(days <= 35 ? "day" : "week");
    }
  });

  it("suppresses labels below the tier minimum", () => {
    for (const [tier, min] of [["day", 22], ["week", 44], ["month", 30]] as const) {
      expect(timelineLabelSize(tier, min - 0.01)).toBe("none");
      expect(timelineLabelSize(tier, min)).toBe("short");
    }
    expect(timelineLabelSize("month", 83.99)).toBe("short");
    expect(timelineLabelSize("month", 84)).toBe("long");
  });
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
    expect(daily.ticks).toHaveLength(182);
    expect(new Date(daily.start).getUTCDay()).toBe(1);
    expect((daily.end - daily.start) / DAY_MS).toBe(182);
    expect(timelineBar(daily, "2025-12-01", "2025-12-28")).toMatchObject({
      outside: "before", before: true, after: false
    });
    expect(timelineBar(daily, "2026-12-01", "2026-12-02")).toMatchObject({
      outside: "after", before: false, after: true
    });
    expect(timelineBar(daily, "2025-12-28", "2026-01-03")).toMatchObject({
      left: 0, before: true, after: false
    });
    const weekly = buildTimeline(rows, "start", "end", {
      mode: "week", from: "2026-01-01", to: "2026-02-01"
    })!;
    expect(weekly.ticks).toHaveLength(5);
    expect(weekly.ticks[0]?.label).toBe("2025-12-29");
    expect(weekly.ticks.at(-1)!.position).toBeLessThan(100);
    expect(buildTimeline(rows, "start", "end", { from: "2026-02-01", to: "2026-01-01" }))
      .toBeUndefined();
  });
  it("uses seven days for partial dates and rejects reversed dates, but not a one-day period", () => {
    const range = presetRange(Date.parse("2026-08-17"), 35);
    const timeline = { ...range, ticks: [] };
    expect(timelineBar(timeline, "2026-08-20", undefined)?.width).toBe(20);
    expect(timelineBar(timeline, undefined, "2026-08-30")?.width).toBe(20);
    expect(timelineBar(timeline, "2026-08-20", "2026-08-19")).toBeUndefined();
    expect(timelineBar(timeline, "2026-08-20", "2026-08-20")?.width).toBeCloseTo(100 / 35);
  });
  it("bounds all tier labels to nonoverlapping cells for every preset and scale", () => {
    for (const days of TIMELINE_PRESETS) for (const mode of ["day", "week"] as const) {
      const timeline = { ...presetRange(Date.parse("2026-08-19"), days), ticks: [] };
      for (const dayWidth of [1, 9, 24, 28]) {
        const { cells, months } = timelineCells(timeline, mode, dayWidth);
        for (const [index, cell] of cells.entries()) {
          expect(cell.showLabel).toBe(cell.width >= (mode === "day" ? 22 : 44));
          if (index) expect(cells[index - 1]!.left + cells[index - 1]!.width).toBeLessThanOrEqual(cell.left);
        }
        for (const cell of months) expect(cell.labelSize === "none").toBe(cell.width < 30);
      }
    }
  });
});
