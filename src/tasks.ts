import { ARCHIVE_AFTER_MS } from "./storage.ts";
import type { BoardState, Status, Task } from "./types.ts";

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
