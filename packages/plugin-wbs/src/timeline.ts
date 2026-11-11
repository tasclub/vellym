import type { PluginIndexRow } from "@vellym/plugin-api";
import { fieldKey } from "@vellym-internal/ticket-engine";

const DAY = 86_400_000;

export function parseDate(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed : undefined;
}

export interface Timeline {
  start: number;
  end: number;
  ticks: Array<{ position: number; label: string }>;
}

export type TimelineMode = "day" | "week";
export const DAY_MS = DAY;
export const MAX_TIMELINE_DAYS: Record<TimelineMode, number> = { day: 182, week: 182 };

export const TIMELINE_PRESETS = [14, 35, 91, 182] as const;
export type TimelinePreset = typeof TIMELINE_PRESETS[number];

/** UTC Monday on or before the given date, independent of the browser timezone. */
export function mondayOnOrBefore(timestamp: number): number {
  const day = Math.floor(timestamp / DAY) * DAY;
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
}

export function presetRange(timestamp: number, days: TimelinePreset): { start: number; end: number; mode: TimelineMode } {
  const start = mondayOnOrBefore(timestamp);
  return { start, end: start + days * DAY, mode: days <= 35 ? "day" : "week" };
}

/** Return the available label form; callers must also clip text to its cell. */
export function timelineLabelSize(tier: "day" | "week" | "month", width: number): "none" | "short" | "long" {
  const minimum = tier === "day" ? 22 : tier === "week" ? 44 : 30;
  if (width < minimum) return "none";
  return tier === "month" && width >= 84 ? "long" : "short";
}

export interface TimelineRange {
  mode?: TimelineMode;
  from?: string;
  to?: string;
}

/** A bounded scale shared by every row, including hidden rows beyond the initial 20. */
export function buildTimeline(rows: readonly PluginIndexRow[], startField?: string, endField?: string,
  range: TimelineRange = {}): Timeline | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (const value of [startField ? row.values[fieldKey(startField)] : undefined,
      endField ? row.values[fieldKey(endField)] : undefined]) {
      const parsed = parseDate(value);
      if (parsed !== undefined) { min = Math.min(min, parsed); max = Math.max(max, parsed); }
    }
  }
  const requestedStart = parseDate(range.from);
  const requestedEnd = parseDate(range.to);
  if (min === Infinity && requestedStart === undefined) return undefined;
  const start = range.mode ? mondayOnOrBefore(requestedStart ?? min) : requestedStart ?? min;
  const requestedEndExclusive = requestedEnd !== undefined ? requestedEnd + DAY : Math.max(max + DAY, start + DAY);
  if (requestedEndExclusive <= start) return undefined;
  const end = range.mode ? Math.min(requestedEndExclusive,
    start + MAX_TIMELINE_DAYS[range.mode] * DAY) : requestedEndExclusive;
  const days = (end - start) / DAY;
  const step = range.mode === "day" ? 1 : range.mode === "week" ? 7 : Math.max(1, Math.ceil(days / 12));
  const firstDay = range.mode === "week"
    ? (8 - new Date(start).getUTCDay()) % 7 : 0;
  const offset = firstDay >= days ? 0 : firstDay;
  const ticks = [];
  for (let day = offset; day < days; day += step) {
    ticks.push({ position: day / days * 100, label: new Date(start + day * DAY).toISOString().slice(0, 10) });
  }
  return { start, end, ticks };
}

export function timelineBar(timeline: Timeline, startValue: unknown, endValue: unknown):
  { left: number; width: number; before: boolean; after: boolean; outside?: "before" | "after" } | undefined {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (start === undefined && end === undefined) return undefined;
  const actualStart = start ?? end! - 6 * DAY;
  const actualEnd = end !== undefined ? end + DAY : start! + 7 * DAY;
  if (start !== undefined && end !== undefined && end < start) return undefined;
  if (actualEnd <= actualStart) return undefined;
  if (actualEnd <= timeline.start) return { left: 0, width: 0, before: true, after: false, outside: "before" };
  if (actualStart >= timeline.end) return { left: 100, width: 0, before: false, after: true, outside: "after" };
  const from = Math.max(timeline.start, actualStart);
  const to = Math.min(timeline.end, actualEnd);
  const span = timeline.end - timeline.start;
  return { left: (from - timeline.start) / span * 100,
    width: Math.max((to - from) / span * 100, 0.25),
    before: actualStart < timeline.start, after: actualEnd > timeline.end };
}

/** Cell widths and tier boundaries are shared by the header and row grid. */
export function timelineCells(timeline: Timeline, mode: TimelineMode, dayWidth: number) {
  const days = (timeline.end - timeline.start) / DAY;
  const cells = [];
  for (let offset = 0; offset < days; offset += mode === "day" ? 1 : 7) {
    const timestamp = timeline.start + offset * DAY;
    const width = Math.min(mode === "day" ? 1 : 7, days - offset) * dayWidth;
    cells.push({ timestamp, left: offset * dayWidth, width,
      showLabel: timelineLabelSize(mode, width) !== "none" });
  }
  const months = [];
  let cursor = timeline.start;
  while (cursor < timeline.end) {
    const date = new Date(cursor);
    const end = Math.min(timeline.end, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    const width = (end - cursor) / DAY * dayWidth;
    months.push({ timestamp: cursor, left: (cursor - timeline.start) / DAY * dayWidth,
      width, labelSize: timelineLabelSize("month", width) });
    cursor = end;
  }
  return { cells, months };
}
