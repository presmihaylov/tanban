import { BoxRenderable, TextRenderable, dim, fg, t, type CliRenderer } from "@opentui/core";

import { relativeTime, truncate } from "../tasks.ts";
import { theme } from "../theme.ts";
import type { Task } from "../types.ts";

/** Read-only list of archived (auto-retired) tasks, newest first. */
export class ArchiveView {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;

  constructor(renderer: CliRenderer, archived: Task[]) {
    this.renderer = renderer;

    const width = Math.min(76, Math.max(44, renderer.width - 6));
    const height = Math.min(renderer.height - 2, Math.max(7, archived.length + 4));
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));

    this.box = new BoxRenderable(renderer, {
      id: "archive-modal",
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
      title: ` Archived · ${archived.length} `,
      titleAlignment: "center",
      bottomTitle: " Esc to close ",
      bottomTitleAlignment: "center",
      flexDirection: "column",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
    });

    if (archived.length === 0) {
      this.box.add(
        new TextRenderable(renderer, {
          content: "Nothing here yet.",
          fg: theme.text,
          height: 1,
          flexShrink: 0,
        }),
      );
      this.box.add(
        new TextRenderable(renderer, {
          content: t`${dim("Done tasks are archived 7 days after completion.")}`,
          height: 1,
          flexShrink: 0,
          marginTop: 1,
        }),
      );
    } else {
      const capacity = Math.max(1, height - 2);
      const shown = archived.slice(0, capacity);
      const stampWidth = 9;
      for (const task of shown) {
        const when = relativeTime(task.completedAt ?? task.updatedAt);
        const title = truncate(task.title, width - 6 - stampWidth);
        this.box.add(
          new TextRenderable(renderer, {
            content: t`${dim(when.padEnd(stampWidth))}${fg(theme.text)(title)}`,
            height: 1,
            flexShrink: 0,
          }),
        );
      }
      const hidden = archived.length - shown.length;
      if (hidden > 0) {
        this.box.add(
          new TextRenderable(renderer, {
            content: t`${dim(`+${hidden} older…`)}`,
            height: 1,
            flexShrink: 0,
          }),
        );
      }
    }

    renderer.root.add(this.box);
    this.renderer.requestRender();
  }

  destroy(): void {
    this.renderer.root.remove(this.box.id);
    this.box.destroyRecursively();
    this.renderer.requestRender();
  }
}
