// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSession, peekSession, saveSession } from "./persist";
import { initialState } from "./state";
import type {
  ChangeSet,
  DetachedInteraction,
  DiffFile,
  DiffLine,
  Hunk,
  Interaction,
} from "./types";
import { lineNoteReplyKey } from "./types";

const STORAGE_KEY = "shippable:review:v1";

function makeLines(n: number): DiffLine[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "context" as const,
    text: `l${i}`,
    oldNo: i + 1,
    newNo: i + 1,
  }));
}
function makeHunk(id: string, n = 3): Hunk {
  return {
    id,
    header: `@@ -1,${n} +1,${n} @@`,
    oldStart: 1,
    oldCount: n,
    newStart: 1,
    newCount: n,
    lines: makeLines(n),
  };
}
function makeFile(id: string, hunks: Hunk[]): DiffFile {
  return { id, path: `${id}.ts`, language: "ts", status: "modified", hunks };
}
function makeChangeset(): ChangeSet {
  return {
    id: "cs1",
    title: "cs1",
    author: "tester",
    branch: "head",
    base: "base",
    createdAt: "2026-04-30T00:00:00.000Z",
    description: "",
    files: [makeFile("cs1/f1", [makeHunk("cs1/f1#h1")])],
  };
}

function userIx(
  over: Partial<Interaction> & { threadKey: string },
): Interaction {
  return {
    id: "u1",
    target: "line",
    intent: "comment",
    author: "you",
    authorRole: "user",
    body: "hi",
    createdAt: "2026-05-07T00:00:00.000Z",
    ...over,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("persist v3 — round-trip user-authored Interactions", () => {
  it("saves a user Interaction and reloads it untouched", () => {
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const ix = userIx({
      id: "u1",
      threadKey: key,
      body: "queued",
      enqueuedCommentId: "cmt_42",
    });
    const state = { ...initialState([cs]), interactions: { [key]: [ix] } };
    saveSession(state, {});

    const hydrated = loadSession([cs]);
    expect(hydrated.state).not.toBeNull();
    const got = hydrated.state!.interactions[key];
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe("u1");
    expect(got[0].enqueuedCommentId).toBe("cmt_42");
    expect(got[0].body).toBe("queued");
  });

  it("preserves anchor fields (anchorPath, anchorContext, anchorHash, originSha, originType)", () => {
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const anchorContext: DiffLine[] = [
      { kind: "context", text: "line a", oldNo: 1, newNo: 1 },
      { kind: "context", text: "line b", oldNo: 2, newNo: 2 },
    ];
    const ix = userIx({
      threadKey: key,
      body: "anchored",
      enqueuedCommentId: null,
      anchorPath: "cs1/f1.ts",
      anchorContext,
      anchorHash: "deadbeef",
      originSha: "abc1234",
      originType: "committed",
    });
    const state = { ...initialState([cs]), interactions: { [key]: [ix] } };
    saveSession(state, {});

    const got = loadSession([cs]).state!.interactions[key][0];
    expect(got.anchorPath).toBe("cs1/f1.ts");
    expect(got.anchorContext).toEqual(anchorContext);
    expect(got.anchorHash).toBe("deadbeef");
    expect(got.originSha).toBe("abc1234");
    expect(got.originType).toBe("committed");
  });

  it("round-trips detached Interactions", () => {
    const cs = makeChangeset();
    const detached: DetachedInteraction = {
      interaction: userIx({
        id: "r-d",
        threadKey: "user:cs1/f1#h1:0",
        body: "stranded",
        anchorPath: "cs1/gone.ts",
        anchorContext: [
          { kind: "context", text: "vanishing", oldNo: 1, newNo: 1 },
        ],
        anchorHash: "feedface",
        originSha: "1234567890",
        originType: "dirty",
      }),
      threadKey: "user:cs1/f1#h1:0",
    };
    const state = {
      ...initialState([cs]),
      detachedInteractions: [detached],
    };
    saveSession(state, {});

    const hydrated = loadSession([cs]);
    expect(hydrated.state!.detachedInteractions).toEqual([detached]);
  });
});

describe("persist v3 — strip non-user-authored entries on save", () => {
  it("drops AI and teammate Interactions on save (they regenerate from ingest)", () => {
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const userEntry = userIx({ id: "u1", threadKey: key, body: "my reply" });
    const aiEntry: Interaction = {
      id: "ai:1",
      threadKey: key,
      target: "line",
      intent: "comment",
      author: "ai",
      authorRole: "ai",
      body: "AI head",
      createdAt: "0001-01-01T00:00:00.000Z",
    };
    const state = {
      ...initialState([cs]),
      interactions: { [key]: [aiEntry, userEntry] },
    };
    saveSession(state, {});

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.interactions[key]).toHaveLength(1);
    expect(parsed.interactions[key][0].id).toBe("u1");
  });

  it("drops PR-imported (external.source === 'pr') Interactions on save", () => {
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const local = userIx({ id: "u1", threadKey: key, body: "local" });
    const pr = userIx({
      id: "pr-comment:42",
      threadKey: key,
      author: "external-reviewer",
      body: "consider X",
      external: { source: "pr", htmlUrl: "https://github.com/x/y/pull/1#r42" },
    });
    const detachedPr: DetachedInteraction = {
      interaction: userIx({
        id: "pr-comment:43",
        threadKey: key,
        author: "external-reviewer",
        body: "stale comment",
        external: { source: "pr", htmlUrl: "https://github.com/x/y/pull/1#r43" },
      }),
      threadKey: key,
    };
    const state = {
      ...initialState([cs]),
      interactions: { [key]: [local, pr] },
      detachedInteractions: [detachedPr],
    };
    saveSession(state, {});

    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.interactions[key]).toHaveLength(1);
    expect(parsed.interactions[key][0].id).toBe("u1");
    expect(parsed.detachedInteractions).toEqual([]);
  });

  it("drops agent-authored Interactions on save (they regenerate from polling)", () => {
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const userEntry = userIx({
      id: "u1",
      threadKey: key,
      enqueuedCommentId: "cmt_1",
    });
    const agentEntry: Interaction = {
      id: "ar1",
      threadKey: key,
      target: "reply-to-user",
      intent: "accept",
      author: "agent",
      authorRole: "agent",
      body: "fixed it",
      createdAt: "2026-05-07T00:01:00.000Z",
    };
    const state = {
      ...initialState([cs]),
      interactions: { [key]: [userEntry, agentEntry] },
    };
    saveSession(state, {});

    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.interactions[key]).toHaveLength(1);
    expect(parsed.interactions[key][0].id).toBe("u1");
  });
});

describe("persist v3 — fails closed on non-v3 snapshots", () => {
  it("peekSession returns null for v < 3", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 2,
        cursor: { changesetId: "cs", fileId: "f", hunkId: "h", lineIdx: 0 },
        readLines: {},
        reviewedFiles: [],
        dismissedGuides: [],
        ackedNotes: [],
        replies: {},
        detachedReplies: [],
        drafts: {},
      }),
    );
    expect(peekSession()).toBeNull();
  });

  it("loadSession returns empty hydration for v > 3", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 999,
        cursor: { changesetId: "cs", fileId: "f", hunkId: "h", lineIdx: 0 },
        readLines: {},
        reviewedFiles: [],
        dismissedGuides: [],
        interactions: {},
        detachedInteractions: [],
        drafts: {},
      }),
    );
    expect(loadSession([])).toEqual({ state: null, drafts: {} });
  });

  it("loadSession returns empty hydration for malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{ not json");
    expect(loadSession([])).toEqual({ state: null, drafts: {} });
  });
});

describe("persist v3 — hunk-validity filtering", () => {
  it("drops Interactions whose hunkId no longer exists in the loaded changeset", () => {
    const cs = makeChangeset();
    const valid = lineNoteReplyKey("cs1/f1#h1", 0);
    const stale = lineNoteReplyKey("cs1/f1#deleted", 0);
    const state = {
      ...initialState([cs]),
      interactions: {
        [valid]: [userIx({ id: "keep", threadKey: valid })],
        [stale]: [userIx({ id: "drop", threadKey: stale })],
      },
    };
    saveSession(state, {});

    const hydrated = loadSession([cs]);
    expect(Object.keys(hydrated.state!.interactions)).toEqual([valid]);
  });

  it("keeps detached entries even when their hunk is gone (the whole point of detached)", () => {
    const cs = makeChangeset();
    const detached: DetachedInteraction = {
      interaction: userIx({
        id: "r-d",
        threadKey: "user:cs1/f1#deleted:0",
        anchorPath: "cs1/gone.ts",
      }),
      threadKey: "user:cs1/f1#deleted:0",
    };
    const state = { ...initialState([cs]), detachedInteractions: [detached] };
    saveSession(state, {});

    const hydrated = loadSession([cs]);
    expect(hydrated.state!.detachedInteractions).toEqual([detached]);
  });
});
