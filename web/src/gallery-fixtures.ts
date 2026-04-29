import type { AiNote, DiffLine, ReviewPlan, ReviewState } from "./types";
import { blockCommentKey, noteKey, lineNoteReplyKey, teammateReplyKey } from "./types";
import { CHANGESETS, SEED_REPLIES } from "./fixtures";
import { initialState } from "./state";
import { planReview } from "./plan";

export interface DiffGalleryFixture {
  kind: "diff";
  name: string;
  description: string;
  state: ReviewState;
  /** The file id to focus DiffView on. */
  fileId: string;
  /** The hunk id to treat as "current". */
  hunkId: string;
  /** Cursor line within that hunk. */
  cursorLineIdx: number;
}

export interface PlanGalleryFixture {
  kind: "plan";
  name: string;
  description: string;
  plan: ReviewPlan;
}

export interface SyntaxGalleryFixture {
  kind: "syntax";
  name: string;
  description: string;
  snippets: {
    title: string;
    language: string;
    code: string;
  }[];
}

export type GalleryFixture =
  | DiffGalleryFixture
  | PlanGalleryFixture
  | SyntaxGalleryFixture;

// ── helpers ────────────────────────────────────────────────────────────────

function markLines(
  base: Record<string, Set<number>>,
  hunkId: string,
  indices: number[],
): Record<string, Set<number>> {
  const set = new Set(base[hunkId] ?? []);
  for (const i of indices) set.add(i);
  return { ...base, [hunkId]: set };
}

// ── 1. empty ───────────────────────────────────────────────────────────────
// The raw initialState for cs-42, cursor at hunk 1 line 0.
// Shows a fresh review with no lines marked, no notes acked.

const cs42 = CHANGESETS[0]; // "Add user preferences panel"
const emptyState = initialState([cs42]);

export const fixtureEmpty: GalleryFixture = {
  kind: "diff",
  name: "empty",
  description: "Initial state — nothing read, no files signed off, no notes acked.",
  state: {
    ...emptyState,
    readLines: {},
    replies: {},
  },
  fileId: cs42.files[0].id,
  hunkId: cs42.files[0].hunks[0].id,
  cursorLineIdx: 0,
};

// ── 2. mid-review ──────────────────────────────────────────────────────────
// cs-42, several lines reviewed across two hunks; one AI note acked;
// cursor parked mid-way through the second hunk (storage.ts#h2).

const storageFile = cs42.files[1]; // src/utils/storage.ts
const storageH1 = storageFile.hunks[0];
const storageH2 = storageFile.hunks[1];

const midReadLines = markLines(
  markLines({}, storageH1.id, [0, 1, 2, 3, 4]),
  storageH2.id,
  [0, 1, 2, 3, 4, 5],
);

export const fixtureMidReview: GalleryFixture = {
  kind: "diff",
  name: "mid-review",
  description:
    "Several lines read across two hunks; one AI note acked; no files signed off yet.",
  state: {
    ...emptyState,
    cursor: {
      changesetId: cs42.id,
      fileId: storageFile.id,
      hunkId: storageH2.id,
      lineIdx: 6,
    },
    readLines: midReadLines,
    ackedNotes: new Set([noteKey(storageH2.id, 6)]),
    replies: { ...SEED_REPLIES },
  },
  fileId: storageFile.id,
  hunkId: storageH2.id,
  cursorLineIdx: 6,
};

// Extra AI notes layered onto PreferencesPanel.tsx for the ai-saturated fixture.
// Existing notes in the source fixture live at lineIdx 14, 21, 26 — we don't
// override those.
const EXTRA_NOTES_BY_LINE_IDX: Record<number, AiNote> = {
  4: {
    severity: "info",
    summary: "Defaults declared inline",
    detail:
      "If SSR ever needs these values, consider lifting DEFAULTS to a config module shared between client and server.",
  },
  11: {
    severity: "warning",
    summary: "First paint uses DEFAULTS before stored prefs arrive",
    detail:
      "The useEffect runs after mount, so there is a brief flash of the default theme before loadPrefs() resolves. For theme specifically this is visible as a light/dark flicker.",
  },
  19: {
    severity: "question",
    summary: "update recreated every render",
    detail:
      "Fine if nothing downstream depends on referential identity. If a memoised child starts passing update through, you'll want useCallback.",
  },
  24: {
    severity: "warning",
    summary: "Form has no onSubmit handler",
    detail:
      "Hitting Enter inside the select triggers a full-page form submission. Either wire onSubmit={e => e.preventDefault()} or drop the <form> element entirely.",
  },
  27: {
    severity: "info",
    summary: "Controlled <select> trusts stored theme",
    detail:
      "If loadPrefs returns an unexpected theme string (e.g. schema drift), the select renders with value that doesn't match any option. Worth validating against the known enum before calling setPrefs.",
  },
};

// ── 3. ai-saturated ────────────────────────────────────────────────────────
// Synthetic variant of cs-42's PreferencesPanel hunk with extra aiNotes layered
// on, to stress-test how DiffView + Inspector handle a densely-annotated hunk.
// Gallery-local: does not mutate the shared CHANGESETS fixture.

const prefFile = cs42.files[2]; // src/components/PreferencesPanel.tsx
const prefH1 = prefFile.hunks[0];

const prefH1SaturatedLines: DiffLine[] = prefH1.lines.map((line, i) => {
  const extra = EXTRA_NOTES_BY_LINE_IDX[i];
  return extra ? { ...line, aiNote: extra } : line;
});
const prefH1Saturated = { ...prefH1, lines: prefH1SaturatedLines };
const prefFileSaturated = { ...prefFile, hunks: [prefH1Saturated] };
const cs42Saturated = {
  ...cs42,
  files: [cs42.files[0], cs42.files[1], prefFileSaturated, ...cs42.files.slice(3)],
};

const saturatedBase = initialState([cs42Saturated]);

export const fixtureAiSaturated: GalleryFixture = {
  kind: "diff",
  name: "ai-saturated",
  description:
    "Eight AI notes on one hunk across info/question/warning; three acked, five outstanding.",
  state: {
    ...saturatedBase,
    cursor: {
      changesetId: cs42Saturated.id,
      fileId: prefFileSaturated.id,
      hunkId: prefH1Saturated.id,
      lineIdx: 26,
    },
    readLines: markLines({}, prefH1Saturated.id, [0, 1, 2, 3, 10, 11, 12, 13, 14]),
    ackedNotes: new Set([
      noteKey(prefH1Saturated.id, 4), // info — acked
      noteKey(prefH1Saturated.id, 14), // info — acked
      noteKey(prefH1Saturated.id, 21), // question — acked
    ]),
    replies: {
      [lineNoteReplyKey(prefH1Saturated.id, 26)]: [
        {
          id: "g-r1",
          author: "romina",
          body:
            "Fix will probably look like this once I validate the payload:\n\n```ts\nconst next = sanitizePrefs(loadPrefs());\nsetPrefs(next);\n```",
          createdAt: "2026-04-22T12:00:00Z",
        },
      ],
    },
  },
  fileId: prefFileSaturated.id,
  hunkId: prefH1Saturated.id,
  cursorLineIdx: 26,
};

// ── 4. teammate-endorsed ───────────────────────────────────────────────────
// cs-57 auth middleware hunk — has a teammate "approve" badge from @mina plus
// an aiNote call-site annotation. Shows teammate badge + AI badge together.
//
// Note: the fixture data has two hunks with teammateReview on cs-57. We pick
// auth.ts#h2 (verdict: "approve") for the most visually interesting state.

const cs57 = CHANGESETS[1]; // "Fix race condition in session hydration"
const authFile = cs57.files[2]; // server/middleware/auth.ts
const authH2 = authFile.hunks[1];

const teammateState = initialState([cs57]);

export const fixtureTeammateEndorsed: GalleryFixture = {
  kind: "diff",
  name: "teammate-endorsed",
  description:
    "auth middleware hunk with @mina approve badge and an AI call-site note; cursor on the ensureSessionReady() line.",
  state: {
    ...teammateState,
    cursor: {
      changesetId: cs57.id,
      fileId: authFile.id,
      hunkId: authH2.id,
      lineIdx: 1,
    },
    readLines: markLines({}, authH2.id, [0, 1, 2, 3]),
    replies: {
      [teammateReplyKey(authH2.id)]: [
        {
          id: "te-r1",
          author: "dan",
          body: "Agreed — SLO gives us headroom here.",
          createdAt: "2026-04-22T10:00:00Z",
        },
      ],
    },
  },
  fileId: authFile.id,
  hunkId: authH2.id,
  cursorLineIdx: 1,
};

// ── 5. block-selection ─────────────────────────────────────────────────────
// cs-42 storage.ts#h2 — cursor on the try/catch region with shift-extended
// selection covering the full `try { … } catch` block (lines 6..11). Includes
// one block thread on that range to show the Inspector header label.

const blockHunkId = storageH2.id; // "cs-42/src/utils/storage.ts#h2"
const BLOCK_LO = 6;
const BLOCK_HI = 11;
const blockKey = blockCommentKey(blockHunkId, BLOCK_LO, BLOCK_HI);
const blockSelectionBase = initialState([cs42]);

export const fixtureBlockSelection: ReviewState = {
  ...blockSelectionBase,
  cursor: {
    changesetId: cs42.id,
    fileId: storageFile.id,
    hunkId: blockHunkId,
    lineIdx: BLOCK_HI,
  },
  selection: { hunkId: blockHunkId, anchor: BLOCK_LO, head: BLOCK_HI },
  replies: {
    [blockKey]: [
      {
        id: "b-r1",
        author: "dan",
        body: "The whole try/catch would be cleaner as a single parse-and-validate helper.",
        createdAt: "2026-04-23T10:00:00Z",
      },
    ],
  },
};

export const fixtureBlockSelectionGallery: GalleryFixture = {
  kind: "diff",
  name: "block-selection",
  description:
    "Cursor inside storage.ts#h2 with a shift-extended selection across the try/catch; one block comment thread attached.",
  state: fixtureBlockSelection,
  fileId: storageFile.id,
  hunkId: blockHunkId,
  cursorLineIdx: BLOCK_HI,
};

// ── 6. file-reviewed ───────────────────────────────────────────────────────
// All hunks of storage.ts read end-to-end and the file signed off via
// Shift+M. Shows the green path-header badge, the row tint, and the
// soft green wash across the diff body.

const reviewedAllReadLines = (() => {
  let acc: Record<string, Set<number>> = {};
  for (const h of storageFile.hunks) {
    acc = markLines(
      acc,
      h.id,
      Array.from({ length: h.lines.length }, (_, i) => i),
    );
  }
  return acc;
})();

export const fixtureFileReviewed: GalleryFixture = {
  kind: "diff",
  name: "file-reviewed",
  description:
    "storage.ts read in full and signed off via Shift+M — green badge in the path, green check + tint on the sidebar row, soft green wash across the diff.",
  state: {
    ...emptyState,
    cursor: {
      changesetId: cs42.id,
      fileId: storageFile.id,
      hunkId: storageH1.id,
      lineIdx: 0,
    },
    readLines: reviewedAllReadLines,
    reviewedFiles: new Set([storageFile.id]),
    replies: { ...SEED_REPLIES },
  },
  fileId: storageFile.id,
  hunkId: storageH1.id,
  cursorLineIdx: 0,
};

// ── 7. plan (rule-based) ───────────────────────────────────────────────────
// The "where to begin" screen for cs-42, computed deterministically from the
// parsed ChangeSet (no AI). Shows the intent/map/entry-points layout with
// every claim citing a source.

export const fixturePlanRule: PlanGalleryFixture = {
  kind: "plan",
  name: "plan-rule",
  description:
    "Review plan for cs-42 using rule-based intent (no AI); claims cite description, symbols, or files.",
  plan: planReview(cs42),
};

// ── export all ─────────────────────────────────────────────────────────────

export const ALL_FIXTURES: GalleryFixture[] = [
  {
    kind: "syntax",
    name: "syntax-highlighting",
    description:
      "Shiki-based code rendering previewed in explicit light and dark surfaces.",
    snippets: [
      {
        title: "TypeScript",
        language: "ts",
        code:
          "export function clamp(value: number, min: number, max: number) {\n  return Math.min(max, Math.max(min, value));\n}",
      },
      {
        title: "JavaScript",
        language: "js",
        code:
          "const submit = async (payload) => {\n  const res = await fetch('/api/review', {\n    method: 'POST',\n    body: JSON.stringify(payload),\n  });\n  return res.json();\n};",
      },
      {
        title: "PHP",
        language: "php",
        code:
          "<?php\nfunction load_prefs(array $defaults, array $input): array {\n    return [\n        'theme' => $input['theme'] ?? $defaults['theme'],\n        'density' => $input['density'] ?? $defaults['density'],\n    ];\n}\n",
      },
      {
        title: "Diff",
        language: "diff",
        code:
          "@@ -12,7 +12,8 @@\n-const prefs = loadPrefs();\n+const raw = loadPrefs();\n+const prefs = sanitizePrefs(raw);\n renderPanel(prefs);\n",
      },
    ],
  },
  fixturePlanRule,
  fixtureEmpty,
  fixtureMidReview,
  fixtureFileReviewed,
  fixtureBlockSelectionGallery,
  fixtureAiSaturated,
  fixtureTeammateEndorsed,
];
