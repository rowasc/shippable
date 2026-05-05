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
