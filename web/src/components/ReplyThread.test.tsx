// @vitest-environment jsdom
// Component tests for ReplyThread's pip rendering. The pip state machine
// + tooltip copy is a load-bearing UI contract from the
// share-review-comments plan; these tests pin the strings.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ReplyThread } from "./ReplyThread";
import type { DeliveredInteraction, Interaction } from "../types";

function userIx(over: Partial<Interaction> = {}): Interaction {
  return {
    id: "r1",
    threadKey: "user:cs/f#h:0",
    target: "line",
    intent: "comment",
    author: "you",
    authorRole: "user",
    body: "hello",
    createdAt: "2026-05-06T12:34:56.000Z",
    enqueuedCommentId: null,
    ...over,
  };
}

function agentIx(over: Partial<Interaction> = {}): Interaction {
  return {
    id: "ar1",
    threadKey: "user:cs/f#h:0",
    target: "reply-to-user",
    intent: "accept",
    author: "agent",
    authorRole: "agent",
    body: "fixed it",
    createdAt: "2026-05-06T12:35:01.000Z",
    ...over,
  };
}

function delivered(id: string, deliveredAt: string): DeliveredInteraction {
  return {
    id,
    target: "line",
    intent: "comment",
    author: "you",
    authorRole: "user",
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
        interactions={[userIx({ enqueuedCommentId: null })]}
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
        interactions={[userIx({ enqueuedCommentId: "cmt_1" })]}
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
        interactions={[userIx({ enqueuedCommentId: "cmt_1" })]}
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
  const SPEC_TITLE_DELIVERED =
    "the agent already saw this; deleting only removes it from your view.";

  it("uses the spec string when the reply is in the delivered set", () => {
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        interactions={[userIx({ enqueuedCommentId: "cmt_1" })]}
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
        interactions={[userIx({ enqueuedCommentId: "cmt_1" })]}
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
        interactions={[userIx({ enqueuedCommentId: null })]}
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
  const ERR_TITLE = "Couldn't reach your agent — click to retry.";

  it("renders the errored pip with the spec glyph + title when enqueueError is true and no id is set", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ReplyThread
        interactions={[userIx({ enqueuedCommentId: null, enqueueError: true })]}
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
    const r = userIx({
      id: "r-bad",
      enqueuedCommentId: null,
      enqueueError: true,
    });
    const { container } = render(
      <ReplyThread
        interactions={[r]}
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
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        interactions={[
          userIx({ enqueuedCommentId: "cmt_1", enqueueError: true }),
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
    const { container } = render(
      <ReplyThread
        interactions={[
          userIx({ enqueuedCommentId: "cmt_1", enqueueError: true }),
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
        interactions={[userIx({ enqueuedCommentId: null })]}
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
    const { container, rerender } = render(
      <ReplyThread
        interactions={[userIx({ enqueuedCommentId: null, enqueueError: true })]}
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
        interactions={[
          userIx({ enqueuedCommentId: "cmt_99", enqueueError: false }),
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

describe("ReplyThread — agent replies as sibling Interactions", () => {
  it("renders nothing extra when no agent Interactions sit alongside the user one", () => {
    const { container } = render(
      <ReplyThread
        interactions={[userIx({ enqueuedCommentId: "cmt_1" })]}
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

  it("renders one row per agent Interaction with intent glyph, label, body and timestamp", () => {
    const user = userIx({ enqueuedCommentId: "cmt_1" });
    const agents = [
      agentIx({
        id: "ar1",
        body: "fixed it",
        intent: "accept",
        createdAt: "2026-05-06T12:35:01.000Z",
      }),
      agentIx({
        id: "ar2",
        body: "won't fix",
        intent: "reject",
        createdAt: "2026-05-06T12:36:01.000Z",
      }),
      agentIx({
        id: "ar3",
        body: "noted",
        intent: "ack",
        createdAt: "2026-05-06T12:37:01.000Z",
      }),
    ];
    const { container } = render(
      <ReplyThread
        interactions={[user, ...agents]}
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
    blocks.forEach((b) =>
      expect(b.querySelector(".agent-reply__label")?.textContent).toBe("agent"),
    );
    expect(container.querySelector(".agent-reply--accept")).not.toBeNull();
    expect(container.querySelector(".agent-reply--reject")).not.toBeNull();
    expect(container.querySelector(".agent-reply--ack")).not.toBeNull();
    const bodies = Array.from(
      container.querySelectorAll(".agent-reply__body"),
    ).map((el) => el.textContent);
    expect(bodies).toEqual(["fixed it", "won't fix", "noted"]);
  });

  it("renders agent rows in input order — callers (selectInteractions) sort by createdAt", () => {
    const user = userIx({ enqueuedCommentId: "cmt_1" });
    const a = agentIx({
      id: "a",
      body: "A",
      intent: "ack",
      createdAt: "2026-05-06T12:35:01.000Z",
    });
    const z = agentIx({
      id: "z",
      body: "Z",
      intent: "accept",
      createdAt: "2026-05-06T12:38:01.000Z",
    });
    const { container } = render(
      <ReplyThread
        interactions={[user, a, z]}
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
        interactions={[
          userIx({
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
    expect(title).toMatch(/^Sent to your agent's queue at \d{2}:\d{2}:\d{2}\.$/);
  });

  it("delivered tooltip uses the exact 'Fetched by your agent at HH:MM:SS.' prefix", () => {
    const d = delivered("cmt_1", "2026-05-06T12:35:01.000Z");
    const { container } = render(
      <ReplyThread
        interactions={[userIx({ enqueuedCommentId: "cmt_1" })]}
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
