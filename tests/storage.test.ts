import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendHistory,
  ARCHIVE_AFTER_MS,
  archiveExpired,
  loadHistory,
  loadState,
  migrateLegacyArchive,
  removeBoardHistory,
  saveState,
} from "../src/storage.ts";
import { CURRENT_VERSION, emptyState, type HistoryEntry, type Task } from "../src/types.ts";

let dir: string;
let file: string;
let historyFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tanban-test-"));
  file = join(dir, "state.json");
  historyFile = join(dir, "history.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const mkTask = (over: Partial<Task> = {}): Task => ({
  id: crypto.randomUUID(),
  title: "task",
  description: "",
  status: "todo",
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

describe("persistence", () => {
  test("round-trips state through disk", () => {
    const state = emptyState();
    state.boards[0]!.tasks.push(
      mkTask({ title: "hello", description: "world", status: "in_progress" }),
    );
    saveState(state, file);

    expect(existsSync(file)).toBe(true);
    const loaded = loadState(file);
    expect(loaded.version).toBe(CURRENT_VERSION);
    expect(loaded.boards).toHaveLength(1);
    expect(loaded.activeBoardId).toBe(loaded.boards[0]!.id);
    expect(loaded.boards[0]!.tasks).toHaveLength(1);
    expect(loaded.boards[0]!.tasks[0]!.title).toBe("hello");
    expect(loaded.boards[0]!.tasks[0]!.status).toBe("in_progress");
  });

  test("round-trips multiple boards and the active selection", () => {
    const state = emptyState();
    state.boards[0]!.name = "work";
    state.boards.push({ id: "side-id", name: "side", tasks: [mkTask({ title: "fun" })] });
    state.activeBoardId = "side-id";
    saveState(state, file);

    const loaded = loadState(file);
    expect(loaded.boards.map((b) => b.name)).toEqual(["work", "side"]);
    expect(loaded.activeBoardId).toBe("side-id");
    expect(loaded.boards[1]!.tasks[0]!.title).toBe("fun");
  });

  test("returns a single empty board when the file is missing", () => {
    const loaded = loadState(file);
    expect(loaded.boards).toHaveLength(1);
    expect(loaded.boards[0]!.tasks).toHaveLength(0);
    expect(loaded.activeBoardId).toBe(loaded.boards[0]!.id);
  });

  test("recovers from a corrupt file instead of throwing", () => {
    saveState(emptyState(), file);
    Bun.write(file, "{ not valid json ");
    const loaded = loadState(file);
    expect(loaded.boards).toHaveLength(1);
    expect(loaded.boards[0]!.tasks).toHaveLength(0);
  });

  test("falls back to the first board when activeBoardId is stale", () => {
    Bun.write(
      file,
      JSON.stringify({
        version: CURRENT_VERSION,
        boards: [{ id: "a", name: "a", tasks: [] }],
        activeBoardId: "gone",
      }),
    );
    expect(loadState(file).activeBoardId).toBe("a");
  });

  describe("v2 → v3 migration", () => {
    test("wraps a flat task list into one default board", () => {
      Bun.write(
        file,
        JSON.stringify({
          version: 2,
          tasks: [
            { id: "1", title: "ok", status: "todo", description: "", createdAt: 1, updatedAt: 1 },
          ],
        }),
      );
      const loaded = loadState(file);
      expect(loaded.version).toBe(CURRENT_VERSION);
      expect(loaded.boards).toHaveLength(1);
      expect(loaded.boards[0]!.name).toBe("main");
      expect(loaded.boards[0]!.tasks[0]!.title).toBe("ok");
      expect(loaded.activeBoardId).toBe(loaded.boards[0]!.id);
    });

    test("drops malformed tasks but keeps valid ones", () => {
      Bun.write(
        file,
        JSON.stringify({
          tasks: [
            { id: "1", title: "ok", status: "todo", description: "", createdAt: 1, updatedAt: 1 },
            { id: "2", status: "todo" }, // missing title
            { id: "3", title: "bad-status", status: "nope" },
          ],
        }),
      );
      const loaded = loadState(file);
      expect(loaded.boards[0]!.tasks).toHaveLength(1);
      expect(loaded.boards[0]!.tasks[0]!.id).toBe("1");
    });
  });
});

describe("archiving (board prune)", () => {
  const now = 10 * ARCHIVE_AFTER_MS;

  test("prunes done tasks older than the window off the board", () => {
    const state = emptyState();
    const old = mkTask({ status: "done", completedAt: now - ARCHIVE_AFTER_MS - 1 });
    const recent = mkTask({ status: "done", completedAt: now - 1000 });
    const todo = mkTask({ status: "todo" });
    state.boards[0]!.tasks.push(old, recent, todo);

    const changed = archiveExpired(state, now);
    expect(changed).toBe(true);
    expect(state.boards[0]!.tasks.map((t) => t.id).sort()).toEqual([recent.id, todo.id].sort());
  });

  test("prunes across every board", () => {
    const state = emptyState();
    state.boards.push({ id: "b2", name: "side", tasks: [] });
    state.boards[0]!.tasks.push(mkTask({ status: "done", completedAt: now - ARCHIVE_AFTER_MS - 1 }));
    state.boards[1]!.tasks.push(mkTask({ status: "done", completedAt: now - ARCHIVE_AFTER_MS - 1 }));

    expect(archiveExpired(state, now)).toBe(true);
    expect(state.boards[0]!.tasks).toHaveLength(0);
    expect(state.boards[1]!.tasks).toHaveLength(0);
  });

  test("does nothing when no done task is old enough", () => {
    const state = emptyState();
    state.boards[0]!.tasks.push(mkTask({ status: "done", completedAt: now - 1000 }), mkTask());
    expect(archiveExpired(state, now)).toBe(false);
    expect(state.boards[0]!.tasks).toHaveLength(2);
  });

  test("never prunes non-done tasks even if ancient", () => {
    const state = emptyState();
    state.boards[0]!.tasks.push(mkTask({ status: "blocked", updatedAt: 0 }));
    expect(archiveExpired(state, now)).toBe(false);
    expect(state.boards[0]!.tasks).toHaveLength(1);
  });
});

describe("history log", () => {
  const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
    taskId: crypto.randomUUID(),
    title: "done thing",
    description: "",
    completedAt: 5000,
    ...over,
  });

  test("appends and reads back records in order", () => {
    appendHistory(entry({ title: "first", completedAt: 1 }), historyFile);
    appendHistory(entry({ title: "second", completedAt: 2 }), historyFile);
    const log = loadHistory(historyFile);
    expect(log.map((e) => e.title)).toEqual(["first", "second"]);
  });

  test("preserves the boardId round-trip", () => {
    appendHistory(entry({ title: "x", boardId: "board-1" }), historyFile);
    expect(loadHistory(historyFile)[0]!.boardId).toBe("board-1");
  });

  test("returns empty when the log is missing", () => {
    expect(loadHistory(historyFile)).toEqual([]);
  });

  test("skips torn/malformed lines but keeps valid ones", () => {
    appendHistory(entry({ title: "good" }), historyFile);
    Bun.write(historyFile, `${'{"taskId":"x","title":"good","description":"","completedAt":5000}'}\n{ broken json\n`);
    const log = loadHistory(historyFile);
    expect(log).toHaveLength(1);
    expect(log[0]!.title).toBe("good");
  });

  test("removeBoardHistory drops a board's entries and keeps the rest", () => {
    appendHistory(entry({ taskId: "a", boardId: "keep" }), historyFile);
    appendHistory(entry({ taskId: "b", boardId: "drop" }), historyFile);
    appendHistory(entry({ taskId: "c" }), historyFile); // legacy: no boardId

    // Default board id is "keep", so the legacy entry stays.
    removeBoardHistory("drop", "keep", historyFile);
    expect(loadHistory(historyFile).map((e) => e.taskId).sort()).toEqual(["a", "c"]);
  });

  test("removeBoardHistory clears legacy entries when the default board is deleted", () => {
    appendHistory(entry({ taskId: "a", boardId: "other" }), historyFile);
    appendHistory(entry({ taskId: "c" }), historyFile); // legacy

    // Deleting the default board ("def") removes the legacy entry attributed to it.
    removeBoardHistory("def", "def", historyFile);
    expect(loadHistory(historyFile).map((e) => e.taskId)).toEqual(["a"]);
  });

  test("migrates the v1 archive and done tasks into the log, once", () => {
    Bun.write(
      file,
      JSON.stringify({
        version: 1,
        tasks: [
          { id: "d", title: "done on board", status: "done", description: "", createdAt: 1, updatedAt: 9, completedAt: 9 },
          { id: "t", title: "still todo", status: "todo", description: "", createdAt: 1, updatedAt: 1 },
        ],
        archived: [
          { id: "a", title: "old archived", status: "done", description: "", createdAt: 1, updatedAt: 2, completedAt: 2 },
        ],
      }),
    );

    migrateLegacyArchive(file, historyFile);
    const log = loadHistory(historyFile);
    expect(log.map((e) => e.taskId).sort()).toEqual(["a", "d"]);

    // Idempotent: a second run sees the log exists and does nothing.
    migrateLegacyArchive(file, historyFile);
    expect(loadHistory(historyFile)).toHaveLength(2);
  });
});
