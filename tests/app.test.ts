import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KanbanApp } from "../src/app.ts";
import { loadState } from "../src/storage.ts";
import { emptyState, type BoardState } from "../src/types.ts";

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

async function setup(
  state: BoardState = emptyState(),
  rendererOpts: { kittyKeyboard?: boolean } = {},
) {
  const harness = await createTestRenderer({ width: 120, height: 32, ...rendererOpts });
  new KanbanApp(harness.renderer, state);
  await harness.flush();
  return { ...harness, state };
}

test("renders the four columns and the header", async () => {
  const { captureCharFrame, flush } = await setup();
  await flush();
  const frame = captureCharFrame();
  expect(frame).toContain("TANBAN");
  expect(frame).toContain("TODO");
  expect(frame).toContain("IN PROGRESS");
  expect(frame).toContain("BLOCKED");
  expect(frame).toContain("DONE");
});

test("adds a task through the form and shows it on the board", async () => {
  const { mockInput, flush, captureCharFrame, state } = await setup();

  mockInput.pressKey("a"); // open the new-task form
  await flush();
  await mockInput.typeText("Ship the thing");
  mockInput.pressKey("s", { ctrl: true }); // save
  await flush();

  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]!.title).toBe("Ship the thing");
  expect(state.tasks[0]!.status).toBe("todo");
  expect(captureCharFrame()).toContain("Ship the thing");

  // And it was persisted to the redirected state file.
  const reloaded = loadState();
  expect(reloaded.tasks).toHaveLength(1);
  expect(reloaded.tasks[0]!.title).toBe("Ship the thing");
});

test("Enter saves the task from the title field", async () => {
  const { mockInput, flush, state } = await setup();
  mockInput.pressKey("a");
  await flush();
  await mockInput.typeText("Quick task");
  mockInput.pressEnter(); // save with Enter
  await flush();
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]!.title).toBe("Quick task");
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
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]!.title).toBe("Has a body");
  expect(state.tasks[0]!.description).toBe("some details");
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
  expect(state.tasks).toHaveLength(0); // nothing saved yet
  mockInput.pressEnter(); // now save
  await flush();
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]!.description).toBe("line one\nline two");
});

test("empty title is rejected", async () => {
  const { mockInput, flush, state } = await setup();
  mockInput.pressKey("a");
  await flush();
  mockInput.pressKey("s", { ctrl: true }); // try to save with no title
  await flush();
  expect(state.tasks).toHaveLength(0);
});

test("moves a task across columns and stamps completion", async () => {
  const state = emptyState();
  state.tasks.push({
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

  expect(state.tasks[0]!.status).toBe("done");
  expect(typeof state.tasks[0]!.completedAt).toBe("number");

  // Move it back out of done; completion stamp should clear.
  mockInput.pressKey("h", { shift: true });
  await flush();
  expect(state.tasks[0]!.status).toBe("blocked");
  expect(state.tasks[0]!.completedAt).toBeUndefined();
});

test("Space advances status and wraps round", async () => {
  const state = emptyState();
  state.tasks.push({
    id: "t1",
    title: "Cycle me",
    description: "",
    status: "done",
    completedAt: 5,
    createdAt: 1,
    updatedAt: 1,
  });
  // Selection starts on the todo column; navigate to done first.
  const { mockInput, flush } = await setup(state);
  mockInput.pressKey("l");
  mockInput.pressKey("l");
  mockInput.pressKey("l"); // now on done column where the task lives
  await flush();
  mockInput.pressKey(" "); // space: done -> todo (wrap)
  await flush();
  expect(state.tasks[0]!.status).toBe("todo");
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
  expect(state.tasks).toHaveLength(0);
});

test("deletes a task after confirmation", async () => {
  const state = emptyState();
  state.tasks.push({
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
  expect(state.tasks).toHaveLength(0);
});
