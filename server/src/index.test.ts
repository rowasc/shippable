import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
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
  resetForTests = queueMod.resetForTests;

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
    // trip the cap; pick the replies POST since it's the most recently
    // added one and the security review flagged it specifically.
    const huge = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/api/agent/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktreePath,
        commentId: "anything",
        body: huge,
        outcome: "noted",
      }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(String(body.error)).toMatch(/exceeds.*bytes/);
  });
});

describe("POST /api/agent/replies", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/api/agent/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects when worktreePath is missing", async () => {
    const r = await postJson(`${baseUrl}/api/agent/replies`, {
      commentId: "c1",
      body: "x",
      outcome: "addressed",
    });
    expect(r.status).toBe(400);
  });

  it("rejects when worktreePath is not a git dir", async () => {
    const r = await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath: "/tmp/this-does-not-exist-xyz-456",
      commentId: "c1",
      body: "x",
      outcome: "addressed",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an invalid outcome", async () => {
    const r = await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath,
      commentId: "c1",
      body: "x",
      outcome: "made-up",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const r = await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath,
      commentId: "c1",
      body: "",
      outcome: "addressed",
    });
    expect(r.status).toBe(400);
  });

  it("rejects an unknown commentId (not in delivered set for this worktree)", async () => {
    const r = await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath,
      commentId: "no-such-id",
      body: "x",
      outcome: "noted",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/not a delivered comment/);
  });

  it("returns { id } on success and persists via GET", async () => {
    // Enqueue + pull to mint a real delivered commentId — the post-reply
    // endpoint validates that commentId belongs to the worktree's
    // delivered set (defensive per spec § Data Flow).
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "hi" },
    });
    const realCommentId = enq.body.id as string;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });

    const r = await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath,
      commentId: realCommentId,
      body: "fixed it",
      outcome: "addressed",
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.id).toBe("string");
    expect(r.body.id.length).toBeGreaterThan(0);

    const list = await getJson(
      `${baseUrl}/api/agent/replies?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.replies).toHaveLength(1);
    expect(list.body.replies[0].id).toBe(r.body.id);
    expect(list.body.replies[0].outcome).toBe("addressed");
    expect(list.body.replies[0].commentId).toBe(realCommentId);
    expect(list.body.replies[0].body).toBe("fixed it");
  });

  it("appends multiple replies to the same commentId", async () => {
    const enq = await postJson(`${baseUrl}/api/agent/enqueue`, {
      worktreePath,
      commitSha: "deadbeef",
      comment: { kind: "block", file: "a.ts", lines: "1", body: "hi" },
    });
    const realCommentId = enq.body.id as string;
    await postJson(`${baseUrl}/api/agent/pull`, { worktreePath });

    await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath,
      commentId: realCommentId,
      body: "first",
      outcome: "noted",
    });
    await postJson(`${baseUrl}/api/agent/replies`, {
      worktreePath,
      commentId: realCommentId,
      body: "second",
      outcome: "addressed",
    });
    const list = await getJson(
      `${baseUrl}/api/agent/replies?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.body.replies).toHaveLength(2);
    expect(list.body.replies.map((r: { body: string }) => r.body)).toEqual([
      "first",
      "second",
    ]);
  });

  it("caps the per-worktree reply list at REPLY_HISTORY_CAP", async () => {
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
      await postJson(`${baseUrl}/api/agent/replies`, {
        worktreePath,
        commentId: realCommentId,
        body: `reply-${i}`,
        outcome: "noted",
      });
    }
    const list = await getJson(
      `${baseUrl}/api/agent/replies?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(list.body.replies).toHaveLength(200);
    // Oldest retained should be reply-5; reply-0..4 dropped. Newest is
    // reply-204.
    expect(list.body.replies[0].body).toBe("reply-5");
    expect(list.body.replies[199].body).toBe("reply-204");
  });
});

describe("GET /api/agent/replies", () => {
  it("rejects requests without ?worktreePath=", async () => {
    const r = await getJson(`${baseUrl}/api/agent/replies`);
    expect(r.status).toBe(400);
  });

  it("rejects when worktreePath is not a git dir", async () => {
    const r = await getJson(
      `${baseUrl}/api/agent/replies?worktreePath=${encodeURIComponent("/tmp/nope-xyz")}`,
    );
    expect(r.status).toBe(400);
  });

  it("returns { replies: [] } for a worktree with none", async () => {
    const r = await getJson(
      `${baseUrl}/api/agent/replies?worktreePath=${encodeURIComponent(worktreePath)}`,
    );
    expect(r.status).toBe(200);
    expect(r.body.replies).toEqual([]);
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
