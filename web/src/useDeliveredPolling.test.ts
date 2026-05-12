// @vitest-environment jsdom
// Hook-level tests for `useDeliveredPolling`. Uses @testing-library/react's
// `renderHook` to drive React's lifecycle; jsdom provides the DOM the React
// renderer expects. The polling predicate is `mounted && tab visible` —
// see docs/sdd/agent-reply-support/spec.md for why per-comment outstanding
// gates are unsound under multi-reply.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  POLL_INTERVAL_MS,
  useDeliveredPolling,
} from "./useDeliveredPolling";
import type { AgentComment, DeliveredComment } from "./types";

/** Build a reply-shaped AgentComment for the polled wire batch. */
function replyEntry(
  id: string,
  commentId: string,
  postedAt: string,
  body: string = id,
): AgentComment {
  return {
    id,
    body,
    postedAt,
    parent: { commentId, outcome: "addressed" },
  };
}

/** Build a top-level (anchor-shaped) AgentComment for the polled wire batch. */
function topLevelEntry(
  id: string,
  file: string,
  lines: string,
  postedAt: string,
): AgentComment {
  return {
    id,
    body: `top-${id}`,
    postedAt,
    anchor: { file, lines },
  };
}

function delivered(id: string, deliveredAt = "2026-05-06T12:00:00.000Z"): DeliveredComment {
  return {
    id,
    kind: "line",
    file: "f.ts",
    lines: "1",
    body: "b",
    commitSha: "sha",
    supersedes: null,
    enqueuedAt: "2026-05-06T11:00:00.000Z",
    deliveredAt,
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => state === "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDeliveredPolling — polling lifecycle", () => {
  it("does not poll when worktreePath is null", async () => {
    const fetcher = vi.fn(async () => [] as DeliveredComment[]);
    renderHook(() =>
      useDeliveredPolling({ worktreePath: null, fetcher }),
    );
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("polls at every POLL_INTERVAL_MS while mounted and tab is visible", async () => {
    const fetcher = vi.fn(async () => [delivered("cmt_1")]);
    renderHook(() => useDeliveredPolling({ worktreePath: "/wt", fetcher }));

    // Immediate first tick on mount.
    await act(() => Promise.resolve());
    expect(fetcher).toHaveBeenCalledTimes(1);

    const before = fetcher.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(before + 1);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(before + 2);
  });

  it("pauses while tab is hidden and resumes with an immediate catch-up poll on visible", async () => {
    const fetcher = vi.fn(async () => [delivered("cmt_1")]);
    renderHook(() => useDeliveredPolling({ worktreePath: "/wt", fetcher }));
    await act(() => Promise.resolve());
    const onMount = fetcher.mock.calls.length;
    expect(onMount).toBeGreaterThanOrEqual(1);

    // Hide tab — interval should clear, no further polls.
    await act(async () => {
      setVisibility("hidden");
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(onMount);

    // Reveal — immediate catch-up poll fires synchronously, then the
    // interval re-arms.
    await act(async () => {
      setVisibility("visible");
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(onMount + 1);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(onMount + 2);
  });

  it("freezes the delivered list and flags `error` on a failed fetch", async () => {
    const fetcher = vi
      .fn<(p: string) => Promise<DeliveredComment[]>>()
      .mockResolvedValueOnce([delivered("cmt_1")])
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const commentsFetcher = vi.fn<(p: string) => Promise<AgentComment[]>>(
      async () => [],
    );

    const r = renderHook(() =>
      useDeliveredPolling({
        worktreePath: "/wt",
        fetcher,
        commentsFetcher,
      }),
    );
    await act(() => Promise.resolve());
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_1"]);
    expect(r.result.current.error).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(r.result.current.error).toBe(true);
    // Frozen — last good list survives the failed poll.
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_1"]);
  });

  it("Promise.allSettled keeps endpoints independent: delivered fails, comments succeeds → delivered frozen, agentReplies updated, error: true", async () => {
    // The headline behaviour change in the polling rewrite: a failure in
    // one endpoint must not poison the other. Pre-commit, delivered
    // would freeze in last-known state when its fetcher errored, but
    // there was a single try/catch; under Promise.allSettled the two
    // sides freeze independently.
    const fetcher = vi
      .fn<(p: string) => Promise<DeliveredComment[]>>()
      .mockResolvedValueOnce([delivered("cmt_1")])
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const commentsFetcher = vi
      .fn<(p: string) => Promise<AgentComment[]>>()
      .mockResolvedValueOnce([
        replyEntry("ar1", "cmt_1", "2026-05-06T12:01:00.000Z"),
      ])
      .mockResolvedValueOnce([
        replyEntry("ar1", "cmt_1", "2026-05-06T12:01:00.000Z"),
        replyEntry("ar2", "cmt_1", "2026-05-06T12:02:00.000Z"),
      ]);

    const r = renderHook(() =>
      useDeliveredPolling({ worktreePath: "/wt", fetcher, commentsFetcher }),
    );

    // First tick: both succeed; both populated; no error.
    await act(() => Promise.resolve());
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_1"]);
    expect(r.result.current.agentReplies.map((a) => a.id)).toEqual(["ar1"]);
    expect(r.result.current.error).toBe(false);

    // Second tick: delivered errors; replies succeeds with a new entry.
    // delivered must stay frozen at ["cmt_1"]; agentReplies must update;
    // error flips true.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_1"]);
    expect(r.result.current.agentReplies.map((a) => a.id)).toEqual([
      "ar1",
      "ar2",
    ]);
    expect(r.result.current.error).toBe(true);
  });

  it("Promise.allSettled keeps endpoints independent: comments fails, delivered succeeds → agentReplies frozen, delivered updated, error: true", async () => {
    // Mirror of the above with the failure on the other side.
    const fetcher = vi
      .fn<(p: string) => Promise<DeliveredComment[]>>()
      .mockResolvedValueOnce([delivered("cmt_1")])
      .mockResolvedValueOnce([delivered("cmt_1"), delivered("cmt_2")]);
    const commentsFetcher = vi
      .fn<(p: string) => Promise<AgentComment[]>>()
      .mockResolvedValueOnce([
        replyEntry("ar1", "cmt_1", "2026-05-06T12:01:00.000Z", "fixed"),
      ])
      .mockRejectedValue(new Error("ECONNREFUSED"));

    const r = renderHook(() =>
      useDeliveredPolling({ worktreePath: "/wt", fetcher, commentsFetcher }),
    );
    await act(() => Promise.resolve());
    expect(r.result.current.agentReplies.map((a) => a.id)).toEqual(["ar1"]);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    // delivered updated; agentReplies frozen at last good value.
    expect(r.result.current.delivered.map((d) => d.id)).toEqual([
      "cmt_1",
      "cmt_2",
    ]);
    expect(r.result.current.agentReplies.map((a) => a.id)).toEqual(["ar1"]);
    expect(r.result.current.error).toBe(true);
  });

  it("polls agent comments in parallel and exposes both reply-shaped and top-level entries", async () => {
    const fetcher = vi.fn(async () => [delivered("cmt_1")]);
    const commentsFetcher = vi.fn<(p: string) => Promise<AgentComment[]>>(
      async () => [
        replyEntry("ar1", "cmt_1", "2026-05-06T12:01:00.000Z", "fixed"),
        topLevelEntry(
          "tl1",
          "src/foo.ts",
          "42-58",
          "2026-05-06T12:02:00.000Z",
        ),
      ],
    );
    const r = renderHook(() =>
      useDeliveredPolling({
        worktreePath: "/wt",
        fetcher,
        commentsFetcher,
      }),
    );
    await act(() => Promise.resolve());
    expect(commentsFetcher).toHaveBeenCalledWith("/wt");
    // Reply-shaped entries are translated to the flat PolledAgentReply
    // wire shape so the existing mergeAgentReplies reducer keeps working.
    expect(r.result.current.agentReplies).toHaveLength(1);
    expect(r.result.current.agentReplies[0].commentId).toBe("cmt_1");
    expect(r.result.current.agentReplies[0].outcome).toBe("addressed");
    // Top-level entries land in the separate agentComments slot.
    expect(r.result.current.agentComments).toHaveLength(1);
    expect(r.result.current.agentComments[0].id).toBe("tl1");
    expect(r.result.current.agentComments[0].anchor?.file).toBe("src/foo.ts");
  });

  it("resets state when worktreePath changes", async () => {
    const wt1Delivered = [delivered("cmt_a")];
    const wt2Delivered = [delivered("cmt_b")];
    const fetcher = vi.fn<(p: string) => Promise<DeliveredComment[]>>(
      async (p) => (p === "/wt1" ? wt1Delivered : wt2Delivered),
    );
    const commentsFetcher = vi.fn<(p: string) => Promise<AgentComment[]>>(
      async () => [],
    );

    const r = renderHook(
      ({ worktreePath }: { worktreePath: string }) =>
        useDeliveredPolling({ worktreePath, fetcher, commentsFetcher }),
      { initialProps: { worktreePath: "/wt1" } },
    );
    await act(() => Promise.resolve());
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_a"]);

    r.rerender({ worktreePath: "/wt2" });
    await act(() => Promise.resolve());
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_b"]);
  });
});
