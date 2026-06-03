import { describe, expect, test } from "bun:test";

import { buildHistory, dayLabel, startOfDay, type HistoryRange } from "../src/tasks.ts";
import type { HistoryEntry, Task } from "../src/types.ts";

// Local-time constructors so range boundaries match the code under test.
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m, d, h, min, 0, 0).getTime();

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  taskId: "x",
  title: "t",
  description: "",
  completedAt: 0,
  ...over,
});

// Wed 17 Jun 2026, 15:00 local. Week (Mon-start) = 15 Jun; month = 1 Jun.
const now = at(2026, 5, 17, 15, 0);
const todayE = entry({ taskId: "today", completedAt: at(2026, 5, 17, 9, 0) });
const weekE = entry({ taskId: "week", completedAt: at(2026, 5, 15, 10, 0) });
const monthE = entry({ taskId: "month", completedAt: at(2026, 5, 5, 10, 0) });
const oldE = entry({ taskId: "old", completedAt: at(2026, 3, 20, 10, 0) });

const totalFor = (range: HistoryRange) =>
  buildHistory([], [todayE, weekE, monthE, oldE], range, now).total;

describe("buildHistory ranges", () => {
  test("today / week / month / all widen as expected", () => {
    expect(totalFor("today")).toBe(1);
    expect(totalFor("week")).toBe(2);
    expect(totalFor("month")).toBe(3);
    expect(totalFor("all")).toBe(4);
  });
});

describe("buildHistory merge + grouping", () => {
  test("dedupes by task id, keeping the latest completion", () => {
    const log = [
      entry({ taskId: "a", title: "old title", completedAt: at(2026, 5, 17, 8, 0) }),
      entry({ taskId: "a", title: "new title", completedAt: at(2026, 5, 17, 11, 0) }),
    ];
    const { days, total } = buildHistory([], log, "today", now);
    expect(total).toBe(1);
    expect(days[0]!.entries[0]!.title).toBe("new title");
  });

  test("unions board-done tasks with the log", () => {
    const boardDone: Task[] = [
      {
        id: "b",
        title: "done on board",
        description: "",
        status: "done",
        createdAt: 1,
        updatedAt: at(2026, 5, 17, 13, 0),
        completedAt: at(2026, 5, 17, 13, 0),
      },
    ];
    const { total } = buildHistory(boardDone, [todayE], "today", now);
    expect(total).toBe(2);
  });

  test("groups by day, newest first", () => {
    const { days } = buildHistory([], [todayE, weekE, monthE], "month", now);
    expect(days.map((d) => d.label)[0]).toBe("Today");
    expect(days[0]!.dayStart).toBe(startOfDay(now));
    // Strictly descending day buckets.
    const starts = days.map((d) => d.dayStart);
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });
});

describe("dayLabel", () => {
  test("labels today and yesterday", () => {
    expect(dayLabel(startOfDay(now), now)).toBe("Today");
    expect(dayLabel(startOfDay(at(2026, 5, 16, 12, 0)), now)).toBe("Yesterday");
  });
});
