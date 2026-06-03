import {
  BoxRenderable,
  InputRenderable,
  TextareaRenderable,
  TextRenderable,
  dim,
  fg,
  t,
  type CliRenderer,
} from "@opentui/core";

import { theme } from "../theme.ts";

export type FormField = "title" | "desc";

export interface FormValues {
  title: string;
  description: string;
}

/**
 * A centered modal with a single-line title input and a multi-line description
 * textarea. The owning controller routes Tab / Ctrl+S / Esc; everything else
 * flows to whichever field is focused.
 */
export class TaskForm {
  readonly box: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly titleInput: InputRenderable;
  private readonly descArea: TextareaRenderable;
  private readonly titleLabel: TextRenderable;
  private readonly descLabel: TextRenderable;
  private readonly hint: TextRenderable;
  private field: FormField = "title";

  constructor(
    renderer: CliRenderer,
    opts: { heading: string; title: string; description: string },
  ) {
    this.renderer = renderer;

    const width = Math.min(66, Math.max(34, renderer.width - 6));
    const height = Math.min(18, Math.max(12, renderer.height - 4));
    const left = Math.max(0, Math.floor((renderer.width - width) / 2));
    const top = Math.max(0, Math.floor((renderer.height - height) / 2));

    this.box = new BoxRenderable(renderer, {
      id: "form-modal",
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

    this.titleLabel = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 });
    this.titleInput = new InputRenderable(renderer, {
      flexShrink: 0,
      value: opts.title,
      placeholder: "Short, action-oriented title",
      backgroundColor: theme.inputBg,
      focusedBackgroundColor: theme.inputBgFocused,
      textColor: theme.text,
      placeholderColor: theme.textDim,
      maxLength: 140,
    });

    const spacer = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 });

    this.descLabel = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 });
    this.descArea = new TextareaRenderable(renderer, {
      flexGrow: 1,
      minHeight: 3,
      initialValue: opts.description,
      placeholder: "Notes, context, acceptance criteria…",
      backgroundColor: theme.inputBg,
      focusedBackgroundColor: theme.inputBgFocused,
      textColor: theme.text,
      placeholderColor: theme.textDim,
      wrapMode: "word",
    });

    this.hint = new TextRenderable(renderer, {
      content: "Tab field · Enter save · ⇧Enter newline · Esc cancel",
      height: 1,
      flexShrink: 0,
      fg: theme.textDim,
    });

    this.box.add(this.titleLabel);
    this.box.add(this.titleInput);
    this.box.add(spacer);
    this.box.add(this.descLabel);
    this.box.add(this.descArea);
    this.box.add(this.hint);

    renderer.root.add(this.box);
    this.setField("title");
  }

  get currentField(): FormField {
    return this.field;
  }

  setField(field: FormField): void {
    this.field = field;
    if (field === "title") {
      this.descArea.blur();
      this.titleInput.focus();
    } else {
      this.titleInput.blur();
      this.descArea.focus();
    }
    this.updateLabels();
    this.renderer.requestRender();
  }

  toggleField(): void {
    this.setField(this.field === "title" ? "desc" : "title");
  }

  /** Insert a literal line break into the description (Shift+Enter). */
  insertDescriptionNewline(): void {
    this.descArea.insertText("\n");
    this.renderer.requestRender();
  }

  /** Flash a validation message in the hint row (e.g. empty title). */
  setError(message: string): void {
    this.hint.content = t`${fg(theme.warn)(message)}`;
    this.renderer.requestRender();
  }

  values(): FormValues {
    return {
      title: this.titleInput.value.trim(),
      description: this.descArea.plainText.trim(),
    };
  }

  destroy(): void {
    this.titleInput.blur();
    this.descArea.blur();
    this.renderer.root.remove(this.box.id);
    this.box.destroyRecursively();
    this.renderer.requestRender();
  }

  private updateLabels(): void {
    this.titleLabel.content =
      this.field === "title"
        ? t`${fg(theme.borderFocused)("▸ Title")}`
        : t`${dim("  Title")}`;
    this.descLabel.content =
      this.field === "desc"
        ? t`${fg(theme.borderFocused)("▸ Description")} ${dim("(optional)")}`
        : t`${dim("  Description (optional)")}`;
  }
}
