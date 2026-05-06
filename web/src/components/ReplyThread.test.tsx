// @vitest-environment jsdom
// Component tests for ReplyThread's pip rendering. The pip state machine
// + tooltip copy is a load-bearing UI contract from the
// share-review-comments plan; these tests pin the strings.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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
