// @vitest-environment jsdom
// Component tests for the AgentContextSection panel-level features added
// in slice 4: server-restart hint, Delivered (N) block, and the
// failure-mode banner.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AgentContextSection } from "./AgentContextSection";
import type { DeliveredComment } from "../types";

const empty = new Map<string, never>();
const noop = () => {};
const noopAsync = async () => {};
const noopInstall = async () => ({ didModify: false, backupPath: null });

function delivered(over: Partial<DeliveredComment> = {}): DeliveredComment {
  return {
    id: "cmt_1",
    kind: "line",
    file: "server/src/index.ts",
    lines: "118",
    body: "the body of the comment",
    commitSha: "abc",
    supersedes: null,
    enqueuedAt: "2026-05-06T12:00:00.000Z",
    deliveredAt: "2026-05-06T12:01:00.000Z",
    ...over,
  };
}

interface RenderOpts {
  delivered?: DeliveredComment[];
  deliveredError?: boolean;
  lastSuccessfulPollAt?: string | null;
}

function renderPanel(opts: RenderOpts = {}) {
  return render(
    <AgentContextSection
      slice={null}
      candidates={[]}
      selectedSessionFilePath={null}
      loading={false}
      error={null}
      symbols={empty as unknown as Parameters<typeof AgentContextSection>[0]["symbols"]}
      hookStatus={{ installed: true }}
      onJump={noop}
      worktreePath="/wt"
      delivered={opts.delivered ?? []}
      lastSuccessfulPollAt={opts.lastSuccessfulPollAt ?? null}
      deliveredError={opts.deliveredError ?? false}
      onPickSession={noop}
      onRefresh={noop}
      onSendToAgent={noopAsync}
      onInstallHook={noopInstall}
    />,
  );
}

describe("AgentContextSection — server-restart hint", () => {
  it("renders the hint exactly once when the panel is mounted", () => {
    const { container } = renderPanel();
    const hints = container.querySelectorAll(".ac__restart-hint");
    expect(hints.length).toBe(1);
    expect(hints[0].textContent).toBe(
      "Queue is in-memory — server restart drops unpulled comments.",
    );
  });
});

describe("AgentContextSection — Delivered (N) block", () => {
  it("hides at N=0", () => {
    const { container } = renderPanel({ delivered: [] });
    expect(container.querySelector(".ac__delivered")).toBeNull();
  });

  it("renders newest-first via the upstream order", () => {
    // The polling hook returns the server's newest-first order verbatim;
    // the panel doesn't re-sort. Pass two entries and confirm the first
    // <li> matches the first delivered entry.
    const newer = delivered({ id: "cmt_new", deliveredAt: "2026-05-06T12:05:00.000Z" });
    const older = delivered({ id: "cmt_old", deliveredAt: "2026-05-06T12:01:00.000Z" });
    const { container } = renderPanel({ delivered: [newer, older] });
    const items = container.querySelectorAll(".ac__delivered-item");
    expect(items.length).toBe(2);
    // Time labels are relative — the newer one is first in DOM order.
    const firstTime = items[0].querySelector(".ac__delivered-time");
    expect(firstTime?.getAttribute("title")).toBe(newer.deliveredAt);
  });

  it("shows '(showing last 200)' when the cap is hit", () => {
    const list: DeliveredComment[] = [];
    for (let i = 0; i < 200; i++) {
      list.push(
        delivered({ id: `cmt_${i}`, deliveredAt: `2026-05-06T12:00:${String(i % 60).padStart(2, "0")}.000Z` }),
      );
    }
    const { container } = renderPanel({ delivered: list });
    const summary = container.querySelector(".ac__details-summary");
    expect(summary?.textContent).toContain("Delivered (200)");
    expect(summary?.textContent).toContain("(showing last 200)");
  });

  it("renders a freeform comment as '(freeform message)' rather than file:lines", () => {
    const ff = delivered({
      id: "cmt_ff",
      kind: "freeform",
      file: undefined,
      lines: undefined,
      body: "hello agent",
    });
    const { container } = renderPanel({ delivered: [ff] });
    const loc = container.querySelector(".ac__delivered-loc");
    expect(loc?.textContent).toBe("(freeform message)");
  });
});

describe("AgentContextSection — failure-mode banner", () => {
  it("does not render the banner when deliveredError is false", () => {
    const { container } = renderPanel({ deliveredError: false });
    expect(container.querySelector(".ac__poll-banner")).toBeNull();
  });

  it("renders the banner with exact prefix copy when deliveredError is true and lastSuccessAt is set", () => {
    // Compute a timestamp ~3 minutes ago so humanAgo produces "3m ago" or
    // similar. The test asserts the exact prefix and a relative-time
    // suffix shape, regex-tolerant on the number.
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { container } = renderPanel({
      deliveredError: true,
      lastSuccessfulPollAt: threeMinAgo,
    });
    const banner = container.querySelector(".ac__poll-banner");
    expect(banner).not.toBeNull();
    const text = banner!.textContent ?? "";
    // Regex-tolerant on the relative time; exact on the prefix.
    expect(text).toMatch(
      /^Agent status unavailable — last checked (\d+[a-z]+ ago|just now|—)\.$/,
    );
  });

  it("renders the banner with '—' when there has been no successful poll yet", () => {
    const { container } = renderPanel({
      deliveredError: true,
      lastSuccessfulPollAt: null,
    });
    const banner = container.querySelector(".ac__poll-banner");
    expect(banner?.textContent).toBe(
      "Agent status unavailable — last checked —.",
    );
  });
});
