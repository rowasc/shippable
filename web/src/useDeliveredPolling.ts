// Polls /api/agent/delivered while at least one Reply has a pending pip.
// See docs/plans/share-review-comments-tasks.md § Slice 4 for behavior.
//
// The hook is the visual heartbeat for the queue substrate: it flips
// `◌ queued` pips to `✓ delivered` once the agent fetches a comment and
// drives the panel-level "Delivered (N)" block + failure banner.
//
// Behavior contract:
//   - Polls every 2s when `pendingIds.length > 0`. Idle when zero pending.
//   - 5-min idle timeout from the most recent successful poll that
//     produced new delivered ids; new delivery resets the timer.
//   - Errors do NOT throw. They flip `error` to true and freeze the
//     `delivered` array in its last-known state until a successful poll
//     overwrites both.
//   - Tests can inject `fetcher` and a `now`/`setInterval` clock.

import { useEffect, useRef, useState } from "react";
import { fetchDelivered } from "./agentContextClient";
import type { DeliveredComment } from "./types";

/** Match the existing AgentContextSection.SendToAgent cadence. */
export const POLL_INTERVAL_MS = 2000;
/** Five minutes — same shape the legacy inbox composer uses. */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface DeliveredPollingResult {
  delivered: DeliveredComment[];
  /** ISO of the last successful fetch; null until the first one lands. */
  lastSuccessfulPollAt: string | null;
  /** True iff the most recent fetch errored. */
  error: boolean;
}

export interface UseDeliveredPollingArgs {
  /**
   * The active worktree path. `null` disables the hook entirely (no
   * worktree loaded → no panel → no pips).
   */
  worktreePath: string | null;
  /**
   * Every `Reply.enqueuedCommentId` across the active changeset's
   * replies. The hook subtracts the delivered ids it has fetched to
   * compute "pending pips" internally — that way the caller doesn't
   * have to maintain a separate snapshot of delivered ids.
   */
  enqueuedIds: string[];
  /**
   * Override the network call. Used by tests to inject a synchronous
   * stub. Defaults to the real `fetchDelivered` from
   * `agentContextClient`.
   */
  fetcher?: (worktreePath: string) => Promise<DeliveredComment[]>;
}

export function useDeliveredPolling({
  worktreePath,
  enqueuedIds,
  fetcher = fetchDelivered,
}: UseDeliveredPollingArgs): DeliveredPollingResult {
  const [delivered, setDelivered] = useState<DeliveredComment[]>([]);
  const [lastSuccessfulPollAt, setLastSuccessfulPollAt] = useState<
    string | null
  >(null);
  const [error, setError] = useState(false);

  // Track the timestamp of the last delivery flip (a poll that produced
  // new ids relative to what we already had). Used for the 5-min idle
  // timeout. Lives in a ref so we don't re-trigger the effect on every
  // tick that sets it.
  const lastDeliveryAtRef = useRef<number | null>(null);
  // Snapshot of delivered-ids the hook has already observed. Used to
  // detect "new delivery" without re-comparing arrays inside the effect
  // closure each tick. Kept in a ref because it's not a render input.
  const knownIdsRef = useRef<Set<string>>(new Set());

  // Compute pending = enqueuedIds \ delivered.id . We collapse it to a
  // sorted-join string so the effect's dep array is a primitive that
  // only changes when the pending set actually changes — re-renders
  // that don't move the needle don't restart the interval.
  const deliveredIdSet = new Set(delivered.map((d) => d.id));
  const pendingIdsArr = enqueuedIds.filter((id) => !deliveredIdSet.has(id));
  const pendingKey =
    pendingIdsArr.length === 0 ? "" : [...pendingIdsArr].sort().join("|");
  const hasPending = pendingKey.length > 0;

  // "Adjusting state during render" — same pattern App.tsx uses for the
  // agent-context fetch. When `worktreePath` transitions we synchronously
  // wipe the previous worktree's snapshot so the effect body stays free
  // of cascading setState() calls (the lint rule is strict about that).
  // Refs reset in a separate effect since refs aren't allowed to mutate
  // during render.
  const [lastResetWorktree, setLastResetWorktree] = useState<string | null>(
    worktreePath,
  );
  if (lastResetWorktree !== worktreePath) {
    setLastResetWorktree(worktreePath);
    setDelivered([]);
    setLastSuccessfulPollAt(null);
    setError(false);
  }
  useEffect(() => {
    knownIdsRef.current = new Set();
    lastDeliveryAtRef.current = null;
  }, [worktreePath]);

  // One-shot fetch on worktree change. The Delivered (N) block reads
  // from the same `delivered` array, and the user expects to see it
  // populated after switching worktrees even when there are no pending
  // pips (typical: the agent already pulled everything in a prior
  // session, so all pips are already ✓).
  useEffect(() => {
    if (!worktreePath) return;
    let cancelled = false;
    fetcher(worktreePath)
      .then((list) => {
        if (cancelled) return;
        const known = new Set<string>();
        for (const d of list) known.add(d.id);
        knownIdsRef.current = known;
        setDelivered(list);
        setLastSuccessfulPollAt(new Date().toISOString());
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, fetcher]);

  useEffect(() => {
    if (!worktreePath || !hasPending) return;

    // Reset the idle clock whenever we enter the polling cycle. A pip
    // that arrives mid-cycle resets it again (below).
    if (lastDeliveryAtRef.current === null) {
      lastDeliveryAtRef.current = Date.now();
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled) return;
      // Idle timeout — even with pending pips, give up after the window
      // so we don't poll for an entire idle workday. The user can
      // re-trigger by switching worktrees or reloading.
      if (
        lastDeliveryAtRef.current !== null &&
        Date.now() - lastDeliveryAtRef.current > IDLE_TIMEOUT_MS
      ) {
        if (timer) clearInterval(timer);
        return;
      }
      try {
        const list = await fetcher(worktreePath);
        if (cancelled) return;
        // Detect a new delivery — any id we hadn't seen before. Reset
        // the idle clock when we find one.
        const known = knownIdsRef.current;
        let foundNew = false;
        for (const d of list) {
          if (!known.has(d.id)) {
            foundNew = true;
            known.add(d.id);
          }
        }
        if (foundNew) lastDeliveryAtRef.current = Date.now();
        setDelivered(list);
        setLastSuccessfulPollAt(new Date().toISOString());
        setError(false);
      } catch {
        if (cancelled) return;
        // Freeze pips in last-known state. The banner reads this flag.
        setError(true);
      }
    };

    timer = setInterval(tick, POLL_INTERVAL_MS);
    void tick(); // immediate first check; covers the "ids set on submit" case

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // worktreePath + pendingKey collapse the upstream inputs into stable
    // primitives so the effect restarts on the changes we care about.
  }, [worktreePath, hasPending, pendingKey, fetcher]);

  // When the polling cycle exits (pendingIds drained, or worktree change)
  // reset the idle clock so the next cycle starts fresh.
  useEffect(() => {
    if (!hasPending) lastDeliveryAtRef.current = null;
  }, [hasPending]);

  return { delivered, lastSuccessfulPollAt, error };
}
