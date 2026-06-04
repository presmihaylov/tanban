import { randomUUID } from "node:crypto";

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

/**
 * One named board ("dimension"). Each board is an independent kanban with its
 * own task list; the app shows one at a time and cycles between them with Tab.
 */
export interface Board {
  id: string;
  name: string;
  /** Source of truth for both membership (status) and ordering (array order). */
  tasks: Task[];
}

export interface BoardState {
  /** Bumped when the on-disk shape changes so we can migrate. */
  version: number;
  /** At least one board, always. */
  boards: Board[];
  /** Which board is currently shown. Falls back to the first board if stale. */
  activeBoardId: string;
}

/**
 * One completed-work record in the append-only history log (`history.jsonl`).
 * Written when a task enters Done, so the record survives the task later being
 * pruned off the board, edited, deleted, or reopened. Drives the history view.
 */
export interface HistoryEntry {
  taskId: string;
  /** Board the task was completed on. Absent on pre-multi-board (legacy) entries. */
  boardId?: string;
  /** Title/description captured at completion time (a point-in-time snapshot). */
  title: string;
  description: string;
  /** Epoch milliseconds the task was completed. */
  completedAt: number;
}

export const CURRENT_VERSION = 3;

/** Default name given to a board created from scratch or by migration. */
export const DEFAULT_BOARD_NAME = "main";

export function newBoard(name: string = DEFAULT_BOARD_NAME): Board {
  return { id: randomUUID(), name, tasks: [] };
}

export function emptyState(): BoardState {
  const board = newBoard();
  return { version: CURRENT_VERSION, boards: [board], activeBoardId: board.id };
}
