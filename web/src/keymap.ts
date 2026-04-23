/**
 * Single source of truth for keyboard shortcuts.
 *
 * ActionId drives dispatch/setState in App.tsx.
 * ContextPredicate names a runtime condition that App.tsx evaluates; an entry
 * only fires when its predicate (if any) is truthy.
 *
 * Tab is special: its shift variant (previous file) is represented by a
 * separate entry with shift:true so the table stays flat and HelpOverlay can
 * display both variants naturally.
 */

export type ActionId =
  | "MOVE_LINE_DOWN"
  | "MOVE_LINE_UP"
  | "MOVE_LINE_DOWN_EXTEND"
  | "MOVE_LINE_UP_EXTEND"
  | "MOVE_HUNK_DOWN"
  | "MOVE_HUNK_UP"
  | "MOVE_FILE_NEXT"
  | "MOVE_FILE_PREV"
  | "COLLAPSE_SELECTION"
  | "TOGGLE_HELP"
  | "TOGGLE_INSPECTOR"
  | "TOGGLE_ACK"
  | "START_REPLY"
  | "START_COMMENT"
  | "ACCEPT_GUIDE"
  | "DISMISS_GUIDE"
  | "CLOSE_HELP"
  | "PREV_CHANGESET"
  | "NEXT_CHANGESET"
  | "OPEN_LOAD";

export type ContextPredicate = "hasSuggestion" | "lineHasAiNote" | "hasSelection";

export type KeyGroup = "navigation" | "review" | "guide" | "ui" | "testing";

export interface KeyEntry {
  /** The value of KeyboardEvent.key */
  key: string;
  /** If true, Shift must be held; default false */
  shift?: boolean;
  label: string;
  group: KeyGroup;
  action: ActionId;
  /** Entry only fires when this predicate is true at dispatch time */
  when?: ContextPredicate;
}

export const KEYMAP: KeyEntry[] = [
  // ── navigation ─────────────────────────────────────────────────────────────
  // Shift-extend variants listed first so they win the KEYMAP.find over the
  // shift-agnostic arrow entries below.
  { key: "ArrowDown", shift: true, label: "extend selection down", group: "navigation", action: "MOVE_LINE_DOWN_EXTEND" },
  { key: "ArrowUp",   shift: true, label: "extend selection up",   group: "navigation", action: "MOVE_LINE_UP_EXTEND" },
  { key: "j",         label: "next line",            group: "navigation", action: "MOVE_LINE_DOWN" },
  { key: "ArrowDown", label: "next line",            group: "navigation", action: "MOVE_LINE_DOWN" },
  { key: "k",         label: "previous line",        group: "navigation", action: "MOVE_LINE_UP" },
  { key: "ArrowUp",   label: "previous line",        group: "navigation", action: "MOVE_LINE_UP" },
  { key: "J",         label: "next hunk",            group: "navigation", action: "MOVE_HUNK_DOWN" },
  { key: "K",         label: "previous hunk",        group: "navigation", action: "MOVE_HUNK_UP" },
  { key: "Tab", shift: false, label: "next file",     group: "navigation", action: "MOVE_FILE_NEXT" },
  { key: "Tab", shift: true,  label: "previous file", group: "navigation", action: "MOVE_FILE_PREV" },
  { key: "Escape", when: "hasSelection", label: "collapse selection", group: "navigation", action: "COLLAPSE_SELECTION" },

  // ── review ──────────────────────────────────────────────────────────────────
  { key: "a", label: "ack / un-ack AI note on current line", group: "review", action: "TOGGLE_ACK" },
  { key: "r", label: "reply to AI note on current line",     group: "review", action: "START_REPLY",   when: "lineHasAiNote" },
  { key: "c", label: "start a new comment on current line",  group: "review", action: "START_COMMENT" },

  // ── guide ───────────────────────────────────────────────────────────────────
  { key: "Enter",  label: "accept guide", group: "guide", action: "ACCEPT_GUIDE",  when: "hasSuggestion" },
  { key: "y",      label: "accept guide", group: "guide", action: "ACCEPT_GUIDE",  when: "hasSuggestion" },
  { key: "Escape", label: "dismiss guide", group: "guide", action: "DISMISS_GUIDE", when: "hasSuggestion" },
  { key: "n",      label: "dismiss guide", group: "guide", action: "DISMISS_GUIDE", when: "hasSuggestion" },

  // ── ui ──────────────────────────────────────────────────────────────────────
  { key: "?",      label: "toggle this help",    group: "ui", action: "TOGGLE_HELP" },
  { key: "i",      label: "toggle AI inspector", group: "ui", action: "TOGGLE_INSPECTOR" },
  { key: "Escape", label: "close help",          group: "ui", action: "CLOSE_HELP" },
  { key: "L", shift: true, label: "load a changeset (URL / file / paste)", group: "ui", action: "OPEN_LOAD" },

  // ── testing ─────────────────────────────────────────────────────────────────
  { key: "[", label: "previous sample changeset", group: "testing", action: "PREV_CHANGESET" },
  { key: "]", label: "next sample changeset",     group: "testing", action: "NEXT_CHANGESET" },
];
