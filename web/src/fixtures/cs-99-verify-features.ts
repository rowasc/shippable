import type { ChangeSet, DiffLine, Reply } from "../types";
import {
  blockCommentKey,
  hunkSummaryReplyKey,
  lineNoteReplyKey,
  teammateReplyKey,
  userCommentKey,
} from "../types";

// Verification fixture: one ChangeSet that exercises every reviewable feature
// across the four languages we care about (TS, JS, MD, PHP). Use this when
// you need to eyeball a feature end-to-end without hopping between fixtures.
//
// Coverage matrix (one row per feature):
//   aiNote info           — strings.ts h1
//   aiNote question       — auth.php h1
//   aiNote warning        — auth.php h1, strings.ts h2
//   runRecipe (PHP)       — auth.php h1   (verify timing-leak claim)
//   runRecipe (TS)        — strings.ts h2 (verify slugify edge case)
//   runRecipe (JS)        — format.js h1  (verify NaN currency claim)
//   aiSummary+aiReviewed  — auth.php h1, strings.ts h1, strings.ts h2
//   definesSymbols        — auth.php h1, strings.ts h1
//   referencesSymbols     — strings.ts h2, format.js h1
//   expandAbove           — strings.ts h2
//   expandBelow           — strings.ts h1
//   teammateReview        — auth.php h1
//   imageAssets           — preview.md (relative SVG)
//   status: added         — auth.php, preview.md
//   status: modified      — strings.ts, format.js
//   status: deleted       — legacy.php
//   status: renamed       — README.md (renamed from docs/intro.md)
//   reply on line note    — strings.ts h2
//   reply on hunk summary — auth.php h1
//   reply on teammate     — auth.php h1
//   reply on user comment — strings.ts h1 (single line)
//   reply on block comment— format.js h1 (multi-line)

// ── PHP added (rich feature surface) ──────────────────────────────────────

const AUTH_LINES_H1: DiffLine[] = [
  { kind: "add", text: "<?php", newNo: 1 },
  { kind: "add", text: "// Token comparison helpers used by the session layer.", newNo: 2 },
  { kind: "add", text: "", newNo: 3 },
  {
    kind: "add",
    text: "function compare_tokens($expected, $given) {",
    newNo: 4,
    aiNote: {
      severity: "warning",
      summary: "Non-constant-time comparison",
      detail:
        "`==` short-circuits at the first mismatched byte, leaking length and prefix-match timing. Use `hash_equals` for any token comparison.",
      runRecipe: {
        source: [
          "function compare_tokens($expected, $given) {",
          "  return $expected == $given;",
          "}",
          "",
          "echo compare_tokens($expected, $given) ? 'match' : 'no match';",
        ].join("\n"),
        inputs: { expected: "abc123", given: "abc124" },
      },
    },
  },
  { kind: "add", text: "  return $expected == $given;", newNo: 5 },
  { kind: "add", text: "}", newNo: 6 },
  { kind: "add", text: "", newNo: 7 },
  {
    kind: "add",
    text: "function issue_token($user_id) {",
    newNo: 8,
    aiNote: {
      severity: "question",
      summary: "Entropy source?",
      detail:
        "`uniqid` is time-based and predictable. Worth confirming whether this token is privileged or just a correlation id.",
    },
  },
  { kind: "add", text: "  return uniqid('tok_', true);", newNo: 9 },
  { kind: "add", text: "}", newNo: 10 },
];

const AUTH_LINES_H2: DiffLine[] = [
  { kind: "add", text: "function revoke_token($id) {", newNo: 12 },
  { kind: "add", text: "  global $tokens;", newNo: 13 },
  { kind: "add", text: "  unset($tokens[$id]);", newNo: 14 },
  { kind: "add", text: "  return true;", newNo: 15 },
  { kind: "add", text: "}", newNo: 16 },
];

// ── TS modified (mixed add/del/context, expand context, runRecipe) ────────

const STRINGS_OLD = [
  "// Tiny string utilities used across the UI.",
  "",
  "export function trimEnd(s: string, ch: string): string {",
  "  while (s.endsWith(ch)) s = s.slice(0, -ch.length);",
  "  return s;",
  "}",
  "",
  "export function pad(s: string, n: number): string {",
  "  return s.length >= n ? s : s + ' '.repeat(n - s.length);",
  "}",
  "",
  "export function slugify(s: string): string {",
  "  return s.toLowerCase().replace(/ /g, '-');",
  "}",
  "",
];

const STRINGS_NEW = [
  "// Tiny string utilities used across the UI.",
  "",
  "export function trimEnd(s: string, ch: string): string {",
  "  while (s.endsWith(ch)) s = s.slice(0, -ch.length);",
  "  return s;",
  "}",
  "",
  "export function padRight(s: string, n: number, ch = ' '): string {",
  "  return s.length >= n ? s : s + ch.repeat(n - s.length);",
  "}",
  "",
  "export function slugify(s: string): string {",
  "  return s",
  "    .toLowerCase()",
  "    .replace(/[^a-z0-9]+/g, '-')",
  "    .replace(/(^-|-$)/g, '');",
  "}",
  "",
  "export function titleCase(s: string): string {",
  "  return slugify(s)",
  "    .split('-')",
  "    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))",
  "    .join(' ');",
  "}",
  "",
];

// ── JS modified (renamed-from style is for README.md; this one stays put) ─

const FORMAT_LINES_H1: DiffLine[] = [
  { kind: "context", text: "// Cart formatting helpers (legacy JS — slated for TS migration).", oldNo: 1, newNo: 1 },
  { kind: "context", text: "", oldNo: 2, newNo: 2 },
  { kind: "context", text: "function formatCents(cents) {", oldNo: 3, newNo: 3 },
  { kind: "del", text: "  return '$' + (cents / 100).toFixed(2);", oldNo: 4 },
  {
    kind: "add",
    text: "  return '$' + (Number(cents) / 100).toFixed(2);",
    newNo: 4,
    aiNote: {
      severity: "info",
      summary: "Coerce-then-divide handles string inputs",
      detail:
        "Catches the `formatCents('199')` callers from the checkout form. The runner shows the old version produced `NaN` for them.",
      runRecipe: {
        source: [
          "function formatCents(cents) {",
          "  return '$' + (cents / 100).toFixed(2);",
          "}",
          "",
          "console.log(formatCents(cents));",
        ].join("\n"),
        inputs: { cents: "'199'" },
      },
    },
  },
  { kind: "context", text: "}", oldNo: 5, newNo: 5 },
  { kind: "context", text: "", oldNo: 6, newNo: 6 },
  { kind: "context", text: "function formatLineItem(item) {", oldNo: 7, newNo: 7 },
  { kind: "del", text: "  return item.name + ' — ' + formatCents(item.price);", oldNo: 8 },
  { kind: "add", text: "  return item.name + ' — ' + formatCents(item.priceCents);", newNo: 8 },
  { kind: "context", text: "}", oldNo: 9, newNo: 9 },
];

// ── MD added (preview, image asset) ───────────────────────────────────────

const PREVIEW_DOC_LINES = `# Verify-features fixture

This page is rendered by the markdown preview. Switch to **Preview** to confirm:

| Element        | Status        |
| -------------- | ------------- |
| Tables         | ✅ supported  |
| Task lists     | ✅ supported  |
| Alerts         | ✅ supported  |
| Code blocks    | ✅ Shiki      |
| Inline image   | ↓ below       |

- [x] Headings render at the right size
- [x] Code blocks pick up syntax highlighting
- [ ] Image resolves from the changeset's \`imageAssets\` map

\`\`\`ts
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
\`\`\`

> [!NOTE]
> The image below is a relative reference; the preview pane resolves it
> against \`imageAssets\` rather than fetching from the network.

![Verify badge](./assets/verify-badge.svg)
`.split("\n");

const VERIFY_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80">
  <rect width="240" height="80" rx="8" fill="#0d1117"/>
  <rect x="6" y="6" width="228" height="68" rx="6" fill="none" stroke="#30363d"/>
  <text x="20" y="36" font-family="ui-monospace, monospace" font-size="14" fill="#7ee787">verify-features</text>
  <text x="20" y="58" font-family="ui-monospace, monospace" font-size="11" fill="#c9d1d9">ts · js · md · php</text>
</svg>`;

const VERIFY_BADGE_DATA_URL =
  "data:image/svg+xml;utf8," + encodeURIComponent(VERIFY_BADGE_SVG);

// ── MD renamed (docs/intro.md → README.md, with a small content tweak) ────

const README_LINES_H1: DiffLine[] = [
  { kind: "context", text: "# Verify fixture", oldNo: 1, newNo: 1 },
  { kind: "context", text: "", oldNo: 2, newNo: 2 },
  { kind: "del", text: "Intro to the verify fixture (under docs/).", oldNo: 3 },
  { kind: "add", text: "Top-level README for the verify fixture.", newNo: 3 },
  { kind: "context", text: "", oldNo: 4, newNo: 4 },
  { kind: "context", text: "See `docs/preview-demo.md` for the preview pane tour.", oldNo: 5, newNo: 5 },
];

// ── PHP deleted (full removal) ────────────────────────────────────────────

const LEGACY_LINES_H1: DiffLine[] = [
  { kind: "del", text: "<?php", oldNo: 1 },
  { kind: "del", text: "// Old session helper — replaced by lib/auth.php.", oldNo: 2 },
  { kind: "del", text: "function legacy_token() {", oldNo: 3 },
  { kind: "del", text: "  return md5(microtime());", oldNo: 4 },
  { kind: "del", text: "}", oldNo: 5 },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function fullForAdded(lines: string[]): DiffLine[] {
  return lines.map((text, i) => ({ kind: "add", text, newNo: i + 1 }));
}

function fullForStringsNew(): DiffLine[] {
  return STRINGS_NEW.map((text, i) => ({ kind: "add", text, newNo: i + 1 }));
}

// ── ChangeSet ─────────────────────────────────────────────────────────────

export const CS_99: ChangeSet = {
  id: "cs-99",
  title: "Verify every reviewer feature in one diff",
  author: "qa-bot",
  branch: "samples/verify-features",
  base: "main",
  createdAt: "2026-05-04T09:00:00Z",
  description:
    "Synthetic changeset that bundles TS, JS, MD, and PHP files together so a reviewer can step through and confirm every feature (AI notes, run-recipes, symbol nav, expand-context, replies, preview, statuses) without juggling fixtures.",
  files: [
    // ─── lib/auth.php (added) ────────────────────────────────────────────
    {
      id: "cs-99/lib/auth.php",
      path: "lib/auth.php",
      language: "php",
      status: "added",
      hunks: [
        {
          id: "cs-99/lib/auth.php#h1",
          header: "@@ -0,0 +1,10 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 10,
          definesSymbols: ["compare_tokens", "issue_token"],
          aiReviewed: true,
          aiSummary:
            "compare_tokens uses `==` — that's a timing-leak in any token-comparison context. issue_token uses uniqid which is time-based; fine for a correlation id, not for anything privileged.",
          teammateReview: {
            user: "marco",
            verdict: "comment",
            note: "Approved everything except compare_tokens — please switch to hash_equals before this lands.",
          },
          lines: AUTH_LINES_H1,
        },
        {
          id: "cs-99/lib/auth.php#h2",
          header: "@@ -0,0 +12,5 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 12,
          newCount: 5,
          definesSymbols: ["revoke_token"],
          expandAbove: [
            [
              { kind: "context", text: "}", oldNo: 10, newNo: 10 },
              { kind: "context", text: "", oldNo: 11, newNo: 11 },
            ],
          ],
          lines: AUTH_LINES_H2,
        },
      ],
      fullContent: [
        ...AUTH_LINES_H1,
        { kind: "add", text: "", newNo: 11 },
        ...AUTH_LINES_H2,
      ],
    },

    // ─── web/src/utils/strings.ts (modified) ─────────────────────────────
    {
      id: "cs-99/web/src/utils/strings.ts",
      path: "web/src/utils/strings.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-99/web/src/utils/strings.ts#h1",
          header: "@@ -8,3 +8,3 @@",
          oldStart: 8,
          oldCount: 3,
          newStart: 8,
          newCount: 3,
          definesSymbols: ["padRight"],
          aiReviewed: true,
          aiSummary:
            "Renaming pad → padRight clarifies direction. Default ch='' is unchanged. No callers outside this file (verified with grep).",
          expandBelow: [
            [
              { kind: "context", text: "", oldNo: 11, newNo: 11 },
              { kind: "context", text: "export function slugify(s: string): string {", oldNo: 12, newNo: 12 },
            ],
          ],
          lines: [
            {
              kind: "del",
              text: "export function pad(s: string, n: number): string {",
              oldNo: 8,
              aiNote: {
                severity: "info",
                summary: "Renamed to padRight",
                detail:
                  "The old name was ambiguous about direction. No external callers, so this is a safe rename.",
              },
            },
            { kind: "del", text: "  return s.length >= n ? s : s + ' '.repeat(n - s.length);", oldNo: 9 },
            { kind: "del", text: "}", oldNo: 10 },
            { kind: "add", text: "export function padRight(s: string, n: number, ch = ' '): string {", newNo: 8 },
            { kind: "add", text: "  return s.length >= n ? s : s + ch.repeat(n - s.length);", newNo: 9 },
            { kind: "add", text: "}", newNo: 10 },
          ],
        },
        {
          id: "cs-99/web/src/utils/strings.ts#h2",
          header: "@@ -12,3 +12,11 @@",
          oldStart: 12,
          oldCount: 3,
          newStart: 12,
          newCount: 11,
          definesSymbols: ["titleCase"],
          referencesSymbols: ["slugify"],
          aiReviewed: true,
          aiSummary:
            "slugify becomes Unicode-stricter (drops anything non-[a-z0-9]). Existing callers passing pre-cleaned ASCII keep working; emoji/CJK inputs that previously round-tripped will now collapse to '-'.",
          expandAbove: [
            [
              { kind: "context", text: "}", oldNo: 10, newNo: 10 },
              { kind: "context", text: "", oldNo: 11, newNo: 11 },
            ],
            [
              { kind: "context", text: "// Tiny string utilities used across the UI.", oldNo: 1, newNo: 1 },
              { kind: "context", text: "", oldNo: 2, newNo: 2 },
              { kind: "context", text: "export function trimEnd(s: string, ch: string): string {", oldNo: 3, newNo: 3 },
              { kind: "context", text: "  while (s.endsWith(ch)) s = s.slice(0, -ch.length);", oldNo: 4, newNo: 4 },
              { kind: "context", text: "  return s;", oldNo: 5, newNo: 5 },
              { kind: "context", text: "}", oldNo: 6, newNo: 6 },
              { kind: "context", text: "", oldNo: 7, newNo: 7 },
            ],
          ],
          lines: [
            { kind: "del", text: "export function slugify(s: string): string {", oldNo: 12 },
            { kind: "del", text: "  return s.toLowerCase().replace(/ /g, '-');", oldNo: 13 },
            { kind: "del", text: "}", oldNo: 14 },
            { kind: "add", text: "export function slugify(s: string): string {", newNo: 12 },
            { kind: "add", text: "  return s", newNo: 13 },
            {
              kind: "add",
              text: "    .toLowerCase()",
              newNo: 14,
              aiNote: {
                severity: "warning",
                summary: "Locale-sensitive lower-case",
                detail:
                  "`toLowerCase` without a locale silently mangles Turkish dotted-i (`İ` → `i̇`). Try `slugify('İstanbul')` in the runner — output is `i-stanbul`, not `istanbul`.",
                runRecipe: {
                  source: [
                    "function slugify(s) {",
                    "  return s",
                    "    .toLowerCase()",
                    "    .replace(/[^a-z0-9]+/g, '-')",
                    "    .replace(/(^-|-$)/g, '');",
                    "}",
                    "",
                    "console.log(slugify(input));",
                  ].join("\n"),
                  inputs: { input: "'İstanbul'" },
                },
              },
            },
            { kind: "add", text: "    .replace(/[^a-z0-9]+/g, '-')", newNo: 15 },
            { kind: "add", text: "    .replace(/(^-|-$)/g, '');", newNo: 16 },
            { kind: "add", text: "}", newNo: 17 },
            { kind: "add", text: "", newNo: 18 },
            { kind: "add", text: "export function titleCase(s: string): string {", newNo: 19 },
            { kind: "add", text: "  return slugify(s)", newNo: 20 },
            { kind: "add", text: "    .split('-')", newNo: 21 },
            { kind: "add", text: "    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))", newNo: 22 },
          ],
        },
      ],
      fullContent: fullForStringsNew(),
    },

    // ─── web/legacy/format.js (modified) ─────────────────────────────────
    {
      id: "cs-99/web/legacy/format.js",
      path: "web/legacy/format.js",
      language: "js",
      status: "modified",
      hunks: [
        {
          id: "cs-99/web/legacy/format.js#h1",
          header: "@@ -1,9 +1,9 @@",
          oldStart: 1,
          oldCount: 9,
          newStart: 1,
          newCount: 9,
          referencesSymbols: ["formatCents"],
          aiReviewed: true,
          aiSummary:
            "Two real fixes packed into one hunk: coerce string-cents callers (the runner shows the old version returns NaN for `formatCents('199')`), and rename `item.price` → `item.priceCents` to match the new cart shape.",
          lines: FORMAT_LINES_H1,
        },
      ],
    },

    // ─── docs/preview-demo.md (added) ────────────────────────────────────
    {
      id: "cs-99/docs/preview-demo.md",
      path: "docs/preview-demo.md",
      language: "markdown",
      status: "added",
      hunks: [
        {
          id: "cs-99/docs/preview-demo.md#h1",
          header: `@@ -0,0 +1,${PREVIEW_DOC_LINES.length} @@`,
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: PREVIEW_DOC_LINES.length,
          aiReviewed: true,
          aiSummary:
            "New documentation page; switch to Preview to confirm tables, alerts, code, and the inline SVG render before signing off.",
          lines: PREVIEW_DOC_LINES.map((text, i) => ({
            kind: "add",
            text,
            newNo: i + 1,
          })),
        },
      ],
      fullContent: fullForAdded(PREVIEW_DOC_LINES),
    },

    // ─── README.md (renamed from docs/intro.md) ──────────────────────────
    {
      id: "cs-99/README.md",
      path: "README.md",
      language: "markdown",
      status: "renamed",
      hunks: [
        {
          id: "cs-99/README.md#h1",
          header: "@@ -1,5 +1,5 @@",
          oldStart: 1,
          oldCount: 5,
          newStart: 1,
          newCount: 5,
          lines: README_LINES_H1,
        },
      ],
      fullContent: README_LINES_H1,
    },

    // ─── lib/legacy_session.php (deleted) ────────────────────────────────
    {
      id: "cs-99/lib/legacy_session.php",
      path: "lib/legacy_session.php",
      language: "php",
      status: "deleted",
      hunks: [
        {
          id: "cs-99/lib/legacy_session.php#h1",
          header: "@@ -1,5 +0,0 @@",
          oldStart: 1,
          oldCount: 5,
          newStart: 0,
          newCount: 0,
          lines: LEGACY_LINES_H1,
        },
      ],
    },
  ],
  imageAssets: {
    "docs/assets/verify-badge.svg": VERIFY_BADGE_DATA_URL,
  },
};

// Suppress unused-warning for the OLD content; kept above for readability.
void STRINGS_OLD;

// ── Seed replies (one per reply-key kind) ─────────────────────────────────

export const REPLIES_99: Record<string, Reply[]> = {
  // Reply on a line-level AI note.
  [lineNoteReplyKey("cs-99/web/src/utils/strings.ts#h2", 5)]: [
    {
      id: "r-99-line",
      author: "qa-bot",
      body:
        "Confirmed — the runner returns 'i-stanbul'. Filed a follow-up to use a locale-aware slugger; not blocking this PR since no current callers pass non-ASCII.",
      createdAt: "2026-05-04T10:15:00Z",
    },
  ],

  // Reply attached to a hunk-level AI summary (no specific line).
  [hunkSummaryReplyKey("cs-99/lib/auth.php#h1")]: [
    {
      id: "r-99-summary",
      author: "ines",
      body:
        "Both AI calls land. compare_tokens → hash_equals is non-negotiable for me; the issue_token question we can answer once we know if these tokens grant any capability.",
      createdAt: "2026-05-04T10:22:00Z",
    },
  ],

  // Reply addressed to the teammate (marco) review.
  [teammateReplyKey("cs-99/lib/auth.php#h1")]: [
    {
      id: "r-99-teammate",
      author: "qa-bot",
      body:
        "Agree with marco — going to gate this on hash_equals before merging.",
      createdAt: "2026-05-04T10:24:00Z",
    },
  ],

  // Single-line user-started comment.
  [userCommentKey("cs-99/web/src/utils/strings.ts#h1", 0)]: [
    {
      id: "r-99-user",
      author: "qa-bot",
      body: "Quick rename — flagging just so reviewers double-check the call sites.",
      createdAt: "2026-05-04T10:30:00Z",
    },
  ],

  // Multi-line block comment (lines 3..7 in format.js#h1).
  [blockCommentKey("cs-99/web/legacy/format.js#h1", 3, 7)]: [
    {
      id: "r-99-block",
      author: "qa-bot",
      body:
        "Range comment covering the formatCents fix and its caller — confirmed both halves with the runner.",
      createdAt: "2026-05-04T10:32:00Z",
    },
  ],
};
