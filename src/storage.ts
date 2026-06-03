import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  CURRENT_VERSION,
  emptyState,
  STATUSES,
  type BoardState,
  type HistoryEntry,
  type Status,
  type Task,
} from "./types.ts";

/** Done tasks are pruned off the board once they've been done for this long. */
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

/**
 * Path to the append-only completion log. Lives beside the state file, so a
 * TANBAN_STATE_FILE override (tests) keeps history in the same temp dir rather
 * than polluting the real config. TANBAN_HISTORY_FILE overrides it outright.
 */
export function historyFilePath(): string {
  const override = process.env.TANBAN_HISTORY_FILE;
  if (override) return override;
  const stateOverride = process.env.TANBAN_STATE_FILE;
  if (stateOverride) return join(dirname(stateOverride), "history.jsonl");
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "tanban", "history.jsonl");
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
  return { version: CURRENT_VERSION, tasks };
}

/**
 * Prune done tasks past the archive window off the board. Their completion is
 * already in the history log, so they're simply dropped from `tasks` here.
 * Returns true if anything changed (so the caller can persist).
 */
export function archiveExpired(state: BoardState, now: number = Date.now()): boolean {
  const cutoff = now - ARCHIVE_AFTER_MS;
  const before = state.tasks.length;
  state.tasks = state.tasks.filter(
    (t) => !(t.status === "done" && (t.completedAt ?? t.updatedAt) <= cutoff),
  );
  return state.tasks.length !== before;
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

// --------------------------------------------------------------- history log

/** Defensively coerce an unknown JSON value into a HistoryEntry, or drop it. */
function parseHistoryEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.taskId !== "string" || typeof r.title !== "string") return null;
  if (typeof r.completedAt !== "number") return null;
  return {
    taskId: r.taskId,
    title: r.title,
    description: typeof r.description === "string" ? r.description : "",
    completedAt: r.completedAt,
  };
}

/** Append one completion record to the log (creates the file/dir on demand). */
export function appendHistory(entry: HistoryEntry, path: string = historyFilePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Read the whole completion log, skipping any malformed lines. */
export function loadHistory(path: string = historyFilePath()): HistoryEntry[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const entry = parseHistoryEntry(JSON.parse(trimmed));
      if (entry) entries.push(entry);
    } catch {
      /* skip a torn/partial line, keep the rest */
    }
  }
  return entries;
}

/**
 * One-time upgrade from the v1 schema: seed the log from the old in-state
 * `archived` list plus any tasks already sitting in Done (completed before the
 * log existed, so they never fired a completion event). No-op once the log
 * exists. Runs before the first save rewrites state.json without `archived`.
 */
export function migrateLegacyArchive(
  statePath: string = stateFilePath(),
  historyPath: string = historyFilePath(),
): void {
  if (existsSync(historyPath)) return;
  if (!existsSync(statePath)) return;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const legacy = Array.isArray(raw.archived)
    ? raw.archived.map(parseTask).filter((t): t is Task => t !== null)
    : [];
  const doneOnBoard = Array.isArray(raw.tasks)
    ? raw.tasks.map(parseTask).filter((t): t is Task => t !== null && t.status === "done")
    : [];
  for (const t of [...legacy, ...doneOnBoard]) {
    appendHistory(
      {
        taskId: t.id,
        title: t.title,
        description: t.description,
        completedAt: t.completedAt ?? t.updatedAt,
      },
      historyPath,
    );
  }
}
