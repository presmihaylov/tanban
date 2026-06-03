import type { Status } from "./types.ts";

/**
 * Column definitions in display order, each with its title and accent colour.
 * Accents: orange (queued), cyan (active), green (in review), off-white (done).
 * The `blocked` status id is kept for back-compat; only its label changed.
 */
export const COLUMNS: ReadonlyArray<{ status: Status; title: string; accent: string }> = [
  { status: "todo", title: "TODO", accent: "#fd971f" },
  { status: "in_progress", title: "IN PROGRESS", accent: "#66d9ef" },
  { status: "blocked", title: "IN REVIEW", accent: "#a6e22e" },
  { status: "done", title: "DONE", accent: "#e6e6dc" },
];

export const accentFor = (status: Status): string =>
  COLUMNS.find((c) => c.status === status)?.accent ?? "#8b9cb8";

export const titleFor = (status: Status): string =>
  COLUMNS.find((c) => c.status === status)?.title ?? status;

/** Centralised palette (classic Monokai) so the whole app stays consistent. */
export const theme = {
  background: "#1e1f1c", // darkest, behind the columns
  panel: "#272822", // classic Monokai background, the column fill
  border: "#3e3d32",
  borderFocused: "#66d9ef",
  text: "#f8f8f2", // Monokai foreground
  textDim: "#75715e", // Monokai comment grey
  textMuted: "#49483e", // Monokai selection grey (unfocused selection bar)
  brand: "#ae81ff", // Monokai purple
  /** Selected card: a soft grey-white bar with dark, bold text on top (pi-style). */
  selectionBg: "#d4d4dc",
  selectionFg: "#1b1c18",
  /** Gray description preview shown under a card title, per background. */
  descDim: "#75715e", // on the dark panel (default)
  descOnAccent: "#3a3b34", // dark grey, readable on the light selection bar
  descOnMuted: "#c8c4b0", // light grey, readable on the muted (unfocused) bar
  modalBg: "#2d2e28",
  modalBorder: "#66d9ef",
  inputBg: "#3a3a32",
  inputBgFocused: "#49483e",
  warn: "#e6db74", // Monokai yellow
} as const;
