// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Inspector } from "./Inspector";
import type { PrReviewComment, PrConversationItem } from "../types";

afterEach(cleanup);

// Minimal mocks to silence deps that are not under test
vi.mock("./AgentContextSection", () => ({
  AgentContextSection: () => null,
}));
vi.mock("./ReplyThread", () => ({
  ReplyThread: () => null,
}));
vi.mock("./CodeText", () => ({
  CodeText: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("./RichText", () => ({
  RichText: ({ text }: { text: string }) => <span>{text}</span>,
}));

const EMPTY_SYMBOLS = new Map() as Parameters<typeof Inspector>[0]["symbols"];
const NOOP = () => undefined;

function minimalViewModel() {
  return {
    locationLabel: "src/foo.ts:1",
    language: "typescript",
    lineKind: "context" as const,
    lineText: "const x = 1;",
    lineSign: " ",
    hasAiNotes: false,
    aiNoteCountLabel: "none",
    aiNoteRows: [],
    nextNoteHint: null,
    aiSummary: null,
    aiSummaryReplyKey: null,
    aiSummaryReplies: [],
    aiSummaryIsDrafting: false,
    aiSummaryJumpTarget: null,
    teammate: null,
    userCommentCountLabel: "none",
    userCommentRows: [],
    showNewCommentCta: false,
    currentLineCommentKey: "user:hunk1:0",
    currentLineNo: 1,
    showDraftStub: false,
    draftStubRow: null,
  };
}

function renderInspector(
  over: Partial<Parameters<typeof Inspector>[0]> = {},
) {
  return render(
    <Inspector
      viewModel={minimalViewModel()}
      symbols={EMPTY_SYMBOLS}
      draftBodies={{}}
      onJump={NOOP}
      onToggleAck={NOOP}
      onStartDraft={NOOP}
      onCloseDraft={NOOP}
      onChangeDraft={NOOP}
      onSubmitReply={NOOP}
      onDeleteReply={NOOP}
      onRetryReply={NOOP}
      onVerifyAiNote={NOOP}
      {...over}
    />,
  );
}

describe("Inspector — prReviewComments", () => {
  it("renders the PR review comments section with the correct count", () => {
    const comments: PrReviewComment[] = [
      {
        id: 1,
        author: "alice",
        createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
        body: "Consider using a const here.",
        htmlUrl: "https://github.com/owner/repo/pull/1#comment-1",
      },
      {
        id: 2,
        author: "bob",
        createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
        body: "Looks good to me.",
        htmlUrl: "https://github.com/owner/repo/pull/1#comment-2",
        lineSpan: { lo: 5, hi: 8 },
      },
    ];

    renderInspector({ prReviewComments: comments });

    // Section header with count
    expect(screen.getByText(/PR review comments/i)).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();

    // Author names
    expect(screen.getByText("@alice")).toBeTruthy();
    expect(screen.getByText("@bob")).toBeTruthy();

    // Comment bodies
    expect(screen.getByText("Consider using a const here.")).toBeTruthy();

    // lineSpan hint
    expect(screen.getByText(/spans L5–8/)).toBeTruthy();

    // External links
    const links = screen.getAllByRole("link", { name: "↗" });
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe(
      "https://github.com/owner/repo/pull/1#comment-1",
    );
  });

  it("does not render the section when prReviewComments is empty", () => {
    renderInspector({ prReviewComments: [] });
    expect(
      document.querySelector(".inspector__sec-h")?.textContent,
    ).not.toContain("PR review comments");
  });

  it("does not render the section when prReviewComments is absent", () => {
    renderInspector();
    const allSections = document.querySelectorAll(".inspector__sec-h");
    const texts = Array.from(allSections).map((el) => el.textContent ?? "");
    expect(texts.some((t) => t.includes("PR review comments"))).toBe(false);
  });
});

describe("Inspector — prConversation", () => {
  it("renders the PR conversation disclosure with item count", () => {
    const items: PrConversationItem[] = [
      {
        id: 10,
        author: "carol",
        createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
        body: "Why was this approach chosen?",
        htmlUrl: "https://github.com/owner/repo/pull/1#issuecomment-10",
      },
    ];

    renderInspector({ prConversation: items });

    expect(screen.getByText(/PR conversation \(1\)/i)).toBeTruthy();
    expect(screen.getByText("@carol")).toBeTruthy();
    expect(screen.getByText("Why was this approach chosen?")).toBeTruthy();
  });

  it("does not render the section when prConversation is empty", () => {
    renderInspector({ prConversation: [] });
    expect(screen.queryByText(/PR conversation/i)).toBeNull();
  });
});
