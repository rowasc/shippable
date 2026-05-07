// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Inspector } from "./Inspector";
import type { PrReviewComment, PrConversationItem, WorktreeSource, PrSource } from "../types";

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
vi.mock("../githubPrClient", () => ({
  GithubFetchError: class GithubFetchError extends Error {
    discriminator: string;
    host?: string;
    constructor(discriminator: string, message: string, host?: string) {
      super(message);
      this.discriminator = discriminator;
      this.host = host;
    }
  },
  lookupPrForBranch: vi.fn(),
  loadGithubPr: vi.fn(),
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

const WORKTREE_SOURCE: WorktreeSource = {
  worktreePath: "/workspace/test-repo",
  commitSha: "abc123",
  branch: "feat/my-feature",
};

const PR_SOURCE: PrSource = {
  host: "github.com",
  owner: "owner",
  repo: "repo",
  number: 42,
  htmlUrl: "https://github.com/owner/repo/pull/42",
  headSha: "headsha",
  baseSha: "basesha",
  state: "open",
  title: "My feature",
  body: "",
  baseRef: "main",
  headRef: "feat/my-feature",
  lastFetchedAt: new Date().toISOString(),
};

describe("Inspector — PR pill", () => {
  afterEach(() => vi.resetAllMocks());

  it("renders the pill when worktreeSource is set and lookup returns a match", async () => {
    const { lookupPrForBranch: mockLookup } = await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: {
        host: "github.com",
        owner: "owner",
        repo: "repo",
        number: 42,
        title: "My feature",
        state: "open",
        htmlUrl: "https://github.com/owner/repo/pull/42",
      },
    });

    renderInspector({ worktreeSource: WORKTREE_SOURCE, changesetId: "wt:test" });

    await waitFor(() => {
      expect(screen.getByText(/Matching PR: #42/)).toBeTruthy();
    });
  });

  it("does not render the pill when worktreeSource is absent", async () => {
    renderInspector({});
    // Give any async effects time to fire
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/Matching PR/)).toBeNull();
  });

  it("does not render the pill when prSource is already set", async () => {
    const { lookupPrForBranch: mockLookup } = await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: {
        host: "github.com",
        owner: "owner",
        repo: "repo",
        number: 42,
        title: "My feature",
        state: "open",
        htmlUrl: "https://github.com/owner/repo/pull/42",
      },
    });

    renderInspector({
      worktreeSource: WORKTREE_SOURCE,
      prSource: PR_SOURCE,
      changesetId: "wt:test",
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/Matching PR/)).toBeNull();
  });

  it("does not render the pill when lookup returns { matched: null }", async () => {
    const { lookupPrForBranch: mockLookup } = await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValue({ matched: null });

    renderInspector({ worktreeSource: WORKTREE_SOURCE, changesetId: "wt:test" });

    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/Matching PR/)).toBeNull();
  });

  it("pill click with github_token_required calls onAuthError and does NOT set pillError", async () => {
    const { lookupPrForBranch: mockLookup, loadGithubPr: mockLoad, GithubFetchError: MockGithubFetchError } =
      await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: {
        host: "github.com",
        owner: "owner",
        repo: "repo",
        number: 7,
        title: "Token required PR",
        state: "open",
        htmlUrl: "https://github.com/owner/repo/pull/7",
      },
    });
    (mockLoad as ReturnType<typeof vi.fn>).mockRejectedValue(
      new (MockGithubFetchError as new (d: string, m: string, h?: string) => unknown)(
        "github_token_required",
        "github_token_required",
        "github.com",
      ),
    );

    const onAuthError = vi.fn();
    renderInspector({
      worktreeSource: WORKTREE_SOURCE,
      changesetId: "wt:test",
      onAuthError,
      onMergePrOverlay: vi.fn(),
    });

    await waitFor(() => screen.getByText(/Matching PR: #7/));
    fireEvent.click(screen.getByText(/Matching PR: #7/));

    await waitFor(() => {
      expect(onAuthError).toHaveBeenCalledOnce();
      const [host, reason, retry] = onAuthError.mock.calls[0];
      expect(host).toBe("github.com");
      expect(reason).toBe("first-time");
      expect(typeof retry).toBe("function");
    });
    // pillError must NOT be set
    expect(document.querySelector(".inspector__pr-pill-err")).toBeNull();
  });

  it("pill click with github_auth_failed calls onAuthError with reason=rejected and does NOT set pillError", async () => {
    const { lookupPrForBranch: mockLookup, loadGithubPr: mockLoad, GithubFetchError: MockGithubFetchError } =
      await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: {
        host: "github.com",
        owner: "owner",
        repo: "repo",
        number: 8,
        title: "Auth failed PR",
        state: "open",
        htmlUrl: "https://github.com/owner/repo/pull/8",
      },
    });
    (mockLoad as ReturnType<typeof vi.fn>).mockRejectedValue(
      new (MockGithubFetchError as new (d: string, m: string, h?: string) => unknown)(
        "github_auth_failed",
        "github_auth_failed",
        "github.com",
      ),
    );

    const onAuthError = vi.fn();
    renderInspector({
      worktreeSource: WORKTREE_SOURCE,
      changesetId: "wt:test",
      onAuthError,
      onMergePrOverlay: vi.fn(),
    });

    await waitFor(() => screen.getByText(/Matching PR: #8/));
    fireEvent.click(screen.getByText(/Matching PR: #8/));

    await waitFor(() => {
      expect(onAuthError).toHaveBeenCalledOnce();
      const [host, reason] = onAuthError.mock.calls[0];
      expect(host).toBe("github.com");
      expect(reason).toBe("rejected");
    });
    expect(document.querySelector(".inspector__pr-pill-err")).toBeNull();
  });

  it("pill click calls loadGithubPr and dispatches MERGE_PR_OVERLAY via onMergePrOverlay", async () => {
    const { lookupPrForBranch: mockLookup, loadGithubPr: mockLoad } =
      await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: {
        host: "github.com",
        owner: "owner",
        repo: "repo",
        number: 42,
        title: "My feature",
        state: "open",
        htmlUrl: "https://github.com/owner/repo/pull/42",
      },
    });

    const fakePrCs = {
      id: "pr:github.com:owner:repo:42",
      title: "My feature",
      files: [],
    };
    (mockLoad as ReturnType<typeof vi.fn>).mockResolvedValue(fakePrCs);

    const onMergePrOverlay = vi.fn();
    renderInspector({
      worktreeSource: WORKTREE_SOURCE,
      changesetId: "wt:test",
      onMergePrOverlay,
    });

    await waitFor(() => screen.getByText(/Matching PR: #42/));

    fireEvent.click(screen.getByText(/Matching PR: #42/));

    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledWith(
        "https://github.com/owner/repo/pull/42",
      );
      expect(onMergePrOverlay).toHaveBeenCalledWith("wt:test", fakePrCs);
    });
  });
});

describe("Inspector — pill cleared on worktreePath change", () => {
  afterEach(() => vi.resetAllMocks());

  it("clears #42 pill when worktreePath changes to a path returning null", async () => {
    const { lookupPrForBranch: mockLookup } = await import("../githubPrClient");
    (mockLookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      matched: {
        host: "github.com",
        owner: "owner",
        repo: "repo",
        number: 42,
        title: "My feature",
        state: "open",
        htmlUrl: "https://github.com/owner/repo/pull/42",
      },
    }).mockResolvedValueOnce({ matched: null });

    const sourceA: WorktreeSource = {
      worktreePath: "/a",
      commitSha: "aaa",
      branch: "feat/a",
    };
    const sourceB: WorktreeSource = {
      worktreePath: "/b",
      commitSha: "bbb",
      branch: "feat/b",
    };

    const { rerender } = renderInspector({
      worktreeSource: sourceA,
      changesetId: "wt:a",
    });

    // Wait for #42 pill to appear
    await waitFor(() => screen.getByText(/Matching PR: #42/));

    // Change worktreePath — stale pill should disappear immediately
    rerender(
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
        worktreeSource={sourceB}
        changesetId="wt:b"
      />,
    );

    // The #42 pill must be gone immediately (synchronous state reset)
    expect(screen.queryByText(/Matching PR: #42/)).toBeNull();

    // And the new lookup for /b returns null, so no pill ever appears
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/Matching PR/)).toBeNull();
  });
});
