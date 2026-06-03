import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARCHIVE_AFTER_MS, archiveExpired, loadState, saveState } from "../src/storage.ts";
import { CURRENT_VERSION, emptyState, type Task } from "../src/types.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tanban-test-"));
  file = join(dir, "state.json");
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
    expect(loaded.archived).toHaveLength(0);
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

describe("archiving", () => {
  const now = 10 * ARCHIVE_AFTER_MS;

  test("archives done tasks older than the window", () => {
    const state = emptyState();
    const old = mkTask({ status: "done", completedAt: now - ARCHIVE_AFTER_MS - 1 });
    const recent = mkTask({ status: "done", completedAt: now - 1000 });
    const todo = mkTask({ status: "todo" });
    state.tasks.push(old, recent, todo);

    const changed = archiveExpired(state, now);
    expect(changed).toBe(true);
    expect(state.tasks.map((t) => t.id).sort()).toEqual([recent.id, todo.id].sort());
    expect(state.archived).toHaveLength(1);
    expect(state.archived[0]!.id).toBe(old.id);
  });

  test("does nothing when no done task is old enough", () => {
    const state = emptyState();
    state.tasks.push(mkTask({ status: "done", completedAt: now - 1000 }), mkTask());
    expect(archiveExpired(state, now)).toBe(false);
    expect(state.archived).toHaveLength(0);
  });

  test("never archives non-done tasks even if ancient", () => {
    const state = emptyState();
    state.tasks.push(mkTask({ status: "blocked", updatedAt: 0 }));
    expect(archiveExpired(state, now)).toBe(false);
    expect(state.tasks).toHaveLength(1);
  });
});
