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
    state.tasks.push(mkTask({ title: "hello", description: "world", status: "in_progress" }));
    saveState(state, file);

    expect(existsSync(file)).toBe(true);
    const loaded = loadState(file);
    expect(loaded.version).toBe(CURRENT_VERSION);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]!.title).toBe("hello");
    expect(loaded.tasks[0]!.status).toBe("in_progress");
  });

  test("returns an empty board when the file is missing", () => {
    const loaded = loadState(file);
    expect(loaded.tasks).toHaveLength(0);
  });

  test("recovers from a corrupt file instead of throwing", () => {
    saveState(emptyState(), file);
    Bun.write(file, "{ not valid json ");
    const loaded = loadState(file);
    expect(loaded.tasks).toHaveLength(0);
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
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]!.id).toBe("1");
  });
});

describe("archiving (board prune)", () => {
  const now = 10 * ARCHIVE_AFTER_MS;

  test("prunes done tasks older than the window off the board", () => {
    const state = emptyState();
    const old = mkTask({ status: "done", completedAt: now - ARCHIVE_AFTER_MS - 1 });
    const recent = mkTask({ status: "done", completedAt: now - 1000 });
    const todo = mkTask({ status: "todo" });
    state.tasks.push(old, recent, todo);

    const changed = archiveExpired(state, now);
    expect(changed).toBe(true);
    expect(state.tasks.map((t) => t.id).sort()).toEqual([recent.id, todo.id].sort());
  });

  test("does nothing when no done task is old enough", () => {
    const state = emptyState();
    state.tasks.push(mkTask({ status: "done", completedAt: now - 1000 }), mkTask());
    expect(archiveExpired(state, now)).toBe(false);
    expect(state.tasks).toHaveLength(2);
  });

  test("never prunes non-done tasks even if ancient", () => {
    const state = emptyState();
    state.tasks.push(mkTask({ status: "blocked", updatedAt: 0 }));
    expect(archiveExpired(state, now)).toBe(false);
    expect(state.tasks).toHaveLength(1);
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
