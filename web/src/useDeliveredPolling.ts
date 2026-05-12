// Polls /api/agent/delivered while the panel is mounted AND the tab is
// visible. Both gates required; either one false stops polling. See
// docs/sdd/agent-reply-support/spec.md for why per-comment outstanding
// gates are unsound under multi-reply.
//
// The hook is the visual heartbeat for the queue substrate: it flips
// `◌ queued` pips to `✓ delivered` once the agent fetches a comment and
// drives the panel-level "Delivered (N)" block + failure banner.
//
// Behavior contract:
//   - One immediate fetch on mount; then every POLL_INTERVAL_MS while the
//     tab is visible.
//   - Tab visibility transitions: hide → pause; show → one immediate
//     catch-up poll, then resume the interval.
//   - Errors do NOT throw. They flip `error` to true and freeze the
//     `delivered` array in its last-known state until a successful poll
//     overwrites both.
//   - Tests can inject `fetcher` and a fake `setInterval`/clock.

import { useEffect, useRef, useState } from "react";
import { fetchAgentComments, fetchDelivered } from "./agentContextClient";
import type { PolledAgentReply } from "./state";
import type { AgentComment, DeliveredComment } from "./types";

/** Match the existing AgentContextSection cadence. */
export const POLL_INTERVAL_MS = 2000;

export interface DeliveredPollingResult {
  delivered: DeliveredComment[];
  /**
   * Polled agent replies (flat list with `commentId` on each entry). The
   * caller dispatches `MERGE_AGENT_REPLIES` with this on change so the
   * reducer reconciles into the matching reviewer Reply's `agentReplies`.
   * Derived from the `parent`-shaped entries in the polled `AgentComment[]`.
   */
  agentReplies: PolledAgentReply[];
  /**
   * Top-level agent comments (anchor-shaped). The caller dispatches
   * `MERGE_AGENT_COMMENTS` to fold them into `state.agentComments`.
   * Derived from the `anchor`-shaped entries in the polled `AgentComment[]`.
   */
  agentComments: AgentComment[];
  /** ISO of the last successful fetch; null until the first one lands. */
  lastSuccessfulPollAt: string | null;
  /** True iff the most recent fetch errored. */
  error: boolean;
}

export interface UseDeliveredPollingArgs {
  /**
   * The active worktree path. `null` disables the hook entirely (no
   * worktree loaded → no panel → no polling).
   */
  worktreePath: string | null;
  /**
   * Override the delivered-comments fetcher. Defaults to the real
   * `fetchDelivered` from `agentContextClient`.
   */
  fetcher?: (worktreePath: string) => Promise<DeliveredComment[]>;
  /**
   * Override the agent-comments fetcher. Defaults to the real
   * `fetchAgentComments` from `agentContextClient`. Returns the mixed
   * `AgentComment[]` wire shape; the hook splits by discriminator.
   */
  commentsFetcher?: (worktreePath: string) => Promise<AgentComment[]>;
}

/**
 * Split a polled `AgentComment[]` into (a) reply-shaped entries translated
 * to the flat `PolledAgentReply` wire shape consumed by `mergeAgentReplies`,
 * and (b) anchor-shaped entries kept as-is for `mergeAgentComments`.
 */
function splitAgentComments(
  comments: AgentComment[],
): { replies: PolledAgentReply[]; topLevel: AgentComment[] } {
  const replies: PolledAgentReply[] = [];
  const topLevel: AgentComment[] = [];
  for (const c of comments) {
    if (c.parent !== undefined) {
      const polled: PolledAgentReply = {
        id: c.id,
        body: c.body,
        outcome: c.parent.outcome,
        postedAt: c.postedAt,
        commentId: c.parent.commentId,
      };
      if (c.agentLabel !== undefined) polled.agentLabel = c.agentLabel;
      replies.push(polled);
    } else if (c.anchor !== undefined) {
      topLevel.push(c);
    }
  }
  return { replies, topLevel };
}

export function useDeliveredPolling({
  worktreePath,
  fetcher = fetchDelivered,
  commentsFetcher = fetchAgentComments,
}: UseDeliveredPollingArgs): DeliveredPollingResult {
  const [delivered, setDelivered] = useState<DeliveredComment[]>([]);
  const [agentReplies, setAgentReplies] = useState<PolledAgentReply[]>([]);
  const [agentComments, setAgentComments] = useState<AgentComment[]>([]);
  const [lastSuccessfulPollAt, setLastSuccessfulPollAt] = useState<
    string | null
  >(null);
  const [error, setError] = useState(false);

  // "Adjusting state during render" — same pattern App.tsx uses for the
  // agent-context fetch. When `worktreePath` transitions we synchronously
  // wipe the previous worktree's snapshot so the effect body stays free
  // of cascading setState() calls (the lint rule is strict about that).
  const [lastResetWorktree, setLastResetWorktree] = useState<string | null>(
    worktreePath,
  );
  if (lastResetWorktree !== worktreePath) {
    setLastResetWorktree(worktreePath);
    setDelivered([]);
    setAgentReplies([]);
    setAgentComments([]);
    setLastSuccessfulPollAt(null);
    setError(false);
  }

  // Latest fetchers in refs so the polling effect doesn't restart whenever
  // a new fetcher reference is passed (parents commonly do this from a
  // closure).
  const fetcherRef = useRef(fetcher);
  const commentsFetcherRef = useRef(commentsFetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
    commentsFetcherRef.current = commentsFetcher;
  }, [fetcher, commentsFetcher]);

  useEffect(() => {
    if (!worktreePath) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled) return;
      // Run both endpoints in parallel but handle outcomes independently:
      // a failed agent-comments fetch shouldn't wipe a successful delivered
      // poll, and vice versa.
      const [deliveredResult, commentsResult] = await Promise.allSettled([
        fetcherRef.current(worktreePath),
        commentsFetcherRef.current(worktreePath),
      ]);
      if (cancelled) return;
      let anyOk = false;
      if (deliveredResult.status === "fulfilled") {
        setDelivered(deliveredResult.value);
        anyOk = true;
      }
      if (commentsResult.status === "fulfilled") {
        // Split the polled batch by discriminator: reply-shaped entries
        // merge under reviewer Replies via mergeAgentReplies; top-level
        // entries land in state.agentComments via mergeAgentComments.
        const { replies, topLevel } = splitAgentComments(commentsResult.value);
        setAgentReplies(replies);
        setAgentComments(topLevel);
        anyOk = true;
      }
      if (anyOk) setLastSuccessfulPollAt(new Date().toISOString());
      setError(
        deliveredResult.status === "rejected" ||
          commentsResult.status === "rejected",
      );
    };

    const start = () => {
      if (timer) return;
      void tick();
      timer = setInterval(tick, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Catch-up poll fires immediately, then the interval re-arms.
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [worktreePath]);

  return {
    delivered,
    agentReplies,
    agentComments,
    lastSuccessfulPollAt,
    error,
  };
}
