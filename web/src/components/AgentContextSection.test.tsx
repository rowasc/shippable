// @vitest-environment jsdom
// Component tests for the AgentContextSection panel-level features:
// - server-restart hint (slice 4)
// - Delivered (N) block (slice 4)
// - failure-mode banner (slice 4)
// - MCP install affordance + dismiss flag (slice 5)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { AgentContextSection } from "./AgentContextSection";
import type { AgentComment, DeliveredComment, Reply } from "../types";
import { agentCommentReplyKey } from "../types";

const empty = new Map<string, never>();
const noop = () => {};

const MCP_DISMISS_KEY = "shippable.mcpInstallDismissed";

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
  mcpStatus?: { installed: boolean; installCommand: string } | null;
  agentComments?: AgentComment[];
  replies?: Record<string, Reply[]>;
  draftingKey?: string | null;
  draftFor?: (key: string) => string;
  onStartDraft?: (key: string) => void;
  onSubmitReply?: (key: string, body: string) => void;
}

const DEFAULT_INSTALL_LINE =
  "claude mcp add shippable -- node /tmp/test/mcp-server/dist/index.js";

function renderPanel(opts: RenderOpts = {}) {
  // Default mcpStatus → installed (the panel collapses to the ✓ line).
  // Tests that exercise the install affordance pass an explicit
  // `installed: false` shape with a representative installCommand.
  const defaultMcp = { installed: true, installCommand: DEFAULT_INSTALL_LINE };
  return render(
    <AgentContextSection
      slice={null}
      candidates={[]}
      selectedSessionFilePath={null}
      loading={false}
      error={null}
      symbols={empty as unknown as Parameters<typeof AgentContextSection>[0]["symbols"]}
      mcpStatus={opts.mcpStatus === undefined ? defaultMcp : opts.mcpStatus}
      onJump={noop}
      delivered={opts.delivered ?? []}
      lastSuccessfulPollAt={opts.lastSuccessfulPollAt ?? null}
      deliveredError={opts.deliveredError ?? false}
      onPickSession={noop}
      onRefresh={noop}
      agentComments={opts.agentComments ?? []}
      replies={opts.replies ?? {}}
      draftingKey={opts.draftingKey ?? null}
      draftFor={opts.draftFor ?? (() => "")}
      deliveredById={{}}
      onStartDraft={opts.onStartDraft ?? noop}
      onCloseDraft={noop}
      onChangeDraft={noop}
      onSubmitReply={opts.onSubmitReply ?? noop}
      onDeleteReply={noop}
      onRetryReply={noop}
    />,
  );
}

// In Node 22+ (used by vitest 4), there's a built-in `localStorage` global
// that has a stub API and pre-empts jsdom's. Install a minimal in-memory
// shim on `window` so the panel's reads/writes line up with what the test
// inspects via `getItem`. Keeps the test independent of the host's
// localStorage backend.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
  });
}

beforeEach(() => {
  installLocalStorageShim();
});

afterEach(() => {
  window.localStorage.clear();
});

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

describe("AgentContextSection — MCP install affordance (slice 5)", () => {
  // Slice-3 follow-up: the install line is no longer hardcoded — the chip
  // renders whatever `mcpStatus.installCommand` says. Tests pass a
  // local-build form to assert the value round-trips intact.
  const LOCAL_BUILD_LINE =
    "claude mcp add shippable -- node /Users/x/Development/shippable/mcp-server/dist/index.js";

  it("renders the install section with the server-provided install line when not detected and not dismissed", () => {
    const { container } = renderPanel({
      mcpStatus: { installed: false, installCommand: LOCAL_BUILD_LINE },
    });
    const block = container.querySelector(".ac__mcp");
    expect(block).not.toBeNull();
    expect(block?.classList.contains("ac__mcp--ok")).toBe(false);
    // Three copy chips: install line + two magic phrases (pull + report).
    const chips = container.querySelectorAll(".ac__mcp-chip");
    expect(chips.length).toBe(3);
    // The install line is exactly what the server returned (local-build
    // form here) and both magic phrases are still rendered verbatim.
    const text = block?.textContent ?? "";
    expect(text).toContain(LOCAL_BUILD_LINE);
    expect(text).toContain("check shippable");
    expect(text).toContain("report back to shippable");
    // The dismiss button renders.
    expect(container.querySelector(".ac__mcp-dismiss")).not.toBeNull();
  });

  it("renders the npx form verbatim when the server falls back to it", () => {
    // When `mcp-server/dist/index.js` is missing, the server falls back to
    // the npx line. The chip should surface that string unchanged.
    const NPX = "claude mcp add shippable -- npx -y @shippable/mcp-server";
    const { container } = renderPanel({
      mcpStatus: { installed: false, installCommand: NPX },
    });
    const text = container.querySelector(".ac__mcp")?.textContent ?? "";
    expect(text).toContain(NPX);
  });

  it("collapses to '✓ MCP installed' when the server reports installed", () => {
    const { container } = renderPanel({
      mcpStatus: { installed: true, installCommand: LOCAL_BUILD_LINE },
    });
    const block = container.querySelector(".ac__mcp--ok");
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain("MCP installed");
    // No copy chips in the OK state.
    expect(container.querySelectorAll(".ac__mcp-chip").length).toBe(0);
  });

  it("renders nothing while mcpStatus is loading and the dismiss flag is absent", () => {
    const { container } = renderPanel({ mcpStatus: null });
    expect(container.querySelector(".ac__mcp")).toBeNull();
  });

  it("hides the install section after the user clicks 'I installed it' and persists across remount", () => {
    const { container, unmount } = renderPanel({
      mcpStatus: { installed: false, installCommand: LOCAL_BUILD_LINE },
    });
    const dismiss = container.querySelector(
      ".ac__mcp-dismiss",
    ) as HTMLButtonElement | null;
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss!);
    // After the click the affordance collapses to the OK line in the same
    // mount — the localStorage flag drives both the render gate and
    // future mounts.
    expect(window.localStorage.getItem(MCP_DISMISS_KEY)).toBe("1");
    expect(container.querySelector(".ac__mcp--ok")).not.toBeNull();
    expect(container.querySelector(".ac__mcp-dismiss")).toBeNull();

    unmount();

    // Remount: even with mcpStatus reporting `installed: false` the
    // localStorage flag keeps the affordance collapsed.
    const { container: c2 } = renderPanel({
      mcpStatus: { installed: false, installCommand: LOCAL_BUILD_LINE },
    });
    expect(c2.querySelector(".ac__mcp--ok")).not.toBeNull();
    expect(c2.querySelector(".ac__mcp-dismiss")).toBeNull();
  });
});

describe("AgentContextSection — agent comments block", () => {
  // Helper restricted to the anchor-shaped variant — the agent-comments
  // block only renders top-level entries. The TS discriminated union makes
  // `Partial<AgentComment>` awkward to spread, so we type the override
  // narrowly here.
  const ac = (
    over: Partial<{
      id: string;
      body: string;
      postedAt: string;
      agentLabel?: string;
      anchor: { file: string; lines: string };
    }> = {},
  ): AgentComment => ({
    id: over.id ?? "ac-1",
    body: over.body ?? "I notice this block lacks tests",
    postedAt: over.postedAt ?? "2026-05-06T12:01:00.000Z",
    anchor: over.anchor ?? { file: "src/foo.ts", lines: "42-58" },
    ...(over.agentLabel !== undefined ? { agentLabel: over.agentLabel } : {}),
  });

  it("hides the block when there are no agent comments", () => {
    const { container } = renderPanel({ agentComments: [] });
    expect(container.querySelector(".ac__agent-comments")).toBeNull();
  });

  it("renders one root per AgentComment with anchor + body + agent label", () => {
    const { container } = renderPanel({
      agentComments: [
        ac({ id: "ac-1", body: "body one", anchor: { file: "a.ts", lines: "1" } }),
        ac({ id: "ac-2", body: "body two", anchor: { file: "b.ts", lines: "2-3" } }),
      ],
    });
    const items = container.querySelectorAll(".ac__agent-comment");
    expect(items.length).toBe(2);
    const labels = container.querySelectorAll(".ac__agent-comment-label");
    expect(Array.from(labels).every((l) => l.textContent === "agent")).toBe(
      true,
    );
    const locs = container.querySelectorAll(".ac__agent-comment-loc");
    expect(Array.from(locs).map((l) => l.textContent)).toEqual([
      "a.ts:1",
      "b.ts:2-3",
    ]);
    const bodies = container.querySelectorAll(".ac__agent-comment-body");
    expect(Array.from(bodies).map((b) => b.textContent)).toEqual([
      "body one",
      "body two",
    ]);
  });

  it("uses agentLabel when present, falls back to 'agent' otherwise", () => {
    const { container } = renderPanel({
      agentComments: [ac({ agentLabel: "claude-code" })],
    });
    const label = container.querySelector(".ac__agent-comment-label");
    expect(label?.textContent).toBe("claude-code");
  });

  it("mounts a ReplyThread under each agent comment that wires submit to the parent handler", () => {
    const onSubmitReply = vi.fn();
    const onStartDraft = vi.fn();
    const replyKey = agentCommentReplyKey("ac-1");
    const { container } = renderPanel({
      agentComments: [ac({ id: "ac-1" })],
      onSubmitReply,
      onStartDraft,
    });
    const startBtn = container.querySelector(
      ".ac__agent-comment .thread__start",
    ) as HTMLButtonElement | null;
    expect(startBtn).not.toBeNull();
    fireEvent.click(startBtn!);
    expect(onStartDraft).toHaveBeenCalledWith(replyKey);
  });

  it("renders existing replies threaded under the matching agent comment", () => {
    const replyKey = agentCommentReplyKey("ac-1");
    const reply: Reply = {
      id: "r1",
      author: "you",
      body: "agreed, will add",
      createdAt: "2026-05-06T12:02:00.000Z",
    };
    const { container } = renderPanel({
      agentComments: [ac({ id: "ac-1" })],
      replies: { [replyKey]: [reply] },
    });
    const bodies = container.querySelectorAll(".reply__body");
    expect(bodies.length).toBe(1);
    expect(bodies[0].textContent).toContain("agreed, will add");
  });
});

