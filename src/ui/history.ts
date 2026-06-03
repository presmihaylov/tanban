import { BoxRenderable, TextRenderable, bold, dim, fg, t, type CliRenderer } from "@opentui/core";

import {
  buildHistory,
  formatClock,
  HISTORY_RANGES,
  rangeLabel,
  truncate,
  type HistoryRange,
} from "../tasks.ts";
import { theme } from "../theme.ts";
import type { HistoryEntry, Task } from "../types.ts";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A pre-styled, single-line row (day header or completion entry). */
type Row = string | ReturnType<typeof t>;

function clearChildren(node: BoxRenderable): void {
  for (const child of [...node.getChildren()]) {
    node.remove(child.id);
    child.destroyRecursively();
  }
}

/**
 * Scrollable, read-only log of completed work. Merges the durable history log
 * with the tasks currently in Done, groups by day, and lets you cycle the time
 * range (Today / This Week / This Month / All) with Tab and scroll with j/k.
 * Defaults to "This Week" — the "what have I done this week" view.
 */
export class HistoryView {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly body: BoxRenderable;
  private readonly boardDone: Task[];
  private readonly log: HistoryEntry[];
  private readonly innerWidth: number;
  private readonly capacity: number;
  private rangeIdx = HISTORY_RANGES.indexOf("week");
  private offset = 0;

  constructor(renderer: CliRenderer, boardDone: Task[], log: HistoryEntry[]) {
    this.renderer = renderer;
    this.boardDone = boardDone;
    this.log = log;

    const width = Math.min(80, Math.max(48, renderer.width - 6));
    const height = Math.max(12, renderer.height - 6);
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));
    this.innerWidth = Math.max(10, width - 4); // minus left/right padding (2+2)
    this.capacity = Math.max(1, height - 4); // minus border (2) + top/bottom padding (2)

    this.box = new BoxRenderable(renderer, {
      id: "history-modal",
      position: "absolute",
      left,
      top,
      width,
      height,
      zIndex: 1000,
      backgroundColor: theme.modalBg,
      border: true,
      borderStyle: "rounded",
      borderColor: theme.modalBorder,
      title: " History ",
      titleAlignment: "center",
      bottomTitle: " Tab range · j/k scroll · Esc close ",
      bottomTitleAlignment: "center",
      flexDirection: "column",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
    });
    this.body = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
      backgroundColor: theme.modalBg,
    });
    this.box.add(this.body);

    renderer.root.add(this.box);
    this.rebuild();
  }

  private get range(): HistoryRange {
    return HISTORY_RANGES[this.rangeIdx]!;
  }

  cycleRange(): void {
    this.rangeIdx = (this.rangeIdx + 1) % HISTORY_RANGES.length;
    this.offset = 0;
    this.rebuild();
  }

  scroll(delta: number): void {
    this.offset += delta; // clamped against fresh row count in rebuild()
    this.rebuild();
  }

  private addRow(content: Row): void {
    this.body.add(
      new TextRenderable(this.renderer, {
        content,
        height: 1,
        flexShrink: 0,
        bg: theme.modalBg,
      }),
    );
  }

  private rebuild(): void {
    clearChildren(this.body);
    const { days, total } = buildHistory(this.boardDone, this.log, this.range);
    this.box.title = ` History · ${rangeLabel(this.range)} · ${total} `;

    if (total === 0) {
      this.box.bottomTitle = " Tab range · Esc close ";
      this.addRow(t`${fg(theme.text)("Nothing completed in this range.")}`);
      this.addRow("");
      this.addRow(t`${dim("Press Tab to widen the range.")}`);
      this.renderer.requestRender();
      return;
    }

    // Flatten day groups into single-line rows (header, then one per entry).
    const rows: Row[] = [];
    for (const day of days) {
      rows.push(t`${bold(fg(theme.brand)(day.label))}  ${dim(`· ${day.entries.length}`)}`);
      for (const entry of day.entries) {
        const title = truncate(
          entry.title.replace(/\s+/g, " ").trim(),
          Math.max(1, this.innerWidth - 8),
        );
        rows.push(t`  ${dim(formatClock(entry.completedAt))}  ${fg(theme.text)(title)}`);
      }
    }

    // Reserve a status line when the list overflows so scroll position is clear.
    const overflow = rows.length > this.capacity;
    const visibleRows = overflow ? this.capacity - 1 : this.capacity;
    this.offset = clamp(this.offset, 0, Math.max(0, rows.length - visibleRows));

    for (const row of rows.slice(this.offset, this.offset + visibleRows)) this.addRow(row);

    if (overflow) {
      const above = this.offset;
      const below = rows.length - (this.offset + visibleRows);
      const hint = `${above > 0 ? `↑${above}` : ""}${above > 0 && below > 0 ? "  " : ""}${below > 0 ? `↓${below}` : ""}`;
      this.addRow(t`${dim(hint || "·")}`);
    }
    this.box.bottomTitle = " Tab range · j/k scroll · Esc close ";
    this.renderer.requestRender();
  }

  destroy(): void {
    this.renderer.root.remove(this.box.id);
    this.box.destroyRecursively();
    this.renderer.requestRender();
  }
}
