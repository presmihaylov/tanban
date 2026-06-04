import {
  BoxRenderable,
  InputRenderable,
  TextRenderable,
  fg,
  t,
  type CliRenderer,
} from "@opentui/core";

import { theme } from "../theme.ts";

/**
 * A tiny centered modal with a single-line text input — used to name a new
 * board or rename the current one. The owning controller routes Enter / Esc;
 * everything else flows to the focused input.
 */
export class PromptView {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly input: InputRenderable;
  private readonly hint: TextRenderable;

  constructor(
    renderer: CliRenderer,
    opts: { heading: string; value: string; placeholder: string },
  ) {
    this.renderer = renderer;

    const width = Math.min(56, Math.max(34, renderer.width - 6));
    const height = 7;
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));

    this.box = new BoxRenderable(renderer, {
      id: "prompt-modal",
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
      title: opts.heading,
      titleAlignment: "center",
      flexDirection: "column",
      padding: 1,
    });

    this.input = new InputRenderable(renderer, {
      flexShrink: 0,
      value: opts.value,
      placeholder: opts.placeholder,
      backgroundColor: theme.inputBg,
      focusedBackgroundColor: theme.inputBgFocused,
      textColor: theme.text,
      placeholderColor: theme.textDim,
      maxLength: 40,
    });

    const spacer = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 });

    this.hint = new TextRenderable(renderer, {
      content: "Enter save · Esc cancel",
      height: 1,
      flexShrink: 0,
      fg: theme.textDim,
    });

    this.box.add(this.input);
    this.box.add(spacer);
    this.box.add(this.hint);

    renderer.root.add(this.box);
    this.input.focus();
    this.renderer.requestRender();
  }

  value(): string {
    return this.input.value.trim();
  }

  /** Flash a validation message in the hint row (e.g. empty name). */
  setError(message: string): void {
    this.hint.content = t`${fg(theme.warn)(message)}`;
    this.renderer.requestRender();
  }

  destroy(): void {
    this.input.blur();
    this.renderer.root.remove(this.box.id);
    this.box.destroyRecursively();
    this.renderer.requestRender();
  }
}
