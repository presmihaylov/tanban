import { ARCHIVE_AFTER_MS } from "./storage.ts";
import type { BoardState, HistoryEntry, Status, Task } from "./types.ts";

/**
 * Tasks in a column, preserving the order they appear in `state.tasks`.
 * Array order is the single source of truth for within-column ordering.
 */
export function tasksByStatus(state: BoardState, status: Status): Task[] {
  return state.tasks.filter((t) => t.status === status);
}

/** Whole days left before a done task is archived, or null if not applicable. */
export function daysUntilArchive(task: Task, now: number = Date.now()): number | null {
  if (task.status !== "done") return null;
  const since = task.completedAt ?? task.updatedAt;
  const remaining = since + ARCHIVE_AFTER_MS - now;
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

/** Compact human-friendly relative time, e.g. "3d ago", "just now". */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Truncate with an ellipsis so long titles never blow out a column. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max === 1) return "…";
  return `${s.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------- history

export type HistoryRange = "today" | "week" | "month" | "all";

/** Selectable ranges in cycle order (Tab in the history view). */
export const HISTORY_RANGES: readonly HistoryRange[] = ["today", "week", "month", "all"];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local midnight (ms) for the day containing `now`. */
export function startOfDay(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight of the most recent Monday (week starts Monday). */
function startOfWeek(now: number): number {
  const d = new Date(startOfDay(now));
  const sinceMonday = (d.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  d.setDate(d.getDate() - sinceMonday);
  return d.getTime();
}

/** Local midnight of the first day of the month containing `now`. */
function startOfMonth(now: number): number {
  const d = new Date(startOfDay(now));
  d.setDate(1);
  return d.getTime();
}

/** Inclusive lower bound (ms) for a range; `all` returns 0. */
export function rangeStart(range: HistoryRange, now: number = Date.now()): number {
  if (range === "today") return startOfDay(now);
  if (range === "week") return startOfWeek(now);
  if (range === "month") return startOfMonth(now);
  return 0;
}

export function rangeLabel(range: HistoryRange): string {
  if (range === "today") return "Today";
  if (range === "week") return "This Week";
  if (range === "month") return "This Month";
  return "All Time";
}

/** Human day header, e.g. "Today", "Yesterday", "Mon 2 Jun" (year if not current). */
export function dayLabel(dayStart: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  if (dayStart === today) return "Today";
  if (dayStart === startOfDay(today - 1)) return "Yesterday";
  const d = new Date(dayStart);
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Local HH:MM for a completion timestamp. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface HistoryDay {
  dayStart: number;
  label: string;
  entries: HistoryEntry[];
}

/**
 * Merge the durable log with the tasks currently sitting in Done, dedupe by
 * task id (keeping the latest completion), filter to `range`, and group by
 * local day, newest first. Including board-done tasks means recent work shows
 * up even if a completion event was somehow never logged.
 */
export function buildHistory(
  boardDone: Task[],
  log: HistoryEntry[],
  range: HistoryRange,
  now: number = Date.now(),
): { days: HistoryDay[]; total: number } {
  const latest = new Map<string, HistoryEntry>();
  const consider = (e: HistoryEntry) => {
    const prev = latest.get(e.taskId);
    // `>=` so a same-timestamp board task wins, reflecting its current title.
    if (!prev || e.completedAt >= prev.completedAt) latest.set(e.taskId, e);
  };
  for (const e of log) consider(e);
  for (const t of boardDone) {
    consider({
      taskId: t.id,
      title: t.title,
      description: t.description,
      completedAt: t.completedAt ?? t.updatedAt,
    });
  }

  const start = rangeStart(range, now);
  const inRange = [...latest.values()]
    .filter((e) => e.completedAt >= start && e.completedAt <= now)
    .sort((a, b) => b.completedAt - a.completedAt);

  const byDay = new Map<number, HistoryEntry[]>();
  for (const e of inRange) {
    const key = startOfDay(e.completedAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(e);
    if (!bucket) byDay.set(key, [e]);
  }
  const days: HistoryDay[] = [...byDay.keys()]
    .sort((a, b) => b - a)
    .map((dayStart) => ({ dayStart, label: dayLabel(dayStart, now), entries: byDay.get(dayStart)! }));

  return { days, total: inRange.length };
}

/**
 * Greedy word-wrap into lines no wider than `max`. Whitespace runs collapse to
 * a single space; words longer than `max` are hard-split so nothing overflows.
 * Returns at least one (possibly empty) line.
 */
export function wrapText(s: string, max: number): string[] {
  if (max <= 0) return [""];
  const words = s.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";

  const flush = () => {
    if (line.length > 0) lines.push(line);
    line = "";
  };

  for (const word of words) {
    let w = word;
    // Hard-split a word too long to ever fit on a single line.
    while (w.length > max) {
      flush();
      lines.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (w.length === 0) continue;
    if (line.length === 0) {
      line = w;
      continue;
    }
    if (line.length + 1 + w.length <= max) {
      line += ` ${w}`;
      continue;
    }
    flush();
    line = w;
  }
  flush();

  return lines.length > 0 ? lines : [""];
}
