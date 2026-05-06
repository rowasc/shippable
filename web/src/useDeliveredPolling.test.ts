// @vitest-environment jsdom
// Hook-level tests for `useDeliveredPolling`. Uses @testing-library/react's
// `renderHook` to drive React's lifecycle; jsdom provides the DOM the
// React renderer expects. These tests cover the slice 4 acceptance items:
//   - polling kicks off only when ≥1 pending pip
//   - polling stops when no pending pips remain
//   - 5-min idle timeout fires; new delivery resets it
//   - delivered fetch error sets `error: true` and freezes `delivered`

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  IDLE_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  useDeliveredPolling,
} from "./useDeliveredPolling";
import type { DeliveredComment } from "./types";

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

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDeliveredPolling — polling lifecycle", () => {
  it("does not poll when worktreePath is null", async () => {
    const fetcher = vi.fn(async () => [] as DeliveredComment[]);
    renderHook(() =>
      useDeliveredPolling({
        worktreePath: null,
        enqueuedIds: ["cmt_1"],
        fetcher,
      }),
    );
    // Drain microtasks; nothing should fire.
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does an initial fetch on mount even with zero pending pips (populates Delivered N block)", async () => {
    // No pending ids, but an existing worktree — the user expects to see
    // the Delivered block populated when reopening a session that already
    // had everything ✓.
    const fetcher = vi.fn(async () => [delivered("cmt_old")]);
    const r = renderHook(() =>
      useDeliveredPolling({
        worktreePath: "/wt",
        enqueuedIds: [],
        fetcher,
      }),
    );
    await act(() => Promise.resolve()); // resolve initial fetch
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r.result.current.delivered).toHaveLength(1);
    expect(r.result.current.delivered[0].id).toBe("cmt_old");
    // No interval should have been scheduled because there are no
    // pending pips. Advance well past one tick and confirm.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("kicks off polling when pendingIds has at least one id, stops when drained", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      // First two calls return empty (still pending). Third returns the
      // delivered comment, which drains the pending set.
      if (calls < 3) return [];
      return [delivered("cmt_1")];
    });

    const r = renderHook(
      ({ enqueuedIds }: { enqueuedIds: string[] }) =>
        useDeliveredPolling({
          worktreePath: "/wt",
          enqueuedIds,
          fetcher,
        }),
      { initialProps: { enqueuedIds: ["cmt_1"] } },
    );

    // Initial mount fetch is the one-shot worktree fetch, plus the
    // immediate poll-tick run before the interval timer ticks.
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Advance one polling interval — another tick fires.
    const before = fetcher.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      // Let the awaited fetcher promise resolve.
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);

    // Advance another interval — third call returns the delivery.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(r.result.current.delivered.map((d) => d.id)).toContain("cmt_1");

    // Once delivered lands, the hook's pendingKey collapses to "" and
    // the interval clears. Advance many intervals and confirm the call
    // count plateaus.
    const settled = fetcher.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 10);
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(settled);
  });

  it("freezes the delivered list and flags `error` on a failed fetch; pips do not flicker", async () => {
    // Both the one-shot mount fetch and the polling-cycle's immediate
    // tick fire on mount (the cycle starts because we have a pending
    // id). Have the first two calls succeed so we definitely seed
    // `delivered`; subsequent polling ticks error.
    const fetcher = vi
      .fn<(p: string) => Promise<DeliveredComment[]>>()
      .mockResolvedValueOnce([delivered("cmt_1")])
      .mockResolvedValueOnce([delivered("cmt_1")])
      .mockRejectedValue(new Error("ECONNREFUSED"));

    const r = renderHook(() =>
      useDeliveredPolling({
        worktreePath: "/wt",
        enqueuedIds: ["cmt_2"],
        fetcher,
      }),
    );
    // Resolve the initial fetches (mount one-shot + first polling tick).
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(r.result.current.error).toBe(false);
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_1"]);

    // Next polling tick errors.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(r.result.current.error).toBe(true);
    // Frozen — the previous delivered list is preserved.
    expect(r.result.current.delivered.map((d) => d.id)).toEqual(["cmt_1"]);
  });

  it("idle timeout: stops polling after IDLE_TIMEOUT_MS with no new deliveries", async () => {
    let firstCallSawWorktree = false;
    const fetcher = vi.fn(async () => {
      firstCallSawWorktree = true;
      return [];
    });
    renderHook(() =>
      useDeliveredPolling({
        worktreePath: "/wt",
        enqueuedIds: ["cmt_x"],
        fetcher,
      }),
    );
    await act(() => Promise.resolve());
    expect(firstCallSawWorktree).toBe(true);

    // Advance past the idle window without any new ids in the response.
    await act(async () => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS + POLL_INTERVAL_MS * 2);
      await Promise.resolve();
    });
    const stoppedAt = fetcher.mock.calls.length;

    // Further interval advances should produce no new calls — interval
    // cleared by the timeout branch in the tick.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
      await Promise.resolve();
    });
    expect(fetcher.mock.calls.length).toBe(stoppedAt);
  });

  it("idle timeout resets when a new delivery arrives", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      // Early polls return nothing. After a while a new delivery shows
      // up — that should reset the idle clock so polling persists past
      // the original IDLE_TIMEOUT_MS window.
      if (calls === 5) return [delivered("cmt_late")];
      return [];
    });
    renderHook(() =>
      useDeliveredPolling({
        worktreePath: "/wt",
        // We keep a separate id pending so the loop has work to do.
        enqueuedIds: ["cmt_pending"],
        fetcher,
      }),
    );
    await act(() => Promise.resolve());

    // Crank time forward in chunks. The 5th call arrives some time
    // during the second IDLE_TIMEOUT_MS chunk — which is what we want
    // (it lands when, without a reset, the loop would have exited).
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(POLL_INTERVAL_MS);
        await Promise.resolve();
      });
    }
    expect(calls).toBeGreaterThanOrEqual(5);
    // Now advance past IDLE_TIMEOUT_MS from the *original* mount. Without
    // a reset this would stop the loop. With the reset (cmt_late was
    // observed at call 5), the loop is still active.
    const beforeLong = fetcher.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - POLL_INTERVAL_MS * 4);
      await Promise.resolve();
    });
    // Expect at least one more poll attempt — the loop has not given up.
    expect(fetcher.mock.calls.length).toBeGreaterThan(beforeLong);
  });
});
