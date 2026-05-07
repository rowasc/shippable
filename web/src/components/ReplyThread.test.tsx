// @vitest-environment jsdom
// Component tests for ReplyThread's pip rendering. The pip state machine
// + tooltip copy is a load-bearing UI contract from the
// share-review-comments plan; these tests pin the strings.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ReplyThread } from "./ReplyThread";
import type { DeliveredComment, Reply } from "../types";

function reply(over: Partial<Reply> = {}): Reply {
  return {
    id: "r1",
    author: "you",
    body: "hello",
    createdAt: "2026-05-06T12:34:56.000Z",
    enqueuedCommentId: null,
    ...over,
  };
}

function delivered(id: string, deliveredAt: string): DeliveredComment {
  return {
    id,
    kind: "line",
    file: "f.ts",
    lines: "1",
    body: "b",
    commitSha: "sha",
    supersedes: null,
    enqueuedAt: "2026-05-06T12:00:00.000Z",
    deliveredAt,
  };
}

const empty = new Map<string, never>();
const noop = () => {};

function emptySymbols() {
  // The SymbolIndex interface is just `Map<string, Cursor>`; an empty map
  // satisfies it for these tests because no body content references known
  // symbols.
  return empty as unknown as Parameters<typeof ReplyThread>[0]["symbols"];
}

describe("ReplyThread — pip state machine", () => {
  it("renders no pip when enqueuedCommentId is null", () => {
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: null })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    expect(container.querySelector(".reply__pip")).toBeNull();
  });

  it("renders the queued pip when enqueuedCommentId is set but not delivered", () => {
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: "cmt_1" })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{}}
      />,
    );
    const pip = container.querySelector(".reply__pip");
    expect(pip).not.toBeNull();
    expect(pip!.className).toContain("reply__pip--queued");
    expect(pip!.textContent).toContain("queued");
  });

  it("renders the delivered pip when the id is in the delivered map", () => {
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: "cmt_1" })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{ cmt_1: d }}
      />,
    );
    const pip = container.querySelector(".reply__pip");
    expect(pip).not.toBeNull();
    expect(pip!.className).toContain("reply__pip--delivered");
    expect(pip!.textContent).toContain("delivered");
  });
});

describe("ReplyThread — delete-button tooltip", () => {
  // Slice-2 follow-up: when a reply has been delivered to the agent, the
  // delete button's title should explain that deleting is local-only. For
  // not-yet-delivered (or non-enqueued) replies the original "delete reply"
  // title still applies.
  const SPEC_TITLE_DELIVERED =
    "the agent already saw this; deleting only removes it from your view.";

  it("uses the spec string when the reply is in the delivered set", () => {
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: "cmt_1" })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{ cmt_1: d }}
      />,
    );
    const del = container.querySelector(".reply__delete") as HTMLElement;
    expect(del.getAttribute("title")).toBe(SPEC_TITLE_DELIVERED);
  });

  it("uses the generic 'delete reply' title when the reply is queued but not yet delivered", () => {
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: "cmt_1" })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{}}
      />,
    );
    const del = container.querySelector(".reply__delete") as HTMLElement;
    expect(del.getAttribute("title")).toBe("delete reply");
  });

  it("uses the generic 'delete reply' title when the reply has no enqueued id", () => {
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: null })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    const del = container.querySelector(".reply__delete") as HTMLElement;
    expect(del.getAttribute("title")).toBe("delete reply");
  });
});

describe("ReplyThread — errored pip + retry", () => {
  // Slice-2 follow-up: a failed enqueue surfaces an errored pip that doubles
  // as a click-to-retry button. Errored loses to delivered (delivered is the
  // source of truth — once the agent has the comment, any prior local error
  // is stale) and wins over "no pip" when there's no enqueued id yet.

  const ERR_TITLE = "Couldn't reach your agent — click to retry.";

  it("renders the errored pip with the spec glyph + title when enqueueError is true and no id is set", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: null, enqueueError: true })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        onRetryReply={onRetry}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    const pip = container.querySelector(".reply__pip--errored") as HTMLElement;
    expect(pip).not.toBeNull();
    expect(pip.textContent).toContain("⚠");
    expect(pip.textContent).toContain("retry");
    expect(pip.getAttribute("title")).toBe(ERR_TITLE);
  });

  it("clicking the errored pip calls onRetryReply with the reply id", () => {
    const onRetry = vi.fn();
    const r = reply({
      id: "r-bad",
      enqueuedCommentId: null,
      enqueueError: true,
    });
    const { container } = render(
      <ReplyThread
        replies={[r]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        onRetryReply={onRetry}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    const pip = container.querySelector(".reply__pip--errored") as HTMLElement;
    fireEvent.click(pip);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("r-bad");
  });

  it("delivered wins over errored when both are technically true (delivered is the source of truth)", () => {
    // Scenario: a successful retry races with a stale `enqueueError = true`
    // that wasn't cleared before the delivery landed. The pip should still
    // show ✓ delivered.
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        replies={[
          reply({
            enqueuedCommentId: "cmt_1",
            enqueueError: true,
          }),
        ]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{ cmt_1: d }}
      />,
    );
    expect(container.querySelector(".reply__pip--errored")).toBeNull();
    expect(container.querySelector(".reply__pip--delivered")).not.toBeNull();
  });

  it("queued (id set, undelivered) wins over errored — id-set means the latest attempt succeeded", () => {
    // After a successful retry the parent dispatches PATCH_REPLY_ENQUEUED_ID
    // and SET_REPLY_ENQUEUE_ERROR (false). If the second action is racing
    // behind the first, the user briefly sees ◌ queued with a stale error
    // flag — that should still render as queued, not errored.
    const { container } = render(
      <ReplyThread
        replies={[
          reply({ enqueuedCommentId: "cmt_1", enqueueError: true }),
        ]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{}}
      />,
    );
    expect(container.querySelector(".reply__pip--errored")).toBeNull();
    expect(container.querySelector(".reply__pip--queued")).not.toBeNull();
  });

  it("renders no pip when neither id nor error is set", () => {
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: null })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    expect(container.querySelector(".reply__pip")).toBeNull();
  });

  it("after a successful retry the pip flips back to ◌ queued", () => {
    // Render once with the errored state, then re-render with the patched
    // Reply (id set, error cleared) — the pip should be queued.
    const { container, rerender } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: null, enqueueError: true })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        onRetryReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    expect(container.querySelector(".reply__pip--errored")).not.toBeNull();
    rerender(
      <ReplyThread
        replies={[
          reply({ enqueuedCommentId: "cmt_99", enqueueError: false }),
        ]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        onRetryReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{}}
      />,
    );
    expect(container.querySelector(".reply__pip--errored")).toBeNull();
    expect(container.querySelector(".reply__pip--queued")).not.toBeNull();
  });
});

describe("ReplyThread — agentReplies (nested under parent Reply)", () => {
  it("renders nothing extra when agentReplies is absent or empty", () => {
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: "cmt_1" })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    expect(container.querySelector(".agent-reply")).toBeNull();
  });

  it("renders one nested block per AgentReply with outcome icon, label, body and timestamp", () => {
    const r = reply({
      enqueuedCommentId: "cmt_1",
      agentReplies: [
        {
          id: "ar1",
          body: "fixed it",
          outcome: "addressed",
          postedAt: "2026-05-06T12:35:01.000Z",
        },
        {
          id: "ar2",
          body: "won't fix",
          outcome: "declined",
          postedAt: "2026-05-06T12:36:01.000Z",
        },
        {
          id: "ar3",
          body: "noted",
          outcome: "noted",
          postedAt: "2026-05-06T12:37:01.000Z",
        },
      ],
    });
    const { container } = render(
      <ReplyThread
        replies={[r]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    const blocks = container.querySelectorAll(".agent-reply");
    expect(blocks.length).toBe(3);
    // Generic agent label appears on each.
    blocks.forEach((b) =>
      expect(b.querySelector(".agent-reply__label")?.textContent).toBe("agent"),
    );
    // Outcome modifier classes pin to the spec values.
    expect(
      container.querySelector(".agent-reply--addressed"),
    ).not.toBeNull();
    expect(container.querySelector(".agent-reply--declined")).not.toBeNull();
    expect(container.querySelector(".agent-reply--noted")).not.toBeNull();
    // Bodies render verbatim.
    const bodies = Array.from(
      container.querySelectorAll(".agent-reply__body"),
    ).map((el) => el.textContent);
    expect(bodies).toEqual(["fixed it", "won't fix", "noted"]);
  });

  it("stacks agent replies in postedAt ascending order even when input is unsorted", () => {
    const r = reply({
      enqueuedCommentId: "cmt_1",
      agentReplies: [
        {
          id: "z",
          body: "Z",
          outcome: "addressed",
          postedAt: "2026-05-06T12:38:01.000Z",
        },
        {
          id: "a",
          body: "A",
          outcome: "noted",
          postedAt: "2026-05-06T12:35:01.000Z",
        },
      ],
    });
    const { container } = render(
      <ReplyThread
        replies={[r]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
      />,
    );
    const bodies = Array.from(
      container.querySelectorAll(".agent-reply__body"),
    ).map((el) => el.textContent);
    expect(bodies).toEqual(["A", "Z"]);
  });
});

describe("ReplyThread — pip tooltips", () => {
  it("queued tooltip uses the exact 'Sent to your agent's queue at HH:MM:SS.' prefix", () => {
    const { container } = render(
      <ReplyThread
        replies={[
          reply({
            enqueuedCommentId: "cmt_1",
            createdAt: "2026-05-06T12:34:56.000Z",
          }),
        ]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{}}
      />,
    );
    const pip = container.querySelector(".reply__pip--queued") as HTMLElement;
    const title = pip.getAttribute("title") ?? "";
    // Regex-tolerant on the timestamp; exact on the prefix/suffix per spec.
    expect(title).toMatch(/^Sent to your agent's queue at \d{2}:\d{2}:\d{2}\.$/);
  });

  it("delivered tooltip uses the exact 'Fetched by your agent at HH:MM:SS.' prefix", () => {
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        replies={[reply({ enqueuedCommentId: "cmt_1" })]}
        isDrafting={false}
        draftBody=""
        onStartDraft={noop}
        onCloseDraft={noop}
        onChangeDraft={noop}
        onSubmitReply={noop}
        onDeleteReply={noop}
        symbols={emptySymbols()}
        onJump={noop}
        deliveredById={{ cmt_1: d }}
      />,
    );
    const pip = container.querySelector(".reply__pip--delivered") as HTMLElement;
    const title = pip.getAttribute("title") ?? "";
    expect(title).toMatch(/^Fetched by your agent at \d{2}:\d{2}:\d{2}\.$/);
  });
});
