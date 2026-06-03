import type { Status } from "./types.ts";

/** Column definitions in display order, each with its title and accent colour. */
export const COLUMNS: ReadonlyArray<{ status: Status; title: string; accent: string }> = [
  { status: "todo", title: "TODO", accent: "#8b9cb8" },
  { status: "in_progress", title: "IN PROGRESS", accent: "#4aa3ff" },
  { status: "blocked", title: "BLOCKED", accent: "#ff6b6b" },
  { status: "done", title: "DONE", accent: "#3fcf8e" },
];

export const accentFor = (status: Status): string =>
  COLUMNS.find((c) => c.status === status)?.accent ?? "#8b9cb8";

export const titleFor = (status: Status): string =>
  COLUMNS.find((c) => c.status === status)?.title ?? status;

/** Centralised palette so the whole app stays visually consistent. */
export const theme = {
  background: "#16161e",
  panel: "#1a1b26",
  border: "#2a2c3a",
  borderFocused: "#7aa2f7",
  text: "#c0caf5",
  textDim: "#565f89",
  textMuted: "#414868",
  brand: "#bb9af7",
  /** Selected card: bright bar with dark text on top. */
  selectionBg: "#7aa2f7",
  selectionFg: "#16161e",
  /** Gray description preview shown under a card title, per background. */
  descDim: "#6b7394", // on the dark panel (default)
  descOnAccent: "#1d2c4d", // dark slate, readable on the bright selection bar
  descOnMuted: "#aab2d8", // light gray, readable on the muted (unfocused) bar
  modalBg: "#1f2030",
  modalBorder: "#7aa2f7",
  inputBg: "#24283b",
  inputBgFocused: "#2f344d",
  warn: "#e0af68",
} as const;
