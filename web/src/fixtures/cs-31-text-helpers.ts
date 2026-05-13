import type { ChangeSet, Interaction } from "../types";
import {
  hunkSummaryReplyKey,
  lineNoteReplyKey,
} from "../types";

// Showcases string-edge-case probing: select `slugify("Héllo Wörld")` — does
// it strip accents? Try `truncate("hello", 5)` — does it append "…" when the
// text already fits? These are the questions that visual review skips and
// the runner answers in 5 seconds.

export const CS_31: ChangeSet = {
  id: "cs-31",
  title: "Add text helpers for blog post excerpts",
  author: "ana",
  branch: "feat/text-helpers",
  base: "main",
  createdAt: "2026-04-26T08:15:00Z",
  description:
    "Three string utilities the blog list view needs: slugify (URL paths), truncate (card previews), and excerpt (the first N words). Replaces the inline regex'ing currently in BlogCard.tsx.",
  files: [
    {
      id: "cs-31/src/utils/text.ts",
      path: "src/utils/text.ts",
      language: "ts",
      status: "added",
      hunks: [
        {
          id: "cs-31/src/utils/text.ts#h1",
          header: "@@ -0,0 +1,11 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 11,
          definesSymbols: ["slugify"],
          aiReviewed: true,
          lines: [
            { kind: "add", text: "// Text helpers for the blog list. Pure, no DOM, no I/O.", newNo: 1 },
            { kind: "add", text: "", newNo: 2 },
            {
              kind: "add",
              text: "export function slugify(text: string): string {",
              newNo: 3,
            },
            { kind: "add", text: "  return text", newNo: 4 },
            { kind: "add", text: "    .toLowerCase()", newNo: 5 },
            { kind: "add", text: "    .trim()", newNo: 6 },
            { kind: "add", text: "    .replace(/[^a-z0-9]+/g, \"-\")", newNo: 7 },
            { kind: "add", text: "    .replace(/^-+|-+$/g, \"\");", newNo: 8 },
            { kind: "add", text: "}", newNo: 9 },
            { kind: "add", text: "", newNo: 10 },
            { kind: "add", text: "const ELLIPSIS = \"…\";", newNo: 11 },
          ],
        },
        {
          id: "cs-31/src/utils/text.ts#h2",
          header: "@@ -0,0 +13,15 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 13,
          newCount: 15,
          definesSymbols: ["truncate", "excerpt"],
          aiReviewed: true,
          expandAbove: [
            [
              { kind: "context", text: "const ELLIPSIS = \"…\";", oldNo: 11, newNo: 11 },
              { kind: "context", text: "", oldNo: 12, newNo: 12 },
            ],
          ],
          lines: [
            {
              kind: "add",
              text: "export function truncate(text: string, max: number): string {",
              newNo: 13,
            },
            { kind: "add", text: "  if (text.length <= max) return text;", newNo: 14 },
            { kind: "add", text: "  return text.slice(0, max - 1) + ELLIPSIS;", newNo: 15 },
            { kind: "add", text: "}", newNo: 16 },
            { kind: "add", text: "", newNo: 17 },
            {
              kind: "add",
              text: "export function excerpt(text: string, words: number): string {",
              newNo: 18,
            },
            { kind: "add", text: "  const tokens = text.split(/\\s+/).filter(Boolean);", newNo: 19 },
            {
              kind: "add",
              text: "  if (tokens.length <= words) return tokens.join(\" \");",
              newNo: 20,
            },
            { kind: "add", text: "  return tokens.slice(0, words).join(\" \") + \" \" + ELLIPSIS;", newNo: 21 },
            { kind: "add", text: "}", newNo: 22 },
            { kind: "add", text: "", newNo: 23 },
            {
              kind: "add",
              text: "// TODO(ana): handle markdown-aware truncation — currently splits on syntax.",
              newNo: 24,
            },
            { kind: "add", text: "", newNo: 25 },
            { kind: "add", text: "// `slugify('Héllo Wörld')` → 'h-llo-w-rld' is a bug we'll fix once the", newNo: 26 },
            { kind: "add", text: "// blog actually ships non-English content (next quarter, per @marco).", newNo: 27 },
          ],
        },
      ],
    },
  ],
};

const H1_ID = "cs-31/src/utils/text.ts#h1";
const H2_ID = "cs-31/src/utils/text.ts#h2";

export const INTERACTIONS_31: Record<string, Interaction[]> = {
  [hunkSummaryReplyKey(H1_ID)]: [
    {
      id: `ai:${hunkSummaryReplyKey(H1_ID)}`,
      threadKey: hunkSummaryReplyKey(H1_ID),
      target: "block",
      intent: "comment",
      author: "ai",
      authorRole: "ai",
      body:
        "slugify lowercases + collapses non-alphanumeric to dashes. ASCII-only — `slugify('Héllo Wörld')` returns 'h-llo-w-rld' rather than 'hello-world'. Try a few inputs before approving.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H1_ID, 2)]: [
    {
      id: `ai:${lineNoteReplyKey(H1_ID, 2)}`,
      threadKey: lineNoteReplyKey(H1_ID, 2),
      target: "line",
      intent: "request",
      author: "ai",
      authorRole: "ai",
      body:
        "Strips accented characters silently\n\n`/[^a-z0-9]+/g` doesn't normalise. Probe `slugify('Héllo Wörld 🎉')` — the é/ö/emoji become dashes. If posts have non-English titles this produces ugly URLs. Consider `text.normalize('NFKD').replace(/\\p{Diacritic}/gu, '')` first.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
    {
      id: "r-31-1",
      threadKey: lineNoteReplyKey(H1_ID, 2),
      target: "reply-to-ai-note",
      intent: "comment",
      author: "marco",
      authorRole: "user",
      body:
        "Confirming we're punting unicode slugs to next quarter. Please leave the comment at the bottom of the file so the next reviewer doesn't think it's a regression.",
      createdAt: "2026-04-26T11:02:00Z",
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
        "truncate appends ELLIPSIS when text.length > max — but the logic returns `text.slice(0, max - 1) + ELLIPSIS`, so a 5-char text with max=5 would still pass through unchanged. The boundary case (text.length === max) is the one to probe.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H2_ID, 0)]: [
    {
      id: `ai:${lineNoteReplyKey(H2_ID, 0)}`,
      threadKey: lineNoteReplyKey(H2_ID, 0),
      target: "line",
      intent: "question",
      author: "ai",
      authorRole: "ai",
      body:
        "Off-by-one on text.length === max?\n\n`truncate('hello', 5)` returns 'hello' (text fits). `truncate('hello!', 5)` returns 'hell…'. Likely correct — but worth probing the equal case to confirm intent matches behavior.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
  [lineNoteReplyKey(H2_ID, 7)]: [
    {
      id: `ai:${lineNoteReplyKey(H2_ID, 7)}`,
      threadKey: lineNoteReplyKey(H2_ID, 7),
      target: "line",
      intent: "comment",
      author: "ai",
      authorRole: "ai",
      body:
        "Trims original whitespace\n\nMultiple consecutive spaces collapse to one. Markdown that depends on `  ` for line breaks would lose them. Probe `excerpt('hello  world', 5)` to see.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
};

