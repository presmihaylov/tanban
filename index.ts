#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";

import { KanbanApp } from "./src/app.ts";
import {
  archiveExpired,
  loadState,
  migrateLegacyArchive,
  saveState,
  stateFilePath,
} from "./src/storage.ts";
import { theme } from "./src/theme.ts";

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stderr.write(
      "tanban needs an interactive terminal (TTY). Run it directly in your shell.\n",
    );
    process.exit(1);
  }

  // v1 → v2: seed the history log from the old in-state archive before the
  // first save rewrites state.json without the `archived` field. No-op after.
  migrateLegacyArchive();

  const state = loadState();
  // Prune done tasks older than the archive window before we draw anything.
  if (archiveExpired(state)) saveState(state);

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    autoFocus: false,
    targetFps: 30,
    backgroundColor: theme.background,
    // Saved on every mutation already; this covers Ctrl+C and signal exits.
    onDestroy: () => saveState(state),
  });

  new KanbanApp(renderer, state);
  renderer.start();
}

main().catch((err) => {
  process.stderr.write(`tanban failed to start: ${String(err)}\n`);
  process.stderr.write(`state file: ${stateFilePath()}\n`);
  process.exit(1);
});
