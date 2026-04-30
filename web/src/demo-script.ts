import type { ThemeId } from "./tokens";

/**
 * One frame of the gallery's play-mode demo reel. Each frame names a fixture
 * from `ALL_FIXTURES` (in `gallery-fixtures.ts`), a caption to overlay on the
 * stage, and optionally a theme to switch to or a custom duration in ms.
 *
 * Reorder/edit DEMO_SCRIPT below to change the demo without touching
 * Gallery.tsx.
 */
export interface DemoFrame {
  /** Matches a fixture in ALL_FIXTURES (gallery-fixtures.ts). */
  fixtureName: string;
  /** Caption shown over the stage while this frame is on. */
  caption: string;
  /** If set, applies this theme when the frame becomes active. If absent,
   *  the previous theme stays in place — frames don't snap back. */
  themeId?: ThemeId;
  /** If set, overrides DEFAULT_FRAME_DURATION_MS for this frame. */
  durationMs?: number;
}

export const DEFAULT_FRAME_DURATION_MS = 6000;

export const DEMO_SCRIPT: DemoFrame[] = [
  { fixtureName: "plan-rule", caption: "where to start" },
  { fixtureName: "empty", caption: "the diff at rest" },
  { fixtureName: "mid-review", caption: "track read coverage as you go" },
  { fixtureName: "block-selection", caption: "comment a block of code" },
  {
    fixtureName: "ai-saturated",
    caption: "AI notes are top of mind",
    themeId: "dollhouse",
  },
  {
    fixtureName: "teammate-endorsed",
    caption: "teammate sign-offs land here too",
    themeId: "light",
  },
  { fixtureName: "file-reviewed", caption: "Shift+M signs off a file" },
  {
    fixtureName: "syntax-highlighting",
    caption: "syntax highlighting across themes",
  },
];
