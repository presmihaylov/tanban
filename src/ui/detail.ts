import {
  BoxRenderable,
  TextRenderable,
  bold,
  dim,
  fg,
  t,
  type CliRenderer,
} from "@opentui/core";

import { daysUntilArchive, relativeTime } from "../tasks.ts";
import { accentFor, theme, titleFor } from "../theme.ts";
import type { Task } from "../types.ts";

/** Read-only modal showing a task's full title, metadata and description. */
export class DetailView {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;

  constructor(renderer: CliRenderer, task: Task) {
    this.renderer = renderer;

    const width = Math.min(74, Math.max(40, renderer.width - 6));
    const height = Math.min(22, Math.max(10, renderer.height - 4));
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));

    this.box = new BoxRenderable(renderer, {
      id: "detail-modal",
      position: "absolute",
      left,
      top,
      width,
      height,
      zIndex: 1000,
      backgroundColor: theme.modalBg,
      border: true,
      borderStyle: "rounded",
      borderColor: accentFor(task.status),
      title: " Task ",
      titleAlignment: "center",
      flexDirection: "column",
      padding: 1,
    });

    const titleText = new TextRenderable(renderer, {
      content: t`${bold(fg(theme.text)(task.title))}`,
      wrapMode: "word",
      flexShrink: 0,
    });

    const days = daysUntilArchive(task);
    const archiveStr = days !== null ? `  ·  archives in ${days}d` : "";
    const metaText = new TextRenderable(renderer, {
      content: t`${fg(accentFor(task.status))("●")} ${fg(theme.text)(
        titleFor(task.status),
      )}   ${dim(
        `created ${relativeTime(task.createdAt)} · updated ${relativeTime(
          task.updatedAt,
        )}${archiveStr}`,
      )}`,
      height: 1,
      flexShrink: 0,
      marginTop: 1,
    });

    const descLabel = new TextRenderable(renderer, {
      content: t`${dim("Description")}`,
      height: 1,
      flexShrink: 0,
      marginTop: 1,
    });

    const hasDesc = task.description.trim().length > 0;
    const descText = new TextRenderable(renderer, {
      content: hasDesc ? task.description : "(no description)",
      fg: hasDesc ? theme.text : theme.textDim,
      wrapMode: "word",
      flexGrow: 1,
    });

    const hint = new TextRenderable(renderer, {
      content: "e edit   ·   d delete   ·   Esc / Enter close",
      height: 1,
      flexShrink: 0,
      fg: theme.textDim,
      marginTop: 1,
    });

    this.box.add(titleText);
    this.box.add(metaText);
    this.box.add(descLabel);
    this.box.add(descText);
    this.box.add(hint);

    renderer.root.add(this.box);
    this.renderer.requestRender();
  }

  destroy(): void {
    this.renderer.root.remove(this.box.id);
    this.box.destroyRecursively();
    this.renderer.requestRender();
  }
}
