/** The four kanban columns, in board order (left → right). */
export const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;

export type Status = (typeof STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  /** Optional free-text body. Empty string when absent. */
  description: string;
  status: Status;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  /** Set when a task enters `done`; cleared when it leaves. Drives archiving. */
  completedAt?: number;
}

export interface BoardState {
  /** Bumped when the on-disk shape changes so we can migrate. */
  version: number;
  /** Source of truth for both membership (status) and ordering (array order). */
  tasks: Task[];
}

/**
 * One completed-work record in the append-only history log (`history.jsonl`).
 * Written when a task enters Done, so the record survives the task later being
 * pruned off the board, edited, deleted, or reopened. Drives the history view.
 */
export interface HistoryEntry {
  taskId: string;
  /** Title/description captured at completion time (a point-in-time snapshot). */
  title: string;
  description: string;
  /** Epoch milliseconds the task was completed. */
  completedAt: number;
}

export const CURRENT_VERSION = 2;

export function emptyState(): BoardState {
  return { version: CURRENT_VERSION, tasks: [] };
}
