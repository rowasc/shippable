// The read seam for the typed-review-interactions model. A private helper,
// `projectByThread`, owns the single walk of state.interactions (plus the
// detached bucket) and groups by threadKey. Two public selectors build on it:
//
// - `selectInteractions` adds the cross-thread `byIntent` and `threads`
//   indexes. The path the inbox view and `n`/`N` walk will read.
// - `selectIngestSignals` reprojects the per-thread lists into the per-line /
//   per-hunk lookups view-model builders need to render AI notes, hunk
//   summaries, and teammate badges.
//
// See docs/plans/typed-review-interactions.md § Cross-thread aggregation.

import type {
  AskIntent,
  Interaction,
  InteractionIntent,
  ResponseIntent,
  ReviewState,
} from "./types";
import { isAskIntent, isResponseIntent } from "./types";

export interface ThreadSummary {
  threadKey: string;
  /** Intent of the latest ask-intent interaction. Always present (every thread starts with an ask). */
  currentAsk: AskIntent;
  /** Intent of the first interaction in the thread. Always an ask. */
  originalAsk: AskIntent;
  /**
   * Latest response intent (rolled up across authors). `unack` cancels the
   * author's prior `ack` and resolves to null at the thread level.
   */
  currentResponse: Exclude<ResponseIntent, "unack"> | null;
  interactions: Interaction[];
}

export interface InteractionSelection {
  all: Interaction[];
  byIntent: Record<InteractionIntent, Interaction[]>;
  byThreadKey: Record<string, Interaction[]>;
  threads: ThreadSummary[];
}

/**
 * Project every interaction in `state.interactions` (plus the detached
 * bucket) into a single indexed view. Pure function of `state`.
 */
export function selectInteractions(state: ReviewState): InteractionSelection {
  const { all, byThreadKey } = projectByThread(state);

  const byIntent = emptyByIntent();
  for (const ix of all) byIntent[ix.intent].push(ix);

  const threads: ThreadSummary[] = [];
  for (const [threadKey, interactions] of Object.entries(byThreadKey)) {
    threads.push(summariseThread(threadKey, interactions));
  }

  return { all, byIntent, byThreadKey, threads };
}

/**
 * Shared first pass: collect every interaction (store + detached bucket) and
 * group by thread, sorted by `createdAt`. Both `selectInteractions` and
 * `selectIngestSignals` build on this; the heavier `byIntent` / `threads`
 * indexes only get computed when a caller actually wants them.
 */
function projectByThread(state: ReviewState): {
  all: Interaction[];
  byThreadKey: Record<string, Interaction[]>;
} {
  const all: Interaction[] = [];
  for (const list of Object.values(state.interactions)) {
    for (const ix of list) all.push(ix);
  }
  for (const d of state.detachedInteractions) all.push(d.interaction);

  const byThreadKey: Record<string, Interaction[]> = {};
  for (const ix of all) {
    (byThreadKey[ix.threadKey] ??= []).push(ix);
  }
  for (const list of Object.values(byThreadKey)) {
    list.sort(compareByCreatedAt);
  }

  return { all, byThreadKey };
}

// ── Ingest signal lookups (view-side) ────────────────────────────────────

/** What the view needs to render an AI per-line note. */
export interface AiNoteSignal {
  /** Maps to `intent`: comment → info, question → question, request → warning. */
  severity: "info" | "question" | "warning";
  /** First line of the interaction body — the headline shown on the badge. */
  summary: string;
  /** Remaining body lines (joined with `\n\n` on the seam) — Inspector detail. */
  detail?: string;
  runRecipe?: { source: string; inputs: Record<string, string> };
}

export interface TeammateSignal {
  user: string;
  verdict: "approve" | "comment";
  note?: string;
}

export interface IngestSignals {
  /** keyed by `${hunkId}:${lineIdx}` — same shape as `noteKey()` */
  aiNoteByLine: Record<string, AiNoteSignal>;
  /** keyed by hunkId */
  aiSummaryByHunk: Record<string, string>;
  /** keyed by hunkId */
  teammateByHunk: Record<string, TeammateSignal>;
}

/**
 * Project the AI / teammate Interactions into per-line / per-hunk lookups
 * for the render layer. The view-model builders consume these instead of
 * reading `line.aiNote`, `hunk.aiSummary`, `hunk.teammateReview` (those
 * fields no longer exist).
 *
 * Shares the `projectByThread` first pass with `selectInteractions`, so the
 * store is walked the same way for both — without paying for the heavier
 * `byIntent` / `threads` indexes the ingest path doesn't need.
 *
 * Only the *first* AI-authored interaction on a note: / hunkSummary: key is
 * used — subsequent entries on the same key are replies, not annotations.
 * Same for teammate keys.
 */
export function selectIngestSignals(state: ReviewState): IngestSignals {
  const aiNoteByLine: Record<string, AiNoteSignal> = {};
  const aiSummaryByHunk: Record<string, string> = {};
  const teammateByHunk: Record<string, TeammateSignal> = {};

  const { byThreadKey } = projectByThread(state);
  for (const [threadKey, list] of Object.entries(byThreadKey)) {
    if (list.length === 0) continue;

    if (threadKey.startsWith("note:")) {
      const ai = list.find((ix) => ix.authorRole === "ai");
      if (!ai) continue;
      const lookupKey = threadKey.slice("note:".length); // `${hunkId}:${lineIdx}`
      aiNoteByLine[lookupKey] = toAiNoteSignal(ai, intentToSeverity(ai.intent));
      continue;
    }

    if (threadKey.startsWith("hunkSummary:")) {
      const ai = list.find((ix) => ix.authorRole === "ai");
      if (!ai) continue;
      aiSummaryByHunk[threadKey.slice("hunkSummary:".length)] = ai.body;
      continue;
    }

    if (threadKey.startsWith("teammate:")) {
      const teammate = list.find((ix) => ix.authorRole === "teammate");
      if (!teammate) continue;
      teammateByHunk[threadKey.slice("teammate:".length)] = {
        user: teammate.author,
        verdict: teammate.intent === "ack" ? "approve" : "comment",
        note: teammate.body || undefined,
      };
    }
  }

  return { aiNoteByLine, aiSummaryByHunk, teammateByHunk };
}

function toAiNoteSignal(
  ix: Interaction,
  severity: AiNoteSignal["severity"],
): AiNoteSignal {
  // The seam packs detail behind a blank line in the body. Split it back out
  // so the inspector can render summary + detail separately.
  const blankLine = ix.body.indexOf("\n\n");
  const summary = blankLine >= 0 ? ix.body.slice(0, blankLine) : ix.body;
  const detail =
    blankLine >= 0 ? ix.body.slice(blankLine + 2) || undefined : undefined;
  const out: AiNoteSignal = { severity, summary };
  if (detail) out.detail = detail;
  if (ix.runRecipe) out.runRecipe = ix.runRecipe;
  return out;
}

function intentToSeverity(intent: InteractionIntent): AiNoteSignal["severity"] {
  if (intent === "question") return "question";
  if (intent === "request" || intent === "blocker") return "warning";
  return "info";
}

// ── Thread summary derivation ────────────────────────────────────────────

function summariseThread(threadKey: string, interactions: Interaction[]): ThreadSummary {
  const asks = interactions.filter((ix) => isAskIntent(ix.intent));
  // The first interaction is the thread head; AI/teammate annotations always
  // qualify as asks, and user-started threads always begin with an ask too.
  const originalAsk = (asks[0]?.intent ?? "comment") as AskIntent;
  const currentAsk = (asks[asks.length - 1]?.intent ?? originalAsk) as AskIntent;
  const currentResponse = deriveCurrentResponse(interactions);
  return { threadKey, currentAsk, originalAsk, currentResponse, interactions };
}

/**
 * Latest per-author response, rolled up across the thread. `unack` cancels
 * an author's prior `ack`, dropping them out of the rollup. The thread-level
 * `currentResponse` is the latest non-cancelled response across all authors.
 */
function deriveCurrentResponse(
  interactions: Interaction[],
): Exclude<ResponseIntent, "unack"> | null {
  // Reverse-walk by author so we honour append-only semantics: the last
  // entry per author wins, unless it's `unack`.
  const latestByAuthor = new Map<string, Interaction>();
  for (const ix of interactions) {
    if (!isResponseIntent(ix.intent)) continue;
    latestByAuthor.set(ix.author, ix);
  }
  // Pick the latest across authors that isn't `unack`.
  let winner: Interaction | null = null;
  for (const ix of latestByAuthor.values()) {
    if (ix.intent === "unack") continue;
    if (!winner || compareByCreatedAt(winner, ix) < 0) winner = ix;
  }
  if (!winner) return null;
  return winner.intent as Exclude<ResponseIntent, "unack">;
}

function compareByCreatedAt(a: Interaction, b: Interaction): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function emptyByIntent(): Record<InteractionIntent, Interaction[]> {
  return {
    comment: [],
    question: [],
    request: [],
    blocker: [],
    ack: [],
    unack: [],
    accept: [],
    reject: [],
  };
}
