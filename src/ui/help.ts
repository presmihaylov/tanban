import { BoxRenderable, TextRenderable, fg, t, type CliRenderer } from "@opentui/core";

import { theme } from "../theme.ts";

/** Single source of truth for the documented keybindings (shown in the overlay). */
export const BINDINGS: ReadonlyArray<readonly [string, string]> = [
  ["←/→   h/l", "Move between columns"],
  ["↑/↓   j/k", "Move between cards"],
  ["g / G", "Jump to first / last card"],
  ["⇧←/→  H/L", "Move task to prev / next column"],
  ["⇧↑/↓  K/J", "Reorder task within column"],
  ["a / n", "Add a new task"],
  ["e", "Edit selected task"],
  ["Enter", "View task details"],
  ["d", "Delete selected task"],
  ["A", "Completed-work history"],
  ["?", "Toggle this help"],
  ["q / Ctrl+C", "Quit"],
];

/** Centered overlay listing every keybinding. */
export class HelpView {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    const width = Math.min(56, Math.max(40, renderer.width - 6));
    const height = Math.min(renderer.height - 2, BINDINGS.length + 4);
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));

    this.box = new BoxRenderable(renderer, {
      id: "help-modal",
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
      title: " Keybindings ",
      titleAlignment: "center",
      bottomTitle: " Esc to close ",
      bottomTitleAlignment: "center",
      flexDirection: "column",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
    });

    for (const [key, desc] of BINDINGS) {
      this.box.add(
        new TextRenderable(renderer, {
          content: t`${fg(theme.borderFocused)(key.padEnd(13))}${fg(theme.text)(desc)}`,
          height: 1,
          flexShrink: 0,
        }),
      );
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
