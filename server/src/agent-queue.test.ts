import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  enqueue,
  pullAndAck,
  listDelivered,
  postAgentComment,
  listAgentComments,
  isAgentCommentId,
  unenqueue,
  formatPayload,
  resetForTests,
  type AgentComment,
  type Comment,
} from "./agent-queue.ts";
import { assertGitDir } from "./worktree-validation.ts";

const execFileAsync = promisify(execFile);

const WT = "/tmp/example-worktree-fixture";

function makeBase(): Omit<Comment, "id" | "enqueuedAt"> {
  return {
    kind: "block",
    file: "src/foo.ts",
    lines: "10-12",
    body: "hello",
    commitSha: "abc123",
    supersedes: null,
  };
}

beforeEach(() => {
  resetForTests();
});

describe("enqueue / pullAndAck round trip", () => {
  it("returns the enqueued comments on first pull, empty on second", () => {
    const ids = enqueue(WT, [makeBase()]);
    expect(ids).toHaveLength(1);
    const first = pullAndAck(WT);
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe(ids[0]);
    expect(first[0].enqueuedAt).toBeTruthy();
    const second = pullAndAck(WT);
    expect(second).toHaveLength(0);
  });

  it("moves pulled comments into delivered with deliveredAt stamped", () => {
    enqueue(WT, [makeBase()]);
    pullAndAck(WT);
    const delivered = listDelivered(WT);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].deliveredAt).toBeTruthy();
  });
});

describe("sort order", () => {
  it("sorts by file path asc, then line lower-bound asc", () => {
    enqueue(WT, [
      { ...makeBase(), file: "src/b.ts", lines: "10" },
      { ...makeBase(), file: "src/a.ts", lines: "100" },
      { ...makeBase(), file: "src/a.ts", lines: "72-79" },
      { ...makeBase(), file: "src/a.ts", lines: "20" },
    ]);

    const pulled = pullAndAck(WT);
    const out = formatPayload(pulled, "sha");
    const order = [...out.matchAll(/<comment ([^>]+)>([^<]*)<\/comment>/g)].map(
      (m) => {
        const fileMatch = m[1].match(/file="([^"]+)"/);
        const linesMatch = m[1].match(/lines="([^"]+)"/);
        const file = fileMatch ? fileMatch[1] : "<free>";
        const lines = linesMatch ? linesMatch[1] : "-";
        return { key: `${file}:${lines}`, body: m[2] };
      },
    );
    expect(order.map((o) => o.key)).toEqual([
      "src/a.ts:20",
      "src/a.ts:72-79",
      "src/a.ts:100",
      "src/b.ts:10",
    ]);
  });

  it("parses '72-79' to lower bound 72 (less than 100)", () => {
    enqueue(WT, [
      { ...makeBase(), file: "x.ts", lines: "100" },
      { ...makeBase(), file: "x.ts", lines: "72-79" },
    ]);
    const out = formatPayload(pullAndAck(WT), "sha");
    const linesAttrs = [...out.matchAll(/lines="([^"]+)"/g)].map((m) => m[1]);
    expect(linesAttrs).toEqual(["72-79", "100"]);
  });
});

describe("supersession resolution", () => {
  it("drops the predecessor when both are still pending", () => {
    const [aId] = enqueue(WT, [{ ...makeBase(), body: "A" }]);
    enqueue(WT, [{ ...makeBase(), body: "B", supersedes: aId }]);
    const out = pullAndAck(WT);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("B");
  });

  it("preserves the predecessor when it is already delivered, and surfaces the supersedes attr", () => {
    const [aId] = enqueue(WT, [{ ...makeBase(), body: "A" }]);
    pullAndAck(WT);
    enqueue(WT, [{ ...makeBase(), body: "B", supersedes: aId }]);
    const out = pullAndAck(WT);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("B");
    expect(out[0].supersedes).toBe(aId);
    const delivered = listDelivered(WT);
    expect(delivered).toHaveLength(2);
  });

  it("passes through unknown supersedes ids defensively", () => {
    enqueue(WT, [
      { ...makeBase(), body: "B", supersedes: "no-such-id-12345" },
    ]);
    const out = pullAndAck(WT);
    expect(out).toHaveLength(1);
    expect(out[0].supersedes).toBe("no-such-id-12345");
  });

  it("collapses chains {A→B→C} to just C in a single pull", () => {
    const [aId] = enqueue(WT, [{ ...makeBase(), body: "A" }]);
    const [bId] = enqueue(WT, [{ ...makeBase(), body: "B", supersedes: aId }]);
    enqueue(WT, [{ ...makeBase(), body: "C", supersedes: bId }]);
    const out = pullAndAck(WT);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("C");
    expect(out[0].supersedes).toBe(bId);
  });
});

describe("unenqueue", () => {
  it("removes a pending comment", () => {
    const [id] = enqueue(WT, [makeBase()]);
    expect(unenqueue(WT, id)).toBe(true);
    const out = pullAndAck(WT);
    expect(out).toHaveLength(0);
  });

  it("is a no-op for a delivered id", () => {
    const [id] = enqueue(WT, [makeBase()]);
    pullAndAck(WT);
    expect(unenqueue(WT, id)).toBe(false);
  });

  it("is a no-op for an unknown id", () => {
    expect(unenqueue(WT, "no-such-id")).toBe(false);
  });
});

describe("AgentComment shape", () => {
  it("accepts the reply form (parent set, anchor absent)", () => {
    const reply: AgentComment = {
      id: "r1",
      body: "fixed",
      postedAt: "2025-01-01T00:00:00Z",
      parent: { commentId: "c1", outcome: "addressed" },
    };
    expect(reply.parent.commentId).toBe("c1");
    expect(reply.parent.outcome).toBe("addressed");
  });

  it("accepts the top-level form (anchor set, parent absent)", () => {
    const root: AgentComment = {
      id: "r2",
      body: "I notice this file lacks tests",
      postedAt: "2025-01-01T00:00:00Z",
      anchor: { file: "src/foo.ts", lines: "42-58" },
    };
    expect(root.anchor.file).toBe("src/foo.ts");
    expect(root.anchor.lines).toBe("42-58");
  });
});

describe("postAgentComment / listAgentComments", () => {
  it("reply payload assigns id + postedAt and appends to the worktree's list", () => {
    const id = postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "addressed" },
      body: "fixed it",
    });
    expect(id).toBeTruthy();
    const replies = listAgentComments(WT);
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe(id);
    expect(replies[0].parent?.commentId).toBe("c1");
    expect(replies[0].body).toBe("fixed it");
    expect(replies[0].parent?.outcome).toBe("addressed");
    expect(replies[0].postedAt).toBeTruthy();
  });

  it("top-level payload assigns id + postedAt and lands in the same list", () => {
    const id = postAgentComment(WT, {
      anchor: { file: "src/foo.ts", lines: "42-58" },
      body: "I notice this block lacks tests",
    });
    expect(id).toBeTruthy();
    const entries = listAgentComments(WT);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
    expect(entries[0].anchor?.file).toBe("src/foo.ts");
    expect(entries[0].anchor?.lines).toBe("42-58");
    expect(entries[0].parent).toBeUndefined();
    expect(entries[0].postedAt).toBeTruthy();
  });

  it("appends rather than overwrites repeated replies to the same commentId", () => {
    postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "noted" },
      body: "first",
    });
    postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "addressed" },
      body: "second",
    });
    const replies = listAgentComments(WT);
    expect(replies).toHaveLength(2);
    expect(replies.map((r) => r.body)).toEqual(["first", "second"]);
  });

  it("interleaves reply-shaped and top-level-shaped entries in the same list", () => {
    postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "noted" },
      body: "reply",
    });
    postAgentComment(WT, {
      anchor: { file: "x.ts", lines: "1" },
      body: "top-level",
    });
    const entries = listAgentComments(WT);
    expect(entries).toHaveLength(2);
    expect(entries[0].parent).toBeDefined();
    expect(entries[1].anchor).toBeDefined();
  });

  it("returns entries sorted by postedAt ascending", async () => {
    postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "noted" },
      body: "a",
    });
    // Force a measurable timestamp gap so the ascending order is observable
    // even on machines where two consecutive Date.now() calls collapse.
    await new Promise((r) => setTimeout(r, 5));
    postAgentComment(WT, {
      parent: { commentId: "c2", outcome: "noted" },
      body: "b",
    });
    const replies = listAgentComments(WT);
    expect(replies.map((r) => r.body)).toEqual(["a", "b"]);
    expect(
      replies[0].postedAt.localeCompare(replies[1].postedAt),
    ).toBeLessThanOrEqual(0);
  });

  it("listAgentComments returns [] for an unknown worktree", () => {
    expect(listAgentComments("/tmp/no-such-worktree")).toEqual([]);
  });

  it("resetForTests clears the agent-comment store", () => {
    postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "addressed" },
      body: "x",
    });
    resetForTests();
    expect(listAgentComments(WT)).toEqual([]);
  });

  it("caps the per-worktree list at the history limit", () => {
    // Mirror the delivered-history-cap behaviour: oldest entries aged out
    // once we cross the cap. Defends against a noisy agent in a
    // long-lived process.
    for (let i = 0; i < 250; i++) {
      postAgentComment(WT, {
        parent: { commentId: "c1", outcome: "noted" },
        body: `r-${i}`,
      });
    }
    const replies = listAgentComments(WT);
    expect(replies).toHaveLength(200);
    // Append-order, oldest first → oldest retained is r-50.
    expect(replies[0].body).toBe("r-50");
    expect(replies[199].body).toBe("r-249");
  });
});

describe("isAgentCommentId", () => {
  it("returns true for an id present in the worktree's store", () => {
    const id = postAgentComment(WT, {
      anchor: { file: "src/foo.ts", lines: "1" },
      body: "x",
    });
    expect(isAgentCommentId(WT, id)).toBe(true);
  });

  it("returns false for an unknown id", () => {
    postAgentComment(WT, {
      anchor: { file: "src/foo.ts", lines: "1" },
      body: "x",
    });
    expect(isAgentCommentId(WT, "no-such-id")).toBe(false);
  });

  it("returns false for an unknown worktreePath", () => {
    postAgentComment(WT, {
      anchor: { file: "src/foo.ts", lines: "1" },
      body: "x",
    });
    expect(isAgentCommentId("/tmp/other-worktree", "anything")).toBe(false);
  });

  it("recognizes reply-shaped entries too (single store, both shapes)", () => {
    const id = postAgentComment(WT, {
      parent: { commentId: "c1", outcome: "addressed" },
      body: "fixed",
    });
    expect(isAgentCommentId(WT, id)).toBe(true);
  });
});

describe("delivered history cap", () => {
  it("retains only the most recent 200 delivered comments", () => {
    for (let i = 0; i < 250; i++) {
      enqueue(WT, [{ ...makeBase(), body: `body-${i}` }]);
      pullAndAck(WT);
    }
    const delivered = listDelivered(WT);
    expect(delivered).toHaveLength(200);
    // newest first → first entry should be body-249
    expect(delivered[0].body).toBe("body-249");
    // oldest retained is body-50; body-49 and below were dropped
    expect(delivered[199].body).toBe("body-50");
  });
});

describe("assertGitDir", () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    for (const d of tmpDirs) {
      await fs.rm(d, { recursive: true, force: true });
    }
  });

  it("rejects relative paths", async () => {
    await expect(assertGitDir("relative/path")).rejects.toThrow(/absolute/);
  });

  it("rejects '..'-laced paths", async () => {
    await expect(assertGitDir("/tmp/../etc")).rejects.toThrow(/'\.\.'/);
  });

  it("rejects an absolute path that isn't a git dir", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-nogit-"));
    tmpDirs.push(dir);
    await expect(assertGitDir(dir)).rejects.toThrow(/no \.git entry/);
  });

  it("accepts a real git-init'd directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-git-"));
    tmpDirs.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    await expect(assertGitDir(dir)).resolves.toBeUndefined();
  });
});

describe("formatPayload", () => {
  it("returns the empty string for an empty list", () => {
    expect(formatPayload([], "abc")).toBe("");
  });

  it("strips ]]> from comment bodies", () => {
    const c: Comment = {
      id: "1",
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "before ]]> after",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "sha");
    expect(out).not.toContain("]]>");
    expect(out).toContain("before ]] after");
  });

  it("preserves backticks and angle brackets in markdown bodies", () => {
    const c: Comment = {
      id: "1",
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "see `foo<bar>` and <baz>",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "sha");
    expect(out).toContain("see `foo<bar>` and <baz>");
  });

  it("XML-escapes the id attribute (defensive — ids are randomUUID today, but the contract holds for any id)", () => {
    const c: Comment = {
      id: 'wat"y&<id>',
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "x",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "sha");
    expect(out).toContain(`id="wat&quot;y&amp;&lt;id&gt;"`);
    expect(out).not.toContain('id="wat"y');
  });

  it("XML-escapes attribute values (quotes, ampersand, brackets)", () => {
    const c: Comment = {
      id: "1",
      kind: "block",
      file: 'has"quote&amp.ts',
      lines: "10",
      body: "x",
      commitSha: "s<h>a",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "s<h>a");
    expect(out).toContain(`commit="s&lt;h&gt;a"`);
    expect(out).toContain(`file="has&quot;quote&amp;amp.ts"`);
  });

  it("omits supersedes when null and includes it when set", () => {
    const a: Comment = {
      id: "1",
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "no super",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const b: Comment = {
      id: "2",
      kind: "block",
      file: "b.ts",
      lines: "1",
      body: "with super",
      commitSha: "sha",
      supersedes: "old-id-99",
      enqueuedAt: "2025-01-01T00:00:01Z",
    };
    const out = formatPayload([a, b], "sha");
    // first comment block must not contain a supersedes attr
    const aBlock = out.split("</comment>")[0];
    expect(aBlock).not.toContain("supersedes=");
    expect(out).toContain('supersedes="old-id-99"');
  });

  it("emits the reviewer-feedback envelope with the commit attribute", () => {
    const c: Comment = {
      id: "1",
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "x",
      commitSha: "deadbeef",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "deadbeef");
    expect(out).toMatch(
      /^<reviewer-feedback from="shippable" commit="deadbeef">/,
    );
    expect(out).toMatch(/<\/reviewer-feedback>$/);
  });

  it("inlines the parent agent comment for kind reply-to-agent-comment", () => {
    const parent: AgentComment = {
      id: "ac-1",
      body: "I notice this block lacks tests",
      postedAt: "2025-01-01T00:00:00Z",
      anchor: { file: "src/foo.ts", lines: "42-58" },
    };
    const c: Comment = {
      id: "c1",
      kind: "reply-to-agent-comment",
      file: "src/foo.ts",
      lines: "42-58",
      body: "good catch, will add",
      commitSha: "sha",
      supersedes: null,
      parentAgentCommentId: "ac-1",
      enqueuedAt: "2025-01-01T00:01:00Z",
    };
    const out = formatPayload([c], "sha", (id) => (id === "ac-1" ? parent : null));
    expect(out).toContain('kind="reply-to-agent-comment"');
    expect(out).toContain('parent-id="ac-1"');
    expect(out).not.toContain('parent-missing="true"');
    expect(out).toContain('<parent id="ac-1" file="src/foo.ts" lines="42-58">');
    expect(out).toContain("I notice this block lacks tests</parent>");
  });

  it("emits parent-missing when the parent agent comment isn't in the store", () => {
    const c: Comment = {
      id: "c1",
      kind: "reply-to-agent-comment",
      file: "src/foo.ts",
      lines: "42-58",
      body: "good catch, will add",
      commitSha: "sha",
      supersedes: null,
      parentAgentCommentId: "ac-gone",
      enqueuedAt: "2025-01-01T00:01:00Z",
    };
    const out = formatPayload([c], "sha", () => null);
    expect(out).toContain('parent-id="ac-gone"');
    expect(out).toContain('parent-missing="true"');
    expect(out).not.toContain("<parent ");
  });

  it("escapes parent-id, parent attrs, and parent body", () => {
    const parent: AgentComment = {
      id: 'id"a&<b>',
      body: "before ]]> after & <tag>",
      postedAt: "2025-01-01T00:00:00Z",
      anchor: { file: 'q"&.ts', lines: "1" },
    };
    const c: Comment = {
      id: "c1",
      kind: "reply-to-agent-comment",
      file: "src/foo.ts",
      lines: "1",
      body: "x",
      commitSha: "sha",
      supersedes: null,
      parentAgentCommentId: 'id"a&<b>',
      enqueuedAt: "2025-01-01T00:01:00Z",
    };
    const out = formatPayload([c], "sha", () => parent);
    expect(out).toContain(`parent-id="id&quot;a&amp;&lt;b&gt;"`);
    expect(out).toContain(`<parent id="id&quot;a&amp;&lt;b&gt;" file="q&quot;&amp;.ts" lines="1">`);
    expect(out).not.toContain("]]>");
    expect(out).toContain("before ]] after & <tag></parent>");
  });

  it("leaves non-reply-to-agent-comment kinds unchanged", () => {
    const c: Comment = {
      id: "c1",
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "x",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:01:00Z",
    };
    const out = formatPayload([c], "sha", () => null);
    expect(out).not.toContain("parent-id");
    expect(out).not.toContain("<parent ");
    expect(out).not.toContain("parent-missing");
  });

  it("emits an id attribute on each <comment> so the agent can post replies", () => {
    // The agent-reply flow needs the comment id surfaced in the envelope —
    // pull-and-ack drains the queue, so this is the agent's only chance to
    // capture the id. Regression test for an early bug where the id was
    // server-internal only.
    const c: Comment = {
      id: "comment-id-abc-123",
      kind: "block",
      file: "a.ts",
      lines: "1",
      body: "x",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "sha");
    expect(out).toContain('id="comment-id-abc-123"');
    // id is the first attribute so the agent reads it before the body.
    expect(out).toMatch(/<comment id="comment-id-abc-123" file=/);
  });
});
