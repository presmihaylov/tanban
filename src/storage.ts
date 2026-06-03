import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  CURRENT_VERSION,
  emptyState,
  STATUSES,
  type BoardState,
  type Status,
  type Task,
} from "./types.ts";

/** Done tasks are archived once they've been done for this long. */
export const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve the state file path, honouring XDG_CONFIG_HOME and falling back to
 * ~/.config. Override the whole path with TANBAN_STATE_FILE (handy for tests).
 */
export function stateFilePath(): string {
  const override = process.env.TANBAN_STATE_FILE;
  if (override) return override;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "tanban", "state.json");
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Defensively coerce an unknown JSON value into a Task, or drop it. */
function parseTask(raw: unknown): Task | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  if (!isStatus(r.status)) return null;
  const now = Date.now();
  const task: Task = {
    id: r.id,
    title: r.title,
    description: typeof r.description === "string" ? r.description : "",
    status: r.status,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : now,
  };
  if (typeof r.completedAt === "number") task.completedAt = r.completedAt;
  // A done task must have a completion stamp so archiving has a clock to read.
  if (task.status === "done" && task.completedAt === undefined) {
    task.completedAt = task.updatedAt;
  }
  return task;
}

function parseState(text: string): BoardState {
  const data = JSON.parse(text) as Record<string, unknown>;
  const tasks = Array.isArray(data.tasks)
    ? data.tasks.map(parseTask).filter((t): t is Task => t !== null)
    : [];
  const archived = Array.isArray(data.archived)
    ? data.archived.map(parseTask).filter((t): t is Task => t !== null)
    : [];
  return { version: CURRENT_VERSION, tasks, archived };
}

/**
 * Move done tasks past the archive window out of `tasks` into `archived`.
 * Returns true if anything changed (so the caller can persist).
 */
export function archiveExpired(state: BoardState, now: number = Date.now()): boolean {
  const cutoff = now - ARCHIVE_AFTER_MS;
  const expired = state.tasks.filter(
    (t) => t.status === "done" && (t.completedAt ?? t.updatedAt) <= cutoff,
  );
  if (expired.length === 0) return false;
  const expiredIds = new Set(expired.map((t) => t.id));
  state.tasks = state.tasks.filter((t) => !expiredIds.has(t.id));
  // Newest archived first.
  state.archived = [...expired, ...state.archived].sort(
    (a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt),
  );
  return true;
}

/** Load state from disk (returns an empty board if the file is missing or corrupt). */
export function loadState(path: string = stateFilePath()): BoardState {
  if (!existsSync(path)) return emptyState();
  try {
    return parseState(readFileSync(path, "utf8"));
  } catch {
    // Corrupt file: keep a backup so the user can recover, then start clean.
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      /* best effort */
    }
    return emptyState();
  }
}

/** Persist state atomically (write to a temp file, then rename into place). */
export function saveState(state: BoardState, path: string = stateFilePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
