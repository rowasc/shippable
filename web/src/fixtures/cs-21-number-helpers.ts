import type { ChangeSet, Interaction } from "../types";
import {
  hunkSummaryReplyKey,
  lineNoteReplyKey,
} from "../types";

// Designed to reward "select a function, run it with edge inputs": four pure
// math helpers, one of which has a subtle bug that the runner exposes in
// seconds. Reviewer probes `roundTo(2.46, 0.1)` → expects `2.5`, gets `2.4`,
// flags the floor-vs-round mistake.

export const CS_21: ChangeSet = {
  id: "cs-21",
  title: "Add number-range helpers for chart axes",
  author: "yuki",
  branch: "feat/number-helpers",
  base: "main",
  createdAt: "2026-04-25T10:30:00Z",
  description:
    "New `src/utils/numbers.ts` with clamp / lerp / mapRange / roundTo. The chart axis code currently does these inline four different ways; consolidating before adding the log-scale axis next sprint.",
  files: [
    {
      id: "cs-21/src/utils/numbers.ts",
      path: "src/utils/numbers.ts",
      language: "ts",
      status: "added",
      hunks: [
        {
          id: "cs-21/src/utils/numbers.ts#h1",
          header: "@@ -0,0 +1,9 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 9,
          definesSymbols: ["clamp", "lerp"],
          aiReviewed: true,
          lines: [
            { kind: "add", text: "// Number helpers used by the chart axis layout.", newNo: 1 },
            { kind: "add", text: "// Pure functions; no globals; safe to call in tight loops.", newNo: 2 },
            { kind: "add", text: "", newNo: 3 },
            {
              kind: "add",
              text: "export function clamp(value: number, min: number, max: number): number {",
              newNo: 4,
            },
            { kind: "add", text: "  return Math.min(Math.max(value, min), max);", newNo: 5 },
            { kind: "add", text: "}", newNo: 6 },
            { kind: "add", text: "", newNo: 7 },
            { kind: "add", text: "export function lerp(a: number, b: number, t: number): number {", newNo: 8 },
            { kind: "add", text: "  return a + (b - a) * t;", newNo: 9 },
          ],
        },
        {
          id: "cs-21/src/utils/numbers.ts#h2",
          header: "@@ -0,0 +11,12 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 11,
          newCount: 12,
          definesSymbols: ["mapRange", "roundTo"],
          referencesSymbols: ["lerp"],
          aiReviewed: true,
          expandAbove: [
            [
              { kind: "context", text: "}", oldNo: 9, newNo: 9 },
              { kind: "context", text: "", oldNo: 10, newNo: 10 },
            ],
          ],
          lines: [
            {
              kind: "add",
              text: "export function mapRange(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {",
              newNo: 11,
            },
            {
              kind: "add",
              text: "  const t = (value - fromMin) / (fromMax - fromMin);",
              newNo: 12,
            },
            { kind: "add", text: "  return lerp(toMin, toMax, t);", newNo: 13 },
            { kind: "add", text: "}", newNo: 14 },
            { kind: "add", text: "", newNo: 15 },
            {
              kind: "add",
              text: "export function roundTo(value: number, increment: number): number {",
              newNo: 16,
            },
            { kind: "add", text: "  // Snap to the nearest multiple of `increment`.", newNo: 17 },
            { kind: "add", text: "  return Math.floor(value / increment) * increment;", newNo: 18 },
            { kind: "add", text: "}", newNo: 19 },
            { kind: "add", text: "", newNo: 20 },
            {
              kind: "add",
              text: "// TODO(yuki): add `niceTicks(min, max, count)` for the next axis revamp.",
              newNo: 21,
            },
            { kind: "add", text: "", newNo: 22 },
          ],
        },
      ],
    },
  ],
};

const H1_ID = "cs-21/src/utils/numbers.ts#h1";
const H2_ID = "cs-21/src/utils/numbers.ts#h2";

export const INTERACTIONS_21: Record<string, Interaction[]> = {
  [hunkSummaryReplyKey(H1_ID)]: [
    {
      id: `ai:${hunkSummaryReplyKey(H1_ID)}`,
      threadKey: hunkSummaryReplyKey(H1_ID),
      target: "block",
      intent: "comment",
      author: "ai",
      authorRole: "ai",
      body:
        "clamp / lerp are textbook implementations. clamp(NaN, 0, 100) returns NaN — usually fine, but worth deciding before downstream code starts trusting the bound.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H1_ID, 3)]: [
    {
      id: `ai:${lineNoteReplyKey(H1_ID, 3)}`,
      threadKey: lineNoteReplyKey(H1_ID, 3),
      target: "line",
      intent: "question",
      author: "ai",
      authorRole: "ai",
      body:
        "NaN passthrough?\n\nclamp(NaN, 0, 100) returns NaN. Try it — if the chart layout expects a clean number this becomes a downstream NaN parade.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [hunkSummaryReplyKey(H2_ID)]: [
    {
      id: `ai:${hunkSummaryReplyKey(H2_ID)}`,
      threadKey: hunkSummaryReplyKey(H2_ID),
      target: "block",
      intent: "comment",
      author: "ai",
      authorRole: "ai",
      body:
        "roundTo uses Math.floor — that's truncation toward -∞, not rounding to nearest. roundTo(2.46, 0.1) returns 2.4, not 2.5. Worth probing before merge.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H2_ID, 1)]: [
    {
      id: `ai:${lineNoteReplyKey(H2_ID, 1)}`,
      threadKey: lineNoteReplyKey(H2_ID, 1),
      target: "line",
      intent: "request",
      author: "ai",
      authorRole: "ai",
      body:
        "Divide-by-zero when fromMin === fromMax\n\nReturns NaN silently. Try `mapRange(5, 0, 0, 100, 200)` — if a caller has a degenerate range the chart will quietly draw garbage.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H2_ID, 5)]: [
    {
      id: `ai:${lineNoteReplyKey(H2_ID, 5)}`,
      threadKey: lineNoteReplyKey(H2_ID, 5),
      target: "line",
      intent: "request",
      author: "ai",
      authorRole: "ai",
      body:
        "Math.floor truncates, doesn't round\n\nProbe `roundTo(2.46, 0.1)` — the floor truncates toward 0 instead of rounding to nearest. Likely want `Math.round(value / increment) * increment`.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H2_ID, 6)]: [
    {
      id: "r-21-1",
      threadKey: lineNoteReplyKey(H2_ID, 6),
      target: "reply-to-ai-note",
      intent: "comment",
      author: "yuki",
      authorRole: "user",
      body:
        "Yeah — switching to Math.round. The original axis code used floor for tick positions which is why I copied it, but for snap-to-grid you want round. Will push a fix.",
      createdAt: "2026-04-25T13:42:00Z",
    },
  ],
};
