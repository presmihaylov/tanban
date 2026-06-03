import {
  BoxRenderable,
  TextRenderable,
  bold,
  fg,
  t,
  type CliRenderer,
} from "@opentui/core";

import { daysUntilArchive, tasksByStatus, truncate, wrapText } from "../tasks.ts";
import { COLUMNS, theme } from "../theme.ts";
import type { BoardState, Task } from "../types.ts";

export interface BoardSelection {
  col: number;
  row: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clearChildren(node: BoxRenderable): void {
  for (const child of [...node.getChildren()]) {
    node.remove(child.id);
    child.destroyRecursively();
  }
}

const hasDescription = (task: { description: string }) => task.description.trim().length > 0;

/** Archive-countdown badge for the title's first line, or "" when not due soon. */
function archiveSuffix(task: Task): string {
  const days = daysUntilArchive(task);
  if (days === null || days > 2) return "";
  return days <= 0 ? " ⌛<1d" : ` ⌛${days}d`;
}

/**
 * The wrapped title lines (and the badge that shares the first line) for a card
 * `width` cells wide. The bullet (2 cells) and badge are reserved on line one;
 * wrapping uses that same width on every line so continuation lines stay inside
 * the column. Shared by the height pass and the actual render so they agree.
 */
function titleLayout(task: Task, width: number): { lines: string[]; suffix: string } {
  const suffix = archiveSuffix(task);
  const titleWidth = Math.max(1, width - 2 - suffix.length);
  return { lines: wrapText(task.title, titleWidth), suffix };
}

/** Lines a card occupies: every wrapped title line, plus a description preview line. */
function cardHeight(task: Task, width: number): number {
  return titleLayout(task, width).lines.length + (hasDescription(task) ? 1 : 0);
}

/**
 * Pick a contiguous window of cards that fits within `rows` lines and always
 * contains the selected card. Returns [start, end). Cards have variable height,
 * so we grow outward from the selection: forward first (show what's next), then
 * backward to fill remaining space, then forward again to use any slack.
 */
function windowByHeight(
  heights: number[],
  rows: number,
  sel: number,
): { start: number; end: number } {
  const n = heights.length;
  if (n === 0) return { start: 0, end: 0 };
  const total = heights.reduce((a, b) => a + b, 0);
  if (total <= rows) return { start: 0, end: n };

  const anchor = sel < 0 ? 0 : Math.min(sel, n - 1);
  let start = anchor;
  let end = anchor + 1;
  let used = heights[anchor]!;

  while (end < n && used + heights[end]! <= rows) used += heights[end++]!;
  while (start > 0 && used + heights[start - 1]! <= rows) used += heights[--start]!;
  while (end < n && used + heights[end]! <= rows) used += heights[end++]!;

  return { start, end };
}

/**
 * Owns the persistent board layout (header, four columns, footer) and rebuilds
 * the card rows from state on each render. Card count is small for a personal
 * board, so a full rebuild per keystroke is simpler than diffing and plenty fast.
 */
export class BoardView {
  private readonly renderer: CliRenderer;
  private readonly header: TextRenderable;
  private readonly body: BoxRenderable;
  private readonly footer: TextRenderable;
  private readonly columnBoxes: BoxRenderable[] = [];
  private readonly columnBodies: BoxRenderable[] = [];

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.header = new TextRenderable(renderer, {
      id: "header",
      content: "",
      height: 1,
      flexShrink: 0,
    });

    this.body = new BoxRenderable(renderer, {
      id: "body",
      flexGrow: 1,
      flexDirection: "row",
      gap: 1,
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: theme.background,
    });

    this.footer = new TextRenderable(renderer, {
      id: "footer",
      content: "",
      height: 1,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      fg: theme.textDim,
    });

    for (const col of COLUMNS) {
      const box = new BoxRenderable(renderer, {
        id: `col-${col.status}`,
        flexGrow: 1,
        flexBasis: 0,
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor: theme.border,
        title: col.title,
        titleAlignment: "center",
        backgroundColor: theme.panel,
        overflow: "hidden",
        paddingLeft: 1,
        paddingRight: 1,
      });
      const inner = new BoxRenderable(renderer, {
        id: `colbody-${col.status}`,
        flexGrow: 1,
        flexDirection: "column",
        backgroundColor: theme.panel,
      });
      box.add(inner);
      this.body.add(box);
      this.columnBoxes.push(box);
      this.columnBodies.push(inner);
    }

    renderer.root.add(this.header);
    renderer.root.add(this.body);
    renderer.root.add(this.footer);
  }

  /** Rows available inside a column for cards (terminal height minus chrome). */
  private contentRows(): number {
    // header(1) + footer(1) + column top/bottom border(2) = 4 lines of chrome.
    return Math.max(1, this.renderer.height - 4);
  }

  private columnInnerWidth(): number {
    const gaps = COLUMNS.length - 1;
    const perColumn = Math.floor((this.renderer.width - 2 - gaps) / COLUMNS.length);
    // subtract the column's left/right border (2) and left/right padding (2).
    return Math.max(6, perColumn - 4);
  }

  render(state: BoardState, sel: BoardSelection, footerText: string): void {
    this.renderHeader();
    this.renderColumns(state, sel);
    this.footer.content = footerText;
    this.renderer.requestRender();
  }

  setFooter(text: string): void {
    this.footer.content = text;
    this.renderer.requestRender();
  }

  private renderHeader(): void {
    // Just the brand, centred, in the Done column's off-white.
    const label = "TANBAN";
    const pad = Math.max(0, Math.floor((this.renderer.width - label.length) / 2));
    this.header.content = t`${" ".repeat(pad)}${bold(fg(COLUMNS[3]!.accent)(label))}`;
  }

  private renderColumns(state: BoardState, sel: BoardSelection): void {
    const rows = this.contentRows();
    const innerWidth = this.columnInnerWidth();

    COLUMNS.forEach((col, ci) => {
      const box = this.columnBoxes[ci]!;
      const inner = this.columnBodies[ci]!;
      clearChildren(inner);

      const list = tasksByStatus(state, col.status);
      const focused = sel.col === ci;
      box.borderColor = focused ? col.accent : theme.border;
      box.title = list.length > 0 ? `${col.title} · ${list.length}` : col.title;

      const selRow = focused ? clamp(sel.row, 0, Math.max(0, list.length - 1)) : -1;

      // Cards are variable height (wrapped title lines + an optional description
      // preview), so window by accumulated line height rather than card count.
      const heights = list.map((task) => cardHeight(task, innerWidth));
      const { start, end } = windowByHeight(heights, rows, selRow);

      const above = start;
      const below = list.length - end;
      box.bottomTitle =
        above > 0 || below > 0
          ? `${above > 0 ? `↑${above} ` : ""}${below > 0 ? `↓${below}` : ""}`.trim()
          : undefined;
      box.bottomTitleAlignment = "right";

      for (let i = start; i < end; i++) {
        const task = list[i]!;
        inner.add(this.makeCard(task, i === selRow, focused, col.accent, innerWidth));
      }
    });
  }

  private makeCard(
    task: BoardState["tasks"][number],
    selected: boolean,
    columnFocused: boolean,
    accent: string,
    width: number,
  ): BoxRenderable {
    const hasDesc = hasDescription(task);
    const bullet = hasDesc ? "●" : "○";

    const { lines, suffix } = titleLayout(task, width);
    const titleHeight = lines.length;

    const cardBg = selected
      ? columnFocused
        ? theme.selectionBg
        : theme.textMuted
      : theme.panel;
    const fgColor = selected ? theme.selectionFg : theme.text;
    const descFg = selected
      ? columnFocused
        ? theme.descOnAccent
        : theme.descOnMuted
      : theme.descDim;

    const card = new BoxRenderable(this.renderer, {
      height: titleHeight + (hasDesc ? 1 : 0),
      flexShrink: 0,
      flexDirection: "column",
      backgroundColor: cardBg,
    });

    const titleRow = new BoxRenderable(this.renderer, {
      height: titleHeight,
      flexShrink: 0,
      flexDirection: "row",
      backgroundColor: cardBg,
    });
    // The bullet sits on the first line; the title's wrapped lines stack to its
    // right, so continuation lines line up under the title rather than the bullet.
    const bulletText = `${bullet} `;
    titleRow.add(
      new TextRenderable(this.renderer, {
        // Selected cards get bold text on the grey-white bar so they stand out.
        content: selected ? t`${bold(fg(theme.selectionFg)(bulletText))}` : bulletText,
        fg: selected ? theme.selectionFg : accent,
        bg: cardBg,
        flexShrink: 0,
      }),
    );
    const titleText = lines.join("\n");
    titleRow.add(
      new TextRenderable(this.renderer, {
        // Pre-wrapped in JS (wrapMode "none") so the rendered line count matches
        // what windowByHeight reserved for this card.
        content: selected ? t`${bold(fg(fgColor)(titleText))}` : titleText,
        wrapMode: "none",
        fg: fgColor,
        bg: cardBg,
        height: titleHeight,
        flexGrow: 1,
      }),
    );
    if (suffix) {
      titleRow.add(
        new TextRenderable(this.renderer, {
          content: suffix,
          fg: selected ? theme.selectionFg : theme.warn,
          bg: cardBg,
          flexShrink: 0,
        }),
      );
    }
    card.add(titleRow);

    if (hasDesc) {
      // Collapse newlines/runs of whitespace into a single-line gray preview,
      // indented to line up under the title (past the bullet).
      const preview = task.description.replace(/\s+/g, " ").trim();
      card.add(
        new TextRenderable(this.renderer, {
          content: truncate(preview, Math.max(1, width - 2)),
          fg: descFg,
          bg: cardBg,
          height: 1,
          flexShrink: 0,
          paddingLeft: 2,
        }),
      );
    }

    return card;
  }
}
