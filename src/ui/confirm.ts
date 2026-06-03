import { BoxRenderable, TextRenderable, bold, fg, t, type CliRenderer } from "@opentui/core";

import { truncate } from "../tasks.ts";
import { theme } from "../theme.ts";

/** Small yes/no modal. The owning controller handles the y / n / Esc keys. */
export class ConfirmView {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;

  constructor(renderer: CliRenderer, opts: { message: string; detail?: string }) {
    this.renderer = renderer;

    const width = Math.min(60, Math.max(36, renderer.width - 8));
    const height = 8;
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));

    this.box = new BoxRenderable(renderer, {
      id: "confirm-modal",
      position: "absolute",
      left,
      top,
      width,
      height,
      zIndex: 1100,
      backgroundColor: theme.modalBg,
      border: true,
      borderStyle: "rounded",
      borderColor: theme.warn,
      title: " Confirm ",
      titleAlignment: "center",
      flexDirection: "column",
      padding: 1,
    });

    this.box.add(
      new TextRenderable(renderer, {
        content: t`${bold(fg(theme.text)(opts.message))}`,
        wrapMode: "word",
        flexShrink: 0,
      }),
    );

    if (opts.detail) {
      this.box.add(
        new TextRenderable(renderer, {
          content: t`${fg(theme.textDim)(`“${truncate(opts.detail, width - 6)}”`)}`,
          height: 1,
          flexShrink: 0,
          marginTop: 1,
        }),
      );
    }

    this.box.add(
      new TextRenderable(renderer, {
        content: t`${fg(theme.warn)("y")} ${fg(theme.text)("confirm")}    ${fg(
          theme.textDim,
        )("n / Esc cancel")}`,
        height: 1,
        flexShrink: 0,
        flexGrow: 1,
        marginTop: 1,
      }),
    );

    renderer.root.add(this.box);
    this.renderer.requestRender();
  }

  destroy(): void {
    this.renderer.root.remove(this.box.id);
    this.box.destroyRecursively();
    this.renderer.requestRender();
  }
}
