# tanban — architecture notes

A keyboard-driven kanban TUI built on **`@opentui/core`** (imperative API) and
run with **Bun**. TypeScript throughout, strict mode.

## Run / test

- `bun start` — launch the app (requires a TTY).
- `bun test` — runs `tests/`. `storage.test.ts` covers persistence + archiving;
  `app.test.ts` drives the real app through OpenTUI's headless test renderer
  (`@opentui/core/testing` → `createTestRenderer`, `mockInput`, `captureCharFrame`).
- `bun run typecheck` — `tsc --noEmit`.
- `bun run build` / `bun run install:bin` — compile a standalone binary
  (`bun build --compile`) and install it to `~/.local/bin/tanban`. Bun embeds
  OpenTUI's native `libopentui.dylib`, so the binary is self-contained.

## Layout

```
index.ts            Entry: load state, archive expired, create renderer, start app.
src/types.ts        Task / Status / Board / BoardState model. STATUSES is column order.
src/storage.ts      Load/save (atomic), XDG paths, v2→v3 migration, 7-day archiving, history log.
src/tasks.ts        Pure selectors: tasksByStatus(board), daysUntilArchive, history grouping, wrapText.
src/theme.ts        COLUMNS (status→title/accent) and the colour palette.
src/app.ts          KanbanApp: mode state machine + the single global key handler.
src/ui/board.ts     BoardView: persistent header/columns/footer; rebuilds cards on render.
src/ui/form.ts      TaskForm modal (add/edit): title Input + description Textarea.
src/ui/prompt.ts    PromptView modal: single-line text input (new/rename board name).
src/ui/detail.ts    DetailView modal (read-only task view).
src/ui/help.ts      HelpView modal; BINDINGS is the source of truth for the help list.
src/ui/history.ts   HistoryView modal: scrollable completed-work log (per board).
src/ui/confirm.ts   ConfirmView modal (delete task / delete board, y/n).
```

## Boards (dimensions)

- **State holds many boards.** `BoardState = { version, boards: Board[],
  activeBoardId }`; each `Board` has its own `tasks: Task[]`. The app shows one
  board at a time; **Tab / Shift+Tab cycle** through them, and the header is a
  tab strip of board names (active one bold). `b` creates a board, `r` renames
  the active one, `⇧D` deletes it (never the last). All selectors/actions in
  `app.ts` operate on `activeBoard()`.
- **Migration.** `parseState` wraps a legacy flat `{ tasks }` file (v1/v2) into
  a single board named "main" (v3). `activeBoardId` falls back to the first
  board if stale.
- **History is per board.** `HistoryEntry` carries a `boardId`; the history view
  filters to the active board. Entries with no `boardId` (legacy) are attributed
  to the first board (`defaultBoardId()`). Deleting a board calls
  `removeBoardHistory` to drop its entries from `history.jsonl`.

## Key conventions & gotchas

- **Single global key handler.** `app.ts` registers one
  `renderer.keyInput.on("keypress", ...)` and dispatches by `mode`. OpenTUI runs
  global keypress listeners *before* the focused renderable, and `key.preventDefault()`
  stops the focused widget from also seeing the key (verified in
  `lib/KeyHandler` → `emitWithPriority`). So: in board mode we `preventDefault`
  everything we handle; in form mode we only intercept Tab / Ctrl+S / Esc /
  Enter (plain Enter saves from either field; Shift+Enter inserts a newline in
  the description) and let every other key fall through to the focused input.
  Prompt mode (board name) is the same idea: intercept Enter / Esc, let the rest
  reach the input. In board mode, Tab / Shift+Tab cycle boards.
- **Key names** come from `parseKeypress`: lowercase `name` (`"h"`, `"return"`,
  `"escape"`, `"tab"`, `"left"`, `"space"`) plus `shift` / `ctrl` flags. Capitals
  are `name:"h", shift:true`. Use those, not raw sequences.
- **Ordering** within a column is the order of the active board's `tasks`
  (filtered by status) — there is no separate order field. Reordering swaps
  array positions; moving columns only changes `status` (and `completedAt`).
- **Archiving** runs once at startup (`archiveExpired` in `index.ts`). A task
  gets `completedAt` when it enters Done and loses it when it leaves.
- **Persistence** is immediate: every mutation calls `saveState`, and the
  renderer's `onDestroy` saves again, so Ctrl+C is safe.
- **Rendering** is retained-mode. The board rebuilds only its card rows each
  `render()` (small N); modals are created/destroyed on demand and live at
  `zIndex` 1000+. Card highlight is a full-width `BoxRenderable` background bar.
- **Renderables are constructed as `new XRenderable(renderer, options)`** (the
  renderer is the `RenderContext`). `TextRenderable.content` wants a `string` or
  `StyledText` — wrap styled chunks with the `` t`...` `` template, not a bare
  `fg()`/`dim()` chunk.
- **TS note:** `tsconfig.json` pins `"types": ["bun"]` because TypeScript 6's
  default `@types` auto-inclusion didn't pick up Bun/node globals here.
