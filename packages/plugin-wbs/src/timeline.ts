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
export const MAX_TIMELINE_DAYS: Record<TimelineMode, number> = { day: 31, week: 182 };

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
  const start = requestedStart ?? min;
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
  const actualStart = start ?? end!;
  const actualEnd = (end ?? start!) + DAY;
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
