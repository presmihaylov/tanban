import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KanbanApp } from "../src/app.ts";
import { loadState } from "../src/storage.ts";
import { emptyState, newBoard, type BoardState } from "../src/types.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tanban-app-"));
  // Redirect persistence away from the real ~/.config for the duration.
  process.env.TANBAN_STATE_FILE = join(dir, "state.json");
});

afterEach(() => {
  delete process.env.TANBAN_STATE_FILE;
  rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tasks on the currently-active board. */
const tasks = (state: BoardState) =>
  state.boards.find((b) => b.id === state.activeBoardId)!.tasks;

async function setup(
  state: BoardState = emptyState(),
  rendererOpts: { kittyKeyboard?: boolean } = {},
) {
  const harness = await createTestRenderer({ width: 120, height: 32, ...rendererOpts });
  new KanbanApp(harness.renderer, state);
  await harness.flush();
  return { ...harness, state };
}

test("renders the four columns and the active board name", async () => {
  const state = emptyState();
  state.boards[0]!.name = "work";
  const { captureCharFrame, flush } = await setup(state);
  await flush();
  const frame = captureCharFrame();
  expect(frame).toContain("work");
  expect(frame).toContain("TODO");
  expect(frame).toContain("IN PROGRESS");
  expect(frame).toContain("IN REVIEW");
  expect(frame).toContain("DONE");
});

test("adds a task through the form and shows it on the board", async () => {
  const { mockInput, flush, captureCharFrame, state } = await setup();

  mockInput.pressKey("a"); // open the new-task form
  await flush();
  await mockInput.typeText("Ship the thing");
  mockInput.pressKey("s", { ctrl: true }); // save
  await flush();

  expect(tasks(state)).toHaveLength(1);
  expect(tasks(state)[0]!.title).toBe("Ship the thing");
  expect(tasks(state)[0]!.status).toBe("todo");
  expect(captureCharFrame()).toContain("Ship the thing");

  // And it was persisted to the redirected state file.
  const reloaded = loadState();
  expect(tasks(reloaded)).toHaveLength(1);
  expect(tasks(reloaded)[0]!.title).toBe("Ship the thing");
});

test("Enter saves the task from the title field", async () => {
  const { mockInput, flush, state } = await setup();
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("Quick task");
  mockInput.pressEnter(); // save with Enter
  await flush();
  expect(tasks(state)).toHaveLength(1);
  expect(tasks(state)[0]!.title).toBe("Quick task");
});

test("Enter saves the task from the description field too", async () => {
  const { mockInput, flush, state } = await setup();
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("Has a body");
  mockInput.pressTab(); // jump to the description field
  await flush();
  await mockInput.typeText("some details");
  mockInput.pressEnter(); // plain Enter still saves
  await flush();
  expect(tasks(state)).toHaveLength(1);
  expect(tasks(state)[0]!.title).toBe("Has a body");
  expect(tasks(state)[0]!.description).toBe("some details");
});

test("Shift+Enter inserts a newline in the description instead of saving", async () => {
  const { mockInput, flush, state } = await setup(emptyState(), { kittyKeyboard: true });
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("Multi");
  mockInput.pressTab();
  await flush();
  await mockInput.typeText("line one");
  mockInput.pressEnter({ shift: true }); // newline, not save
  await flush();
  await mockInput.typeText("line two");
  expect(tasks(state)).toHaveLength(0); // nothing saved yet
  mockInput.pressEnter(); // now save
  await flush();
  expect(tasks(state)).toHaveLength(1);
  expect(tasks(state)[0]!.description).toBe("line one\nline two");
});

test("empty title is rejected", async () => {
  const { mockInput, flush, state } = await setup();
  mockInput.pressKey("a");
  await flush();
  mockInput.pressKey("s", { ctrl: true }); // try to save with no title
  await flush();
  expect(tasks(state)).toHaveLength(0);
});

test("moves a task across columns and stamps completion", async () => {
  const state = emptyState();
  state.boards[0]!.tasks.push({
    id: "t1",
    title: "Move me",
    description: "",
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
  });
  const { mockInput, flush } = await setup(state);

  // Shift+L moves the task one column to the right each press: todo -> ... -> done.
  mockInput.pressKey("l", { shift: true });
  mockInput.pressKey("l", { shift: true });
  mockInput.pressKey("l", { shift: true });
  await flush();

  expect(tasks(state)[0]!.status).toBe("done");
  expect(typeof tasks(state)[0]!.completedAt).toBe("number");

  // Move it back out of done; completion stamp should clear.
  mockInput.pressKey("h", { shift: true });
  await flush();
  expect(tasks(state)[0]!.status).toBe("blocked");
  expect(tasks(state)[0]!.completedAt).toBeUndefined();
});

test("Esc cancels the form without creating a task", async () => {
  const { mockInput, flush, captureCharFrame, state } = await setup();
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("never saved");
  expect(captureCharFrame()).toContain("New Task");

  mockInput.pressEscape();
  await sleep(80); // give the stdin parser its escape-disambiguation window
  await flush();

  expect(captureCharFrame()).not.toContain("New Task");
  expect(tasks(state)).toHaveLength(0);
});

test("deletes a task after confirmation", async () => {
  const state = emptyState();
  state.boards[0]!.tasks.push({
    id: "t1",
    title: "Delete me",
    description: "",
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
  });
  const { mockInput, flush } = await setup(state);
  mockInput.pressKey("d"); // open confirm
  await flush();
  mockInput.pressKey("y"); // confirm
  await flush();
  expect(tasks(state)).toHaveLength(0);
});

// ----------------------------------------------------------------- boards

const twoBoardState = (): BoardState => {
  const state = emptyState();
  state.boards[0]!.name = "work";
  const side = newBoard("side");
  state.boards.push(side);
  return state;
};

test("Tab cycles to the next board and wraps around", async () => {
  const state = twoBoardState();
  const [work, side] = state.boards;
  const { mockInput, flush } = await setup(state);

  mockInput.pressTab();
  await flush();
  expect(state.activeBoardId).toBe(side!.id);

  mockInput.pressTab(); // wraps back to the first board
  await flush();
  expect(state.activeBoardId).toBe(work!.id);
});

test("Shift+Tab cycles to the previous board", async () => {
  const state = twoBoardState();
  const [work, side] = state.boards;
  const { mockInput, flush } = await setup(state, { kittyKeyboard: true });

  mockInput.pressTab({ shift: true });
  await flush();
  expect(state.activeBoardId).toBe(side!.id);
});

test("creates a new board, switches to it, and isolates its tasks", async () => {
  const { mockInput, flush, captureCharFrame, state } = await setup();

  // A task on the original board.
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("WorkItem");
  mockInput.pressEnter();
  await flush();

  // New board "side" — becomes active and starts empty.
  mockInput.pressKey("b");
  await flush();
  expect(captureCharFrame()).toContain("New Board");
  await mockInput.typeText("side");
  mockInput.pressEnter();
  await flush();

  expect(state.boards).toHaveLength(2);
  expect(state.boards[1]!.name).toBe("side");
  expect(state.activeBoardId).toBe(state.boards[1]!.id);
  expect(tasks(state)).toHaveLength(0);
  expect(captureCharFrame()).not.toContain("WorkItem");

  // Add a task on the side board, then cycle back: each board keeps its own.
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("SideItem");
  mockInput.pressEnter();
  await flush();

  mockInput.pressTab(); // back to the first board
  await flush();
  const frame = captureCharFrame();
  expect(frame).toContain("WorkItem");
  expect(frame).not.toContain("SideItem");
});

test("renames the active board", async () => {
  const state = emptyState();
  state.boards[0]!.name = "main";
  const { mockInput, flush, captureCharFrame } = await setup(state);

  mockInput.pressKey("r");
  await flush();
  expect(captureCharFrame()).toContain("Rename Board");
  await mockInput.typeText("-renamed"); // appends to the prefilled value
  mockInput.pressEnter();
  await flush();
  expect(state.boards[0]!.name).toBe("main-renamed");
});

test("deletes the active board after confirmation and lands on a neighbour", async () => {
  const state = twoBoardState();
  state.activeBoardId = state.boards[1]!.id; // start on "side"
  const sideId = state.boards[1]!.id;
  const workId = state.boards[0]!.id;
  const { mockInput, flush, captureCharFrame } = await setup(state);

  mockInput.pressKey("d", { shift: true }); // delete-board confirm
  await flush();
  expect(captureCharFrame()).toContain("Delete board");
  mockInput.pressKey("y");
  await flush();

  expect(state.boards.map((b) => b.id)).toEqual([workId]);
  expect(state.activeBoardId).toBe(workId);
  expect(state.boards.some((b) => b.id === sideId)).toBe(false);
});

test("refuses to delete the last remaining board", async () => {
  const { mockInput, flush, state } = await setup();
  expect(state.boards).toHaveLength(1);
  mockInput.pressKey("d", { shift: true });
  await flush();
  expect(state.boards).toHaveLength(1); // still there, no confirm fired
});
