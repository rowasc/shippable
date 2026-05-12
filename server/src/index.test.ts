import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
  afterEach,
} from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

const execFileAsync = promisify(execFile);

// Defensive: index.ts no longer requires ANTHROPIC_API_KEY at import time
// (the check moved into main()), but set this anyway in case future edits
// reintroduce it.
process.env.ANTHROPIC_API_KEY = "test";

let server: Server;
let baseUrl: string;
let worktreePath: string;
let resetForTests: () => void;
let resetAuthStore: () => void;

interface JsonResponse {
  status: number;
  // We accept any shape because each endpoint returns a different one;
  // assertions in tests narrow as needed.
  body: any;
}

async function getJson(url: string): Promise<JsonResponse> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

async function postJson(url: string, body: unknown): Promise<JsonResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-int-"));
  await execFileAsync("git", ["init"], { cwd: worktreePath });

  const indexMod = await import("./index.ts");
  const queueMod = await import("./agent-queue.ts");
  const authMod = await import("./auth/store.ts");
  resetForTests = queueMod.resetForTests;
  resetAuthStore = authMod.resetForTests;

  server = indexMod.createApp();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("server.address() not an object");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await fs.rm(worktreePath, { recursive: true, force: true });
});

beforeEach(() => {
  resetForTests();
  resetAuthStore();
});

describe("POST /api/agent/enqueue", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/api/agent/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects when worktreePath is missing", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      commitSha: "abc",
      comment: { kind: "block", body: "x" },
    });
    expect(r.status).toBe(400);
  });

  it("rejects when worktreePath is not a git dir", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath: "/tmp/this-does-not-exist-xyz-123",
      commitSha: "abc",
      comment: { kind: "block", body: "x" },
    });
    expect(r.status).toBe(400);
  });

  it("returns { id } on success", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc123",
      comment: {
        kind: "block",
        file: "src/foo.ts",
        lines: "10-12",
        body: "hello",
      },
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.id).toBe("string");
    expect(r.body.id.length).toBeGreaterThan(0);
  });

  it("rejects when comment.kind is missing", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { body: "x" },
    });
    expect(r.status).toBe(400);
  });

  it("rejects when comment.kind is an unrecognised string", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { kind: "not-a-real-kind", body: "x" },
    });
    expect(r.status).toBe(400);
  });

  it("accepts kind 'reply-to-agent-comment' and persists parentAgentCommentId", async () => {
    // First, post a top-level agent comment to mint an id we can reference.
    const ac = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      anchor: { file: "src/foo.ts", lines: "42-58" },
      body: "I notice this block lacks tests",
    });
    const agentCommentId = ac.body.id as string;

    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc123",
      comment: {
        kind: "reply-to-agent-comment",
        file: "src/foo.ts",
        lines: "42-58",
        body: "good catch, will add",
        parentAgentCommentId: agentCommentId,
      },
    });
    expect(enq.status).toBe(200);
    expect(typeof enq.body.id).toBe("string");

    // Pull and inspect the envelope to confirm the field round-tripped: the
    // pulled comment carries parent-id and the parent body is inlined.
    const pulled = await postJson(`${baseUrl}/api/agent/pull`, {
      worktreePath,
    });
    expect(pulled.body.payload).toContain('kind="reply-to-agent-comment"');
    expect(pulled.body.payload).toContain(`parent-id="${agentCommentId}"`);
    expect(pulled.body.payload).toContain("I notice this block lacks tests");
  });

  it("rejects 'reply-to-agent-comment' without parentAgentCommentId", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: {
        kind: "reply-to-agent-comment",
        file: "src/foo.ts",
        lines: "1",
        body: "x",
      },
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/parentAgentCommentId/);
  });

  it("rejects 'reply-to-agent-comment' with an unknown parentAgentCommentId", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: {
        kind: "reply-to-agent-comment",
        file: "src/foo.ts",
        lines: "1",
        body: "x",
        parentAgentCommentId: "no-such-agent-comment",
      },
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/is not an agent comment/);
  });

  it("rejects 'reply-to-agent-comment' whose parentAgentCommentId points at a reply-shaped agent entry", async () => {
    // The agent first posts a reply (parent shape) under some delivered
    // reviewer comment, then a reviewer somehow tries to enqueue a
    // reply-to-agent-comment pointing at that reply's id. Only top-level
    // (anchor-shaped) entries can legitimately parent a reviewer reply.
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "hi" },
    });
    const realCommentId = enq.body.id as string;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });
    const replyShaped = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: realCommentId, outcome: "addressed" },
      body: "fixed",
    });
    const replyShapedId = replyShaped.body.id as string;

    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: {
        kind: "reply-to-agent-comment",
        file: "a.ts",
        lines: "1",
        body: "x",
        parentAgentCommentId: replyShapedId,
      },
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/is not an agent comment/);
  });

  it("rejects malformed comment.lines on enqueue", async () => {
    const r = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: {
        kind: "block",
        file: "a.ts",
        lines: "abc",
        body: "x",
      },
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/lines/);
  });
});

describe("POST /api/agent/pull", () => {
  it("returns the formatted envelope", async () => {
    await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: {
        kind: "block",
        file: "src/foo.ts",
        lines: "10",
        body: "hello",
      },
    });
    const r = await postJson(`${baseUrl}/api/agent/pull`, {
      worktreePath,
    });
    expect(r.status).toBe(200);
    expect(r.body.payload).toMatch(/^<reviewer-feedback /);
    expect(r.body.payload).toContain('commit="deadbeef"');
    expect(r.body.payload).toContain("hello");
    expect(Array.isArray(r.body.ids)).toBe(true);
    expect(r.body.ids).toHaveLength(1);
  });

  it("first wins: a second pull returns an empty queue", async () => {
    await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "x" },
    });
    const [r1, r2] = await Promise.all([
      postJson(`${baseUrl}/api/agent/pull`, { worktreePath }),
      postJson(`${baseUrl}/api/agent/pull`, { worktreePath }),
    ]);
    const nonEmpty = [r1, r2].filter((r) => r.body.ids.length > 0);
    const empty = [r1, r2].filter((r) => r.body.ids.length === 0);
    expect(nonEmpty).toHaveLength(1);
    expect(empty).toHaveLength(1);
    expect(empty[0].body.payload).toBe("");
  });
});

describe("GET /api/agent/delivered", () => {
  it("rejects requests without ?path=", async () => {
    const r = await getJson(`${baseUrl}/api/agent/delivered`);
    expect(r.status).toBe(400);
  });

  it("returns delivered comments newest-first", async () => {
    await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "first" },
    });
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });
    await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "second" },
    });
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });

    const r = await getJson(
      `${baseUrl}/api/agent/delivered?path=${encodeURIComponent(worktreePath)}`,
    );
    expect(r.status).toBe(200);
    expect(r.body.delivered).toHaveLength(2);
    expect(r.body.delivered[0].body).toBe("second");
    expect(r.body.delivered[1].body).toBe("first");
  });

  it("round-trips a worktree path containing spaces through URL encoding", async () => {
    const spacedPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "shippable test "),
    );
    try {
      await execFileAsync("git", ["init"], { cwd: spacedPath });
      const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
        worktreePath: spacedPath,
        commitSha: "abc",
        comment: { kind: "block", file: "a.ts", lines: "1", body: "spaced" },
      });
      expect(enq.status).toBe(200);
      await postJson(`${baseUrl}/api/agent/pull`, { worktreePath: spacedPath });

      const r = await getJson(
        `${baseUrl}/api/agent/delivered?path=${encodeURIComponent(spacedPath)}`,
      );
      expect(r.status).toBe(200);
      expect(r.body.delivered).toHaveLength(1);
      expect(r.body.delivered[0].body).toBe("spaced");
    } finally {
      await fs.rm(spacedPath, { recursive: true, force: true });
    }
  });
});

describe("legacy endpoints are gone (slice 5 cleanup)", () => {
  // The slice-1 hook + inbox channel was removed in slice 5. Hitting any of
  // the four old endpoints should fall through the router and return 404
  // rather than the prior shapes — confirms the handlers are unreachable.
  it("GET /api/worktrees/hook-status returns 404", async () => {
    const r = await getJson(`${baseUrl}/api/worktrees/hook-status`);
    expect(r.status).toBe(404);
  });

  it("POST /api/worktrees/install-hook returns 404", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/install-hook`, {});
    expect(r.status).toBe(404);
  });

  it("POST /api/worktrees/inbox returns 404", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/inbox`, {
      path: worktreePath,
      message: "x",
    });
    expect(r.status).toBe(404);
  });

  it("POST /api/worktrees/inbox-status returns 404", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/inbox-status`, {
      path: worktreePath,
    });
    expect(r.status).toBe(404);
  });
});

describe("GET /api/worktrees/mcp-status (slice 5)", () => {
  // Regardless of whether the local user has `shippable` declared in their
  // ~/.claude config, the endpoint should return the `{ installed, installCommand }`
  // shape with no error. The mcp-status helper has its own unit tests for
  // detection logic and the install-command resolver; this just confirms the
  // route is wired and returns the right shape.
  it("returns { installed: boolean; installCommand: string }", async () => {
    const r = await getJson(`${baseUrl}/api/worktrees/mcp-status`);
    expect(r.status).toBe(200);
    expect(typeof r.body.installed).toBe("boolean");
    expect(typeof r.body.installCommand).toBe("string");
    expect(r.body.installCommand).toMatch(/^claude mcp add shippable -- /);
  });
});

describe("request body size cap", () => {
  it("rejects an oversized body with HTTP 413 and a useful error", async () => {
    // ~2 MiB of JSON-safe filler. Any endpoint that consumes a body will
    // trip the cap; pick the comments POST since it's the most recently
    // touched one.
    const huge = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/api/agent/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktreePath,
        anchor: { file: "a.ts", lines: "1" },
        body: huge,
      }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(String(body.error)).toMatch(/exceeds.*bytes/);
  });
});

describe("POST /api/agent/comments — reply shape", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/api/agent/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects when worktreePath is missing", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      parent: { commentId: "c1", outcome: "addressed" },
      body: "x",
    });
    expect(r.status).toBe(400);
  });

  it("rejects when worktreePath is not a git dir", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath: "/tmp/this-does-not-exist-xyz-456",
      parent: { commentId: "c1", outcome: "addressed" },
      body: "x",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an invalid outcome", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: "c1", outcome: "made-up" },
      body: "x",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: "c1", outcome: "addressed" },
      body: "",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an unknown commentId (not in delivered set for this worktree)", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: "no-such-id", outcome: "noted" },
      body: "x",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/not a delivered comment/);
  });

  it("returns { id } on success and persists via GET", async () => {
    // Enqueue + pull to mint a real delivered commentId — the comments
    // endpoint validates that parent.commentId belongs to the worktree's
    // delivered set (defensive per spec § Data Flow).
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "hi" },
    });
    const realCommentId = enq.body.id as string;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });

    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: realCommentId, outcome: "addressed" },
      body: "fixed it",
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.id).toBe("string");
    expect(r.body.id.length).toBeGreaterThan(0);

    const list = await getJson(
      `${baseUrl}/api/agent/comments?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.comments).toHaveLength(1);
    expect(list.body.comments[0].id).toBe(r.body.id);
    expect(list.body.comments[0].parent.outcome).toBe("addressed");
    expect(list.body.comments[0].parent.commentId).toBe(realCommentId);
    expect(list.body.comments[0].body).toBe("fixed it");
  });

  it("appends multiple replies to the same commentId", async () => {
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "hi" },
    });
    const realCommentId = enq.body.id as string;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });

    await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: realCommentId, outcome: "noted" },
      body: "first",
    });
    await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: realCommentId, outcome: "addressed" },
      body: "second",
    });
    const list = await getJson(
      `${baseUrl}/api/agent/comments?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.body.comments).toHaveLength(2);
    expect(list.body.comments.map((c: { body: string }) => c.body)).toEqual([
      "first",
      "second",
    ]);
  });

  it("caps the per-worktree agent-comment list at AGENT_COMMENT_HISTORY_CAP", async () => {
    // Mirror the delivered-history-cap regression test: post past the cap
    // and confirm the oldest entries are dropped.
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "hi" },
    });
    const realCommentId = enq.body.id as string;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });

    // Cap is 200; post 205 to spill 5.
    for (let i = 0; i < 205; i++) {
      await postJson(`${baseUrl}/api/agent/comments`, {
        worktreePath,
        parent: { commentId: realCommentId, outcome: "noted" },
        body: `reply-${i}`,
      });
    }
    const list = await getJson(
      `${baseUrl}/api/agent/comments?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.body.comments).toHaveLength(200);
    // Oldest retained should be reply-5; reply-0..4 dropped. Newest is
    // reply-204.
    expect(list.body.comments[0].body).toBe("reply-5");
    expect(list.body.comments[199].body).toBe("reply-204");
  });
});

describe("POST /api/agent/comments — top-level (anchor) shape", () => {
  it("returns { id } on success and persists via GET", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      anchor: { file: "src/foo.ts", lines: "42-58" },
      body: "I notice this block lacks tests",
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.id).toBe("string");

    const list = await getJson(
      `${baseUrl}/api/agent/comments?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.comments).toHaveLength(1);
    expect(list.body.comments[0].anchor.file).toBe("src/foo.ts");
    expect(list.body.comments[0].anchor.lines).toBe("42-58");
    expect(list.body.comments[0].parent).toBeUndefined();
  });

  it("rejects when anchor.file is missing or empty", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      anchor: { file: "", lines: "1" },
      body: "x",
    });
    expect(r.status).toBe(400);
  });

  it("rejects when anchor.lines is missing or empty (file-level disallowed in v0)", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      anchor: { file: "src/foo.ts" },
      body: "x",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/anchor\.lines/);
  });

  it("rejects malformed anchor.lines (not a single number or simple range)", async () => {
    const cases = ["abc", "1,2", "10..20", "10-", "-10", "10 to 20", "10\n11"];
    for (const lines of cases) {
      const r = await postJson(`${baseUrl}/api/agent/comments`, {
        worktreePath,
        anchor: { file: "src/foo.ts", lines },
        body: "x",
      });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toMatch(/lines/);
    }
  });

  it("rejects agentLabel longer than 64 chars", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      anchor: { file: "src/foo.ts", lines: "1" },
      body: "x",
      agentLabel: "x".repeat(65),
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/agentLabel/);
  });
});

describe("POST /api/agent/comments — shape discrimination", () => {
  it("rejects when both parent and anchor are set", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      parent: { commentId: "c1", outcome: "noted" },
      anchor: { file: "src/foo.ts", lines: "1" },
      body: "x",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/exactly one of/);
  });

  it("rejects when neither parent nor anchor is set", async () => {
    const r = await postJson(`${baseUrl}/api/agent/comments`, {
      worktreePath,
      body: "x",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/exactly one of/);
  });
});

describe("legacy /api/agent/replies routes are gone", () => {
  it("returns 404 for POST /api/agent/replies", async () => {
    const res = await fetch(`${baseUrl}/api/agent/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for GET /api/agent/replies", async () => {
    const res = await fetch(`${baseUrl}/api/agent/replies`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/agent/comments", () => {
  it("rejects requests without ?worktreePath=", async () => {
    const r = await getJson(`${baseUrl}/api/agent/comments`);
    expect(r.status).toBe(400);
  });

  it("rejects when worktreePath is not a git dir", async () => {
    const r = await getJson(
      `${baseUrl}/api/agent/comments?worktreePath=${encodeURIComponent("/tmp/nope-xyz")}`,
    );
    expect(r.status).toBe(400);
  });

  it("returns { comments: [] } for a worktree with none", async () => {
    const r = await getJson(
      `${baseUrl}/api/agent/comments?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(r.status).toBe(200);
    expect(r.body.comments).toEqual([]);
  });
});

describe("POST /api/agent/unenqueue", () => {
  it("drops a pending comment", async () => {
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "x" },
    });
    const id = enq.body.id;
    const un = await postJson(`${baseUrl}/api/agent/unenqueue`, {
      worktreePath,
      id,
    });
    expect(un.status).toBe(200);
    expect(un.body.unenqueued).toBe(true);
    const pull = await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });
    expect(pull.body.ids).toHaveLength(0);
  });

  it("is a no-op for an already-delivered id", async () => {
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "abc",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "x" },
    });
    const id = enq.body.id;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });
    const un = await postJson(`${baseUrl}/api/agent/unenqueue`, {
      worktreePath,
      id,
    });
    expect(un.status).toBe(200);
    expect(un.body.unenqueued).toBe(false);
  });
});

describe("POST /api/worktrees/file-at", () => {
  // Spin up a dedicated worktree with one commit so `git show <sha>:<file>`
  // has something to return. Kept self-contained so the surrounding test
  // suites don't have to know about its commit history.
  let viewWtPath: string;
  let viewSha: string;

  beforeAll(async () => {
    viewWtPath = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-view-"));
    await execFileAsync("git", ["init"], { cwd: viewWtPath });
    await execFileAsync("git", ["config", "user.email", "t@t"], { cwd: viewWtPath });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: viewWtPath });
    await fs.writeFile(path.join(viewWtPath, "src.ts"), "line1\nline2\nline3\n");
    await execFileAsync("git", ["add", "."], { cwd: viewWtPath });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: viewWtPath });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: viewWtPath,
    });
    viewSha = stdout.trim();
  });

  afterAll(async () => {
    await fs.rm(viewWtPath, { recursive: true, force: true });
  });

  it("returns the file contents at the given sha", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/file-at`, {
      path: viewWtPath,
      sha: viewSha,
      file: "src.ts",
    });
    expect(r.status).toBe(200);
    expect(r.body.content).toBe("line1\nline2\nline3\n");
  });

  it("rejects when path/sha/file is missing", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/file-at`, {
      path: viewWtPath,
      sha: viewSha,
    });
    expect(r.status).toBe(400);
  });

  it("rejects an absolute file path", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/file-at`, {
      path: viewWtPath,
      sha: viewSha,
      file: "/etc/passwd",
    });
    expect(r.status).toBe(400);
  });

  it("rejects a file path with .. segments", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/file-at`, {
      path: viewWtPath,
      sha: viewSha,
      file: "../escape.ts",
    });
    expect(r.status).toBe(400);
  });

  it("rejects a sha argument that looks like a flag", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/file-at`, {
      path: viewWtPath,
      sha: "--upload-pack",
      file: "src.ts",
    });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/worktrees/commits and range changeset", () => {
  let rangeWt: string;
  let firstSha: string;
  let secondSha: string;

  beforeAll(async () => {
    rangeWt = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-range-"));
    await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: rangeWt });
    await execFileAsync("git", ["config", "user.email", "t@t"], { cwd: rangeWt });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: rangeWt });
    await fs.writeFile(path.join(rangeWt, "a.txt"), "alpha\n");
    await execFileAsync("git", ["add", "."], { cwd: rangeWt });
    await execFileAsync("git", ["commit", "-m", "first"], { cwd: rangeWt });
    firstSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rangeWt }))
      .stdout.trim();
    await fs.writeFile(path.join(rangeWt, "b.txt"), "beta\n");
    await execFileAsync("git", ["add", "."], { cwd: rangeWt });
    await execFileAsync("git", ["commit", "-m", "second"], { cwd: rangeWt });
    secondSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rangeWt }))
      .stdout.trim();
  });

  afterAll(async () => {
    await fs.rm(rangeWt, { recursive: true, force: true });
  });

  it("lists recent commits newest-first", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/commits`, {
      path: rangeWt,
    });
    expect(r.status).toBe(200);
    expect(r.body.commits).toHaveLength(2);
    expect(r.body.commits[0].sha).toBe(secondSha);
    expect(r.body.commits[1].sha).toBe(firstSha);
    expect(r.body.commits[0].subject).toBe("second");
  });

  it("rejects a missing path", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/commits`, {});
    expect(r.status).toBe(400);
  });

  it("routes fromRef+toRef through rangeChangeset", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/changeset`, {
      path: rangeWt,
      fromRef: secondSha,
      toRef: secondSha,
    });
    expect(r.status).toBe(200);
    expect(r.body.diff).toContain("+++ b/b.txt");
    expect(r.body.diff).not.toContain("+++ b/a.txt");
    expect(r.body.sha).toBe(secondSha);
  });

  it("legacy { path } still hits branchChangeset (regression)", async () => {
    // No upstream/origin in this temp repo, so branchChangeset returns an
    // empty diff with parentSha=null. We just verify the call shape works.
    const r = await postJson(`${baseUrl}/api/worktrees/changeset`, {
      path: rangeWt,
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.sha).toBe("string");
  });

  it("legacy { path, ref } still hits changesetFor (regression)", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/changeset`, {
      path: rangeWt,
      ref: firstSha,
    });
    expect(r.status).toBe(200);
    expect(r.body.sha).toBe(firstSha);
    expect(r.body.diff).toContain("+++ b/a.txt");
  });

  it("legacy { path, dirty: true } still hits dirtyChangesetFor (regression)", async () => {
    const r = await postJson(`${baseUrl}/api/worktrees/changeset`, {
      path: rangeWt,
      dirty: true,
    });
    expect(r.status).toBe(200);
    // Tree is clean; dirty changeset returns the HEAD sha and an empty diff.
    expect(r.body.sha).toBe(secondSha);
  });
});

describe("POST /api/auth/set", () => {
  it("sets an anthropic credential", async () => {
    const r = await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "anthropic" },
      value: "sk-test",
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("sets a github credential", async () => {
    const r = await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_test",
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("rejects an invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/api/auth/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects when credential is missing", async () => {
    const r = await postJson(`${baseUrl}/api/auth/set`, {
      value: "sk-test",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });

  it("rejects when value is missing", async () => {
    const r = await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "anthropic" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("missing_value");
  });

  it("rejects a blocked github host", async () => {
    const r = await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "localhost" },
      value: "ghp_x",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("host_blocked");
  });

  it("denies requests with an opaque origin", async () => {
    const res = await fetch(`${baseUrl}/api/auth/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null" },
      body: JSON.stringify({
        credential: { kind: "github", host: "github.com" },
        value: "tok",
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/has", () => {
  it("returns { present: false } when not set", async () => {
    const r = await postJson(`${baseUrl}/api/auth/has`, {
      credential: { kind: "anthropic" },
    });
    expect(r.status).toBe(200);
    expect(r.body.present).toBe(false);
  });

  it("returns { present: true } after set", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_test",
    });
    const r = await postJson(`${baseUrl}/api/auth/has`, {
      credential: { kind: "github", host: "github.com" },
    });
    expect(r.status).toBe(200);
    expect(r.body.present).toBe(true);
  });

  it("rejects when credential is missing", async () => {
    const r = await postJson(`${baseUrl}/api/auth/has`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });

  it("denies requests with an opaque origin", async () => {
    const res = await fetch(`${baseUrl}/api/auth/has`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null" },
      body: JSON.stringify({ credential: { kind: "anthropic" } }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/clear", () => {
  it("clears a stored credential", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_test",
    });
    const clear = await postJson(`${baseUrl}/api/auth/clear`, {
      credential: { kind: "github", host: "github.com" },
    });
    expect(clear.status).toBe(200);
    expect(clear.body.ok).toBe(true);
    const has = await postJson(`${baseUrl}/api/auth/has`, {
      credential: { kind: "github", host: "github.com" },
    });
    expect(has.body.present).toBe(false);
  });

  it("is a no-op for an unset credential", async () => {
    const r = await postJson(`${baseUrl}/api/auth/clear`, {
      credential: { kind: "github", host: "unknown.example.com" },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("rejects when credential is missing", async () => {
    const r = await postJson(`${baseUrl}/api/auth/clear`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_credential");
  });
});

describe("GET /api/auth/list", () => {
  it("returns an empty list initially", async () => {
    const r = await getJson(`${baseUrl}/api/auth/list`);
    expect(r.status).toBe(200);
    expect(r.body.credentials).toEqual([]);
  });

  it("returns identifiers only — never the secret values", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "anthropic" },
      value: "sk-secret",
    });
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_secret",
    });
    const r = await getJson(`${baseUrl}/api/auth/list`);
    expect(r.status).toBe(200);
    expect(r.body.credentials).toEqual([
      { kind: "anthropic" },
      { kind: "github", host: "github.com" },
    ]);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });
});

describe("legacy /api/github/auth/* routes are gone", () => {
  it.each(["set", "has", "clear"] as const)(
    "POST /api/github/auth/%s returns 404",
    async (op) => {
      const r = await postJson(`${baseUrl}/api/github/auth/${op}`, {
        host: "github.com",
        token: "ghp",
      });
      expect(r.status).toBe(404);
    },
  );
});

// ─── POST /api/github/pr/load ─────────────────────────────────────────────

// Minimal GitHub API canned responses for pr/load integration tests.
const GH_PR_META = {
  title: "Test PR",
  body: "description",
  state: "open",
  merged: false,
  html_url: "https://github.com/owner/repo/pull/1",
  head: { sha: "headsha123", ref: "feature" },
  base: { sha: "basesha456", ref: "main" },
  user: { login: "dev" },
  changed_files: 1,
};
const GH_PR_FILES = [
  {
    filename: "src/hello.ts",
    status: "modified",
    patch: "@@ -1,2 +1,2 @@\n-old\n+new\n context",
  },
];

function makeGhResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Returns a fetch stub that routes github.com requests to canned responses
 * and forwards everything else to the real fetch (so the local test server
 * is still reachable).
 */
function makeSelectiveFetch(
  githubHandler: (url: string) => Response,
): typeof fetch {
  const realFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("api.github.com")) {
      return Promise.resolve(githubHandler(url));
    }
    return realFetch(input, init);
  };
}

describe("POST /api/github/pr/load", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for a missing prUrl", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/load`, {});
    expect(r.status).toBe(400);
  });

  it("returns 400 for a malformed URL — discriminator is invalid_pr_url", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "not-a-url",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_pr_url");
    expect(r.body.detail).toMatch(/invalid PR URL/);
  });

  it("returns 400 for a URL that is not a PR path — discriminator is invalid_pr_url", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "https://github.com/owner/repo/issues/1",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_pr_url");
    expect(r.body.detail).toMatch(/invalid PR URL/);
  });

  it("returns 400 invalid_pr_url for a file:// scheme URL", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "file:///owner/repo/pull/1",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_pr_url");
  });

  it("returns 400 invalid_pr_url for an http:// PR URL", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "http://github.com/owner/repo/pull/1",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_pr_url");
    expect(r.body.detail).toMatch(/scheme must be https/);
  });

  it("returns 401 github_token_required when no token is stored", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "https://github.com/owner/repo/pull/1",
    });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("github_token_required");
    expect(r.body.host).toBe("github.com");
  });

  it("returns { changeSet } on success", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_integration_test",
    });

    vi.stubGlobal(
      "fetch",
      makeSelectiveFetch((url) => {
        if (url.includes("/pulls/1/files")) return makeGhResponse(GH_PR_FILES);
        if (url.includes("/pulls/1/comments")) return makeGhResponse([]);
        if (url.includes("/issues/1/comments")) return makeGhResponse([]);
        if (url.includes("/pulls/1")) return makeGhResponse(GH_PR_META);
        return makeGhResponse({});
      }),
    );

    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "https://github.com/owner/repo/pull/1",
    });
    expect(r.status).toBe(200);
    expect(r.body.changeSet).toBeDefined();
    expect(r.body.changeSet.id).toBe("pr:github.com:owner:repo:1");
    expect(r.body.changeSet.prSource).toBeDefined();
    expect(r.body.changeSet.prSource.state).toBe("open");
    expect(r.body.changeSet.files).toHaveLength(1);
    expect(r.body.changeSet.prConversation).toEqual([]);
    expect(r.body.prReplies).toEqual({});
    expect(r.body.prDetached).toEqual([]);
  });

  it("returns 403 github_auth_failed on upstream 403 rate-limit", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_integration_test",
    });

    vi.stubGlobal(
      "fetch",
      makeSelectiveFetch(() => ({
        ok: false,
        status: 403,
        headers: new Headers({ "X-RateLimit-Remaining": "0" }),
        json: () => Promise.resolve({ message: "rate limited" }),
      } as unknown as Response)),
    );

    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "https://github.com/owner/repo/pull/1",
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("github_auth_failed");
    expect(r.body.hint).toBe("rate-limit");
  });

  it("returns 404 github_pr_not_found on upstream 404", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_integration_test",
    });

    vi.stubGlobal(
      "fetch",
      makeSelectiveFetch(() => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.resolve({ message: "Not Found" }),
      } as unknown as Response)),
    );

    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "https://github.com/owner/repo/pull/1",
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("github_pr_not_found");
  });

  it("returns 502 github_upstream on 5xx from GitHub", async () => {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_integration_test",
    });

    vi.stubGlobal(
      "fetch",
      makeSelectiveFetch(() => ({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: () => Promise.resolve({ message: "Service Unavailable" }),
      } as unknown as Response)),
    );

    const r = await postJson(`${baseUrl}/api/github/pr/load`, {
      prUrl: "https://github.com/owner/repo/pull/1",
    });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("github_upstream");
  });

  it("denies requests with an opaque origin", async () => {
    const res = await fetch(`${baseUrl}/api/github/pr/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null" },
      body: JSON.stringify({ prUrl: "https://github.com/owner/repo/pull/1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/github/pr/branch-lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setGithubToken() {
    await postJson(`${baseUrl}/api/auth/set`, {
      credential: { kind: "github", host: "github.com" },
      value: "ghp_branch_lookup_test",
    });
  }

  it("returns { matched: null } when no remotes are configured", async () => {
    await setGithubToken();
    vi.stubGlobal(
      "fetch",
      makeSelectiveFetch(() =>
        ({ ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve([]) } as unknown as Response),
      ),
    );
    const r = await postJson(`${baseUrl}/api/github/pr/branch-lookup`, {
      worktreePath,
    });
    expect(r.status).toBe(200);
    expect(r.body.matched).toBeNull();
  });

  it("returns { matched: PrMatch } for a worktree with a GitHub remote and open PR", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-bl-int-"));
    try {
      await execFileAsync("git", ["init"], { cwd: dir });
      await execFileAsync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
      await execFileAsync("git", ["config", "user.name", "T"], { cwd: dir });
      await fs.writeFile(path.join(dir, "a.txt"), "hello");
      await execFileAsync("git", ["add", "."], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/repo.git"],
        { cwd: dir },
      );

      await setGithubToken();
      vi.stubGlobal(
        "fetch",
        makeSelectiveFetch(() =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () =>
              Promise.resolve([
                {
                  number: 7,
                  title: "My PR",
                  state: "open",
                  merged: false,
                  html_url: "https://github.com/owner/repo/pull/7",
                },
              ]),
          } as unknown as Response),
        ),
      );

      const r = await postJson(`${baseUrl}/api/github/pr/branch-lookup`, {
        worktreePath: dir,
      });
      expect(r.status).toBe(200);
      expect(r.body.matched).not.toBeNull();
      expect(r.body.matched.number).toBe(7);
      expect(r.body.matched.title).toBe("My PR");
      expect(r.body.matched.host).toBe("github.com");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 401 github_token_required when no token is stored", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-bl-int-"));
    try {
      await execFileAsync("git", ["init"], { cwd: dir });
      await execFileAsync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
      await execFileAsync("git", ["config", "user.name", "T"], { cwd: dir });
      await fs.writeFile(path.join(dir, "a.txt"), "hello");
      await execFileAsync("git", ["add", "."], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/owner/repo.git"],
        { cwd: dir },
      );

      // Ensure no token is set (resetAuthStore was called in beforeEach)
      const r = await postJson(`${baseUrl}/api/github/pr/branch-lookup`, {
        worktreePath: dir,
      });
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("github_token_required");
      expect(r.body.host).toBe("github.com");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 400 and an error when worktreePath is missing", async () => {
    const r = await postJson(`${baseUrl}/api/github/pr/branch-lookup`, {});
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe("string");
  });

  it("returns 400 for an invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/api/github/pr/branch-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("denies requests with an opaque origin", async () => {
    const res = await fetch(`${baseUrl}/api/github/pr/branch-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null" },
      body: JSON.stringify({ worktreePath }),
    });
    expect(res.status).toBe(403);
  });
});
