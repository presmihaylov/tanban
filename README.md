# tanban

A fast, keyboard-driven **kanban board for your terminal** (a tiny play on
"kanban"). Track work across
**TODO → In Progress → Blocked → Done**, all without touching the mouse. Built
with [Bun](https://bun.sh) and [OpenTUI](https://opentui.com).

```
                                  work   side   personal
 ╭────────TODO · 2────────╮ ╭─────IN PROGRESS · 1─────╮ ╭─────IN REVIEW · 1──────╮ ╭────────DONE · 2────────╮
 │ ● Write the README     │ │ ● Refactor key handler  │ │ ○ Fix flicker on resi… │ │ ● Ship v0.1       ⌛1d │
 │ ○ Add boards view      │ │                         │ │                        │ │ ○ Set up CI            │
 ╰────────────────────────╯ ╰─────────────────────────╯ ╰────────────────────────╯ ╰────────────────────────╯
 a add · e edit · ⏎ view · d delete · ⇧+arrows/hjkl move · ⇥ board · b new · r rename · ⇧D del board · A history · ? help · q quit
```

## Features

- Four columns: **TODO**, **In Progress**, **In Review**, **Done**.
- **Multiple boards** ("dimensions"): keep a separate board for work, side
  projects, etc. Cycle between them with `Tab`; the header shows their names
  with the active one highlighted. Add (`b`), rename (`r`), and delete (`⇧D`)
  boards on the fly. Each board has its own tasks and completion history.
- Each task has a required **title** and an optional **description**.
- Fully keyboard-driven — every action has a binding (see below).
- **Sessions persist**: state lives in a JSON file under `~/.config` and is
  reloaded on every launch.
- **Auto-archiving**: tasks sit in Done for 7 days after completion, then move
  to a separate archive (viewable, off the board).
- A `●` bullet marks tasks that have a description; `○` marks those without.
  Done cards show a `⌛Nd` countdown in their final 2 days before archiving.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- A terminal that supports a TUI (most modern terminals; OpenTUI prefers ones
  with the Kitty keyboard protocol but degrades gracefully).

## Install & run

```bash
bun install
bun start          # or: bun run index.ts
```

### Install as a native binary (recommended)

Bun compiles the whole app — runtime, code, and OpenTUI's native library — into
a single self-contained executable, then drops it on your `PATH`:

```bash
bun run install:bin    # builds dist/tanban and installs it to ~/.local/bin/tanban
tanban                 # run it from anywhere
```

This binary is standalone: it keeps working even if you move or delete the
source checkout. Re-run `bun run install:bin` after changing the source to
refresh it. (Make sure `~/.local/bin` is on your `PATH`.)

### Or link it live (reflects source edits without rebuilding)

```bash
bun link               # from this directory; creates a `tanban` shim in ~/.bun/bin
```

## Keybindings

| Keys | Action |
| --- | --- |
| `←` `→` / `h` `l` | Move between columns |
| `↑` `↓` / `j` `k` | Move between cards |
| `g` / `G` | Jump to first / last card |
| `⇧←` `⇧→` / `H` `L` | Move task to previous / next column |
| `⇧↑` `⇧↓` / `K` `J` | Reorder task within its column |
| `a` / `n` | Add a new task (in the focused column) |
| `e` | Edit selected task |
| `Enter` | View task details |
| `d` | Delete selected task (asks to confirm) |
| `Tab` / `⇧Tab` | Switch to the next / previous board |
| `b` | New board (prompts for a name) |
| `r` | Rename the current board |
| `⇧D` | Delete the current board (asks to confirm) |
| `A` | Toggle the completed-work history view |
| `?` | Toggle the help overlay |
| `q` / `Ctrl+C` | Quit |

**In the add/edit form:** `Tab` switches between title and description, `Enter`
(or `Ctrl+S`) saves the task from either field, `Shift+Enter` inserts a newline
in the description, and `Esc` cancels.

> Note on `Shift` keys: moving/reordering tasks (`Shift`+arrows) and newlines
> (`Shift+Enter`) rely on the terminal reporting the Shift modifier. Modern
> terminals (Kitty keyboard protocol) do; on older terminals use the letter
> equivalents `H` `L` `J` `K` to move tasks, and `Ctrl+S` to save.

## Where state is stored

```
$XDG_CONFIG_HOME/tanban/state.json     # if XDG_CONFIG_HOME is set
~/.config/tanban/state.json            # otherwise
```

Override the location with the `TANBAN_STATE_FILE` environment variable.
State is written atomically after every change, so an unexpected exit (or
`Ctrl+C`) never loses data. A corrupt file is backed up to
`state.json.corrupt-<timestamp>` and the board starts fresh.

## Development

```bash
bun test            # unit + headless-renderer integration tests
bun run typecheck   # tsc --noEmit
bun run dev         # run with --watch
bun run build       # compile a standalone binary into dist/tanban
bun run install:bin # build + install to ~/.local/bin/tanban
```

See [CLAUDE.md](./CLAUDE.md) for an architecture overview.

## License

[MIT](./LICENSE) © Preslav Mihaylov
