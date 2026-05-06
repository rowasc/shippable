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
  unenqueue,
  formatPayload,
  resetForTests,
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
  it("sorts by file path asc, then line lower-bound asc; freeform last in send order", () => {
    enqueue(WT, [
      { ...makeBase(), file: "src/b.ts", lines: "10" },
      { ...makeBase(), file: "src/a.ts", lines: "100" },
      { ...makeBase(), file: "src/a.ts", lines: "72-79" },
      { ...makeBase(), file: "src/a.ts", lines: "20" },
    ]);
    // small delay simulation: enqueue a freeform first then a second freeform
    enqueue(WT, [
      { kind: "freeform", body: "first free", commitSha: "x", supersedes: null },
    ]);
    enqueue(WT, [
      {
        kind: "freeform",
        body: "second free",
        commitSha: "x",
        supersedes: null,
      },
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
      "<free>:-",
      "<free>:-",
    ]);
    expect(order[4].body).toBe("first free");
    expect(order[5].body).toBe("second free");
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

  it("omits file/lines for freeform comments", () => {
    const c: Comment = {
      id: "1",
      kind: "freeform",
      body: "free",
      commitSha: "sha",
      supersedes: null,
      enqueuedAt: "2025-01-01T00:00:00Z",
    };
    const out = formatPayload([c], "sha");
    expect(out).not.toContain("file=");
    expect(out).not.toContain("lines=");
    expect(out).toContain('kind="freeform"');
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
});
