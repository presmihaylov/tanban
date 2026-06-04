import { randomUUID } from "node:crypto";

import type { CliRenderer, KeyEvent } from "@opentui/core";

import {
  appendHistory,
  archiveExpired,
  loadHistory,
  removeBoardHistory,
  saveState,
} from "./storage.ts";
import { startOfDay, tasksByStatus, truncate } from "./tasks.ts";
import { COLUMNS } from "./theme.ts";
import { newBoard, type Board, type BoardState, type Status, type Task } from "./types.ts";
import { BoardView, type BoardSelection } from "./ui/board.ts";
import { ConfirmView } from "./ui/confirm.ts";
import { DetailView } from "./ui/detail.ts";
import { TaskForm } from "./ui/form.ts";
import { HelpView } from "./ui/help.ts";
import { HistoryView } from "./ui/history.ts";
import { PromptView } from "./ui/prompt.ts";

type Mode = "board" | "form" | "detail" | "confirm" | "help" | "history" | "prompt";
type ConfirmAction = "deleteTask" | "deleteBoard";
type PromptAction = "newBoard" | "renameBoard";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Re-check the archive window roughly every 5 min; only sweeps on day rollover. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const BOARD_HINTS =
  "a add · e edit · ⏎ view · d delete · ⇧+arrows/hjkl move · ⇥ board · b new · r rename · ⇧D del board · A history · ? help · q quit";

/**
 * Top-level controller: owns the board state, the current mode, and a single
 * global key handler that dispatches by mode. All mutations go through small
 * action methods that persist immediately, so state survives any exit path.
 */
export class KanbanApp {
  private readonly renderer: CliRenderer;
  private readonly board: BoardView;
  private state: BoardState;
  private mode: Mode = "board";
  private sel: BoardSelection = { col: 0, row: 0 };

  private form: TaskForm | null = null;
  private detail: DetailView | null = null;
  private help: HelpView | null = null;
  private history: HistoryView | null = null;
  private confirm: ConfirmView | null = null;
  private prompt: PromptView | null = null;

  private formMode: "add" | "edit" = "add";
  private formTaskId: string | null = null;
  private contextTaskId: string | null = null; // task targeted by detail / confirm
  private confirmAction: ConfirmAction = "deleteTask";
  private promptAction: PromptAction = "newBoard";

  private lastSweepDay: number;

  constructor(renderer: CliRenderer, state: BoardState) {
    this.renderer = renderer;
    this.state = state;
    this.board = new BoardView(renderer);
    this.normalizeSelection();

    renderer.keyInput.on("keypress", (key: KeyEvent) => this.onKey(key));
    renderer.on("resize", () => this.renderBoard());

    // Long-running sessions still prune old done tasks at each local-midnight
    // rollover (startup also sweeps once, in index.ts). Unref'd so it never
    // keeps the process — or the test runner — alive on its own.
    this.lastSweepDay = startOfDay();
    setInterval(() => this.maybeSweep(), SWEEP_INTERVAL_MS).unref?.();

    this.renderBoard();
  }

  private maybeSweep(): void {
    const today = startOfDay();
    if (today === this.lastSweepDay) return;
    this.lastSweepDay = today;
    if (!archiveExpired(this.state)) return;
    this.persist();
    this.normalizeSelection();
    if (this.mode === "board") this.renderBoard();
  }

  // ------------------------------------------------------------------- boards

  /** The board currently shown. Falls back to the first board if the id is stale. */
  private activeBoard(): Board {
    return this.state.boards.find((b) => b.id === this.state.activeBoardId) ?? this.state.boards[0]!;
  }

  /**
   * Board that owns legacy (pre-multi-board) history entries — the first board,
   * which is the one the old single task list migrated into.
   */
  private defaultBoardId(): string {
    return this.state.boards[0]!.id;
  }

  // ---------------------------------------------------------------- selection

  private columnStatus(col: number): Status {
    return COLUMNS[clamp(col, 0, COLUMNS.length - 1)]!.status;
  }

  private currentList(): Task[] {
    return tasksByStatus(this.activeBoard(), this.columnStatus(this.sel.col));
  }

  private selectedTask(): Task | undefined {
    const list = this.currentList();
    return list[clamp(this.sel.row, 0, Math.max(0, list.length - 1))];
  }

  private normalizeSelection(): void {
    this.sel.col = clamp(this.sel.col, 0, COLUMNS.length - 1);
    const len = this.currentList().length;
    this.sel.row = len === 0 ? 0 : clamp(this.sel.row, 0, len - 1);
  }

  private selectTask(id: string): void {
    const board = this.activeBoard();
    for (let c = 0; c < COLUMNS.length; c++) {
      const idx = tasksByStatus(board, this.columnStatus(c)).findIndex((t) => t.id === id);
      if (idx >= 0) {
        this.sel = { col: c, row: idx };
        return;
      }
    }
  }

  // ------------------------------------------------------------------- render

  private renderBoard(): void {
    this.normalizeSelection();
    const footer =
      this.mode === "board"
        ? truncate(BOARD_HINTS, Math.max(0, this.renderer.width - 2))
        : "";
    this.board.render(this.state.boards, this.state.activeBoardId, this.sel, footer);
  }

  private persist(): void {
    saveState(this.state);
  }

  // ------------------------------------------------------------- key dispatch

  private onKey(key: KeyEvent): void {
    switch (this.mode) {
      case "board":
        this.onBoardKey(key);
        break;
      case "form":
        this.onFormKey(key);
        break;
      case "detail":
        this.onDetailKey(key);
        break;
      case "confirm":
        this.onConfirmKey(key);
        break;
      case "help":
        if (this.isClose(key)) {
          key.preventDefault();
          this.closeHelp();
        }
        break;
      case "history":
        this.onHistoryKey(key);
        break;
      case "prompt":
        this.onPromptKey(key);
        break;
    }
  }

  private onHistoryKey(key: KeyEvent): void {
    if (!this.history) return;
    const n = key.name ?? "";
    if (this.isClose(key)) return this.handled(key, () => this.closeHistory());
    if (n === "tab") return this.handled(key, () => this.history?.cycleRange());
    if (n === "down" || n === "j") return this.handled(key, () => this.history?.scroll(1));
    if (n === "up" || n === "k") return this.handled(key, () => this.history?.scroll(-1));
  }

  private isClose(key: KeyEvent): boolean {
    return key.name === "escape" || key.name === "q" || key.name === "?";
  }

  private onBoardKey(key: KeyEvent): void {
    const n = key.name ?? "";
    const shift = key.shift;

    if (key.ctrl) return; // leave Ctrl combos (e.g. Ctrl+C) to the renderer

    // Switch boards (cycle). Tab forward, Shift+Tab back.
    if (n === "tab") return this.handled(key, () => this.cycleBoard(shift ? -1 : 1));

    // Move a task between columns (Shift + horizontal).
    if (shift && (n === "left" || n === "h")) return this.handled(key, () => this.moveAcross(-1));
    if (shift && (n === "right" || n === "l")) return this.handled(key, () => this.moveAcross(1));
    // Reorder a task within its column (Shift + vertical).
    if (shift && (n === "up" || n === "k")) return this.handled(key, () => this.reorder(-1));
    if (shift && (n === "down" || n === "j")) return this.handled(key, () => this.reorder(1));

    // Plain navigation.
    if (n === "left" || n === "h") return this.handled(key, () => this.moveColumn(-1));
    if (n === "right" || n === "l") return this.handled(key, () => this.moveColumn(1));
    if (n === "up" || n === "k") return this.handled(key, () => this.moveRow(-1));
    if (n === "down" || n === "j") return this.handled(key, () => this.moveRow(1));
    if (n === "g") return this.handled(key, () => this.jump(shift ? "end" : "home"));

    // Actions.
    if (n === "a" && shift) return this.handled(key, () => this.openHistory());
    if (n === "a" || n === "n") return this.handled(key, () => this.openForm("add"));
    if (n === "e") return this.handled(key, () => this.openForm("edit"));
    if (n === "return") return this.handled(key, () => this.openDetail());
    if (n === "d" && shift) return this.handled(key, () => this.openConfirmDeleteBoard());
    if (n === "d") return this.handled(key, () => this.openConfirmDelete());
    if (n === "b") return this.handled(key, () => this.openPrompt("newBoard"));
    if (n === "r") return this.handled(key, () => this.openPrompt("renameBoard"));
    if (n === "?") return this.handled(key, () => this.openHelp());
    if (n === "q") return this.handled(key, () => this.quit());
  }

  private handled(key: KeyEvent, action: () => void): void {
    key.preventDefault();
    action();
  }

  // ------------------------------------------------------------ board actions

  /** Cycle to the next/previous board, wrapping around. */
  private cycleBoard(delta: number): void {
    const boards = this.state.boards;
    if (boards.length <= 1) return;
    const idx = boards.findIndex((b) => b.id === this.state.activeBoardId);
    const next = (idx + delta + boards.length) % boards.length;
    this.state.activeBoardId = boards[next]!.id;
    this.sel = { col: this.sel.col, row: 0 };
    this.persist();
    this.normalizeSelection();
    this.renderBoard();
  }

  private moveColumn(delta: number): void {
    this.sel.col = clamp(this.sel.col + delta, 0, COLUMNS.length - 1);
    this.normalizeSelection();
    this.renderBoard();
  }

  private moveRow(delta: number): void {
    const len = this.currentList().length;
    if (len === 0) return;
    this.sel.row = clamp(this.sel.row + delta, 0, len - 1);
    this.renderBoard();
  }

  private jump(where: "home" | "end"): void {
    const len = this.currentList().length;
    if (len === 0) return;
    this.sel.row = where === "home" ? 0 : len - 1;
    this.renderBoard();
  }

  private applyStatus(task: Task, status: Status): void {
    const now = Date.now();
    const was = task.status;
    task.status = status;
    task.updatedAt = now;
    if (status === "done" && was !== "done") {
      task.completedAt = now;
      this.recordCompletion(task);
    }
    if (status !== "done") delete task.completedAt;
  }

  /** Append a durable completion record so it survives pruning/edits/deletes. */
  private recordCompletion(task: Task): void {
    appendHistory({
      taskId: task.id,
      boardId: this.activeBoard().id,
      title: task.title,
      description: task.description,
      completedAt: task.completedAt ?? Date.now(),
    });
  }

  private moveAcross(delta: number): void {
    const task = this.selectedTask();
    if (!task) return;
    const target = clamp(this.sel.col + delta, 0, COLUMNS.length - 1);
    if (target === this.sel.col) return;
    this.applyStatus(task, this.columnStatus(target));
    this.persist();
    this.selectTask(task.id);
    this.renderBoard();
  }

  private reorder(delta: number): void {
    const task = this.selectedTask();
    if (!task) return;
    const status = task.status;
    const tasks = this.activeBoard().tasks;
    // Indices into the board's tasks of every task sharing this column, in order.
    const indices: number[] = [];
    tasks.forEach((t, i) => {
      if (t.status === status) indices.push(i);
    });
    const pos = indices.findIndex((i) => tasks[i]!.id === task.id);
    const targetPos = pos + delta;
    if (targetPos < 0 || targetPos >= indices.length) return;

    const a = indices[pos]!;
    const b = indices[targetPos]!;
    const ta = tasks[a]!;
    const tb = tasks[b]!;
    tasks[a] = tb;
    tasks[b] = ta;

    this.sel.row = targetPos;
    this.persist();
    this.renderBoard();
  }

  // -------------------------------------------------------------------- form

  private openForm(formMode: "add" | "edit"): void {
    if (formMode === "edit") {
      const task = this.selectedTask();
      if (!task) return;
      this.formTaskId = task.id;
      this.form = new TaskForm(this.renderer, {
        heading: " Edit Task ",
        title: task.title,
        description: task.description,
      });
    } else {
      this.formTaskId = null;
      this.form = new TaskForm(this.renderer, {
        heading: " New Task ",
        title: "",
        description: "",
      });
    }
    this.formMode = formMode;
    this.mode = "form";
  }

  private onFormKey(key: KeyEvent): void {
    if (!this.form) return;
    const n = key.name ?? "";

    if (n === "escape") return this.handled(key, () => this.closeForm());
    if (n === "tab") return this.handled(key, () => this.form?.toggleField());
    if (key.ctrl && n === "s") return this.handled(key, () => this.submitForm());
    if (n === "return") {
      // Shift+Enter inserts a newline in the description; plain Enter saves
      // the task from whichever field is focused.
      if (key.shift && this.form.currentField === "desc") {
        return this.handled(key, () => this.form?.insertDescriptionNewline());
      }
      return this.handled(key, () => this.submitForm());
    }
    // Anything else flows through to the focused input / textarea.
  }

  private submitForm(): void {
    if (!this.form) return;
    const { title, description } = this.form.values();
    if (title.length === 0) {
      this.form.setError("Title is required");
      this.form.setField("title");
      return;
    }

    const board = this.activeBoard();
    if (this.formMode === "edit" && this.formTaskId) {
      const task = board.tasks.find((t) => t.id === this.formTaskId);
      if (task) {
        task.title = title;
        task.description = description;
        task.updatedAt = Date.now();
      }
    } else {
      const now = Date.now();
      const status = this.columnStatus(this.sel.col);
      const task: Task = {
        id: randomUUID(),
        title,
        description,
        status,
        createdAt: now,
        updatedAt: now,
      };
      if (status === "done") {
        task.completedAt = now;
        this.recordCompletion(task);
      }
      board.tasks.push(task);
      this.selectTask(task.id);
    }

    this.persist();
    this.closeForm();
  }

  private closeForm(): void {
    this.form?.destroy();
    this.form = null;
    this.formTaskId = null;
    this.mode = "board";
    this.renderBoard();
  }

  // ------------------------------------------------------------------ detail

  private openDetail(): void {
    const task = this.selectedTask();
    if (!task) return;
    this.contextTaskId = task.id;
    this.detail = new DetailView(this.renderer, task);
    this.mode = "detail";
  }

  private onDetailKey(key: KeyEvent): void {
    const n = key.name ?? "";
    if (n === "escape" || n === "return" || n === "q") {
      return this.handled(key, () => this.closeDetail());
    }
    if (n === "e") {
      return this.handled(key, () => {
        this.closeDetail();
        this.openForm("edit");
      });
    }
    if (n === "d") {
      return this.handled(key, () => {
        this.closeDetail();
        this.openConfirmDelete();
      });
    }
  }

  private closeDetail(): void {
    this.detail?.destroy();
    this.detail = null;
    this.mode = "board";
    this.renderBoard();
  }

  // ----------------------------------------------------------------- confirm

  private openConfirmDelete(): void {
    const task = this.selectedTask();
    if (!task) return;
    this.contextTaskId = task.id;
    this.confirmAction = "deleteTask";
    this.confirm = new ConfirmView(this.renderer, {
      message: "Delete this task?",
      detail: task.title,
    });
    this.mode = "confirm";
  }

  private openConfirmDeleteBoard(): void {
    // The last board can't be deleted — there's always at least one.
    if (this.state.boards.length <= 1) {
      this.board.setFooter(
        truncate("Can't delete the last board.", Math.max(0, this.renderer.width - 2)),
      );
      return;
    }
    const board = this.activeBoard();
    const count = board.tasks.length;
    this.confirmAction = "deleteBoard";
    this.confirm = new ConfirmView(this.renderer, {
      message: `Delete board “${board.name}”?`,
      detail: count > 0 ? `${count} task${count === 1 ? "" : "s"} will be removed` : "It's empty",
    });
    this.mode = "confirm";
  }

  private onConfirmKey(key: KeyEvent): void {
    const n = key.name ?? "";
    if (n === "y") return this.handled(key, () => this.performConfirm());
    if (n === "n" || n === "escape") return this.handled(key, () => this.closeConfirm());
  }

  private performConfirm(): void {
    if (this.confirmAction === "deleteBoard") return this.performDeleteBoard();
    this.performDelete();
  }

  private performDelete(): void {
    if (this.contextTaskId) {
      const board = this.activeBoard();
      board.tasks = board.tasks.filter((t) => t.id !== this.contextTaskId);
      this.persist();
    }
    this.closeConfirm();
  }

  private performDeleteBoard(): void {
    const boards = this.state.boards;
    if (boards.length <= 1) return this.closeConfirm();
    const removedId = this.activeBoard().id;
    const defaultId = this.defaultBoardId();
    const idx = boards.findIndex((b) => b.id === removedId);

    this.state.boards = boards.filter((b) => b.id !== removedId);
    // Land on the neighbour that takes the removed board's slot (or the new last).
    const nextIdx = clamp(idx, 0, this.state.boards.length - 1);
    this.state.activeBoardId = this.state.boards[nextIdx]!.id;
    this.sel = { col: 0, row: 0 };

    removeBoardHistory(removedId, defaultId);
    this.persist();
    this.closeConfirm();
  }

  private closeConfirm(): void {
    this.confirm?.destroy();
    this.confirm = null;
    this.contextTaskId = null;
    this.mode = "board";
    this.renderBoard();
  }

  // -------------------------------------------------------------- help/archive

  private openHelp(): void {
    this.help = new HelpView(this.renderer);
    this.mode = "help";
  }

  private closeHelp(): void {
    this.help?.destroy();
    this.help = null;
    this.mode = "board";
    this.renderBoard();
  }

  private openHistory(): void {
    const board = this.activeBoard();
    const defaultId = this.defaultBoardId();
    const boardDone = board.tasks.filter((t) => t.status === "done");
    // Scope the durable log to this board; legacy entries belong to the first board.
    const log = loadHistory().filter((e) => (e.boardId ?? defaultId) === board.id);
    this.history = new HistoryView(this.renderer, boardDone, log);
    this.mode = "history";
  }

  private closeHistory(): void {
    this.history?.destroy();
    this.history = null;
    this.mode = "board";
    this.renderBoard();
  }

  // ------------------------------------------------------------------ prompt

  private openPrompt(action: PromptAction): void {
    this.promptAction = action;
    const newBoardPrompt = action === "newBoard";
    this.prompt = new PromptView(this.renderer, {
      heading: newBoardPrompt ? " New Board " : " Rename Board ",
      value: newBoardPrompt ? "" : this.activeBoard().name,
      placeholder: "Board name (e.g. work, side)",
    });
    this.mode = "prompt";
  }

  private onPromptKey(key: KeyEvent): void {
    if (!this.prompt) return;
    const n = key.name ?? "";
    if (n === "escape") return this.handled(key, () => this.closePrompt());
    if (n === "return") return this.handled(key, () => this.submitPrompt());
    // Anything else flows through to the focused input.
  }

  private submitPrompt(): void {
    if (!this.prompt) return;
    const name = this.prompt.value();
    if (name.length === 0) {
      this.prompt.setError("Name is required");
      return;
    }

    if (this.promptAction === "newBoard") {
      const board = newBoard(name);
      this.state.boards.push(board);
      this.state.activeBoardId = board.id;
      this.sel = { col: 0, row: 0 };
    } else {
      this.activeBoard().name = name;
    }

    this.persist();
    this.closePrompt();
  }

  private closePrompt(): void {
    this.prompt?.destroy();
    this.prompt = null;
    this.mode = "board";
    this.renderBoard();
  }

  // -------------------------------------------------------------------- quit

  private quit(): void {
    this.persist();
    this.renderer.destroy();
    process.exit(0);
  }
}
