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
  /** Done tasks older than the archive window, moved out of the board. */
  archived: Task[];
}

export const CURRENT_VERSION = 1;

export function emptyState(): BoardState {
  return { version: CURRENT_VERSION, tasks: [], archived: [] };
}
