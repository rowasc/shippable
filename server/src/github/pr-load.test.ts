import { describe, it, expect, vi, afterEach } from "vitest";
import { loadPr } from "./pr-load.ts";
import type { PrCoords } from "./url.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const COORDS: PrCoords = {
  host: "github.com",
  owner: "owner",
  repo: "repo",
  number: 42,
  apiBaseUrl: "https://api.github.com",
  htmlUrl: "https://github.com/owner/repo/pull/42",
};

const TOKEN = "ghp_test";

// Minimal GitHub API response shapes for stubbing.

const PR_META = {
  title: "Fix the bug",
  body: "Describes the fix",
  state: "open",
  merged: false,
  html_url: "https://github.com/owner/repo/pull/42",
  head: { sha: "headsha", ref: "fix-branch" },
  base: { sha: "basesha", ref: "main" },
  user: { login: "author" },
  changed_files: 2,
};

const PR_FILES = [
  {
    filename: "src/foo.ts",
    status: "modified",
    patch: "@@ -1,3 +1,4 @@\n context\n-old line\n+new line\n+added line\n context2",
  },
  {
    filename: "src/bar.ts",
    status: "modified",
    patch: "@@ -10,2 +10,2 @@\n context\n-old bar\n+new bar",
  },
];

const LINE_COMMENTS = [
  {
    id: 100,
    user: { login: "reviewer" },
    body: "This is a comment",
    path: "src/foo.ts",
    line: 3, // newNo in the diff
    original_line: 3,
    start_line: null,
    created_at: "2024-01-01T00:00:00Z",
    html_url: "https://github.com/owner/repo/pull/42#discussion_r100",
    side: "RIGHT",
  },
];

const ISSUE_COMMENTS = [
  {
    id: 200,
    user: { login: "author" },
    body: "Great PR!",
    created_at: "2024-01-02T00:00:00Z",
    html_url: "https://github.com/owner/repo/pull/42#issuecomment-200",
  },
];

function makePage(body: unknown, linkNext?: string): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (linkNext) {
    headers.set("Link", `<${linkNext}>; rel="next"`);
  }
  return {
    ok: true,
    status: 200,
    headers,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function stubHappyPath(
  files = PR_FILES,
  lineComments: typeof LINE_COMMENTS = LINE_COMMENTS,
  issueComments: typeof ISSUE_COMMENTS = ISSUE_COMMENTS,
) {
  const mock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/pulls/42/files")) return makePage(files);
    if (url.includes("/pulls/42/comments")) return makePage(lineComments);
    if (url.includes("/issues/42/comments")) return makePage(issueComments);
    if (url.includes("/pulls/42")) return makePage(PR_META);
    return makePage({}, undefined);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("loadPr — happy path", () => {
  it("sets prSource with correct metadata", async () => {
    stubHappyPath();
    const cs = await loadPr(COORDS, TOKEN);

    expect(cs.prSource).toBeDefined();
    expect(cs.prSource!.host).toBe("github.com");
    expect(cs.prSource!.owner).toBe("owner");
    expect(cs.prSource!.repo).toBe("repo");
    expect(cs.prSource!.number).toBe(42);
    expect(cs.prSource!.state).toBe("open");
    expect(cs.prSource!.title).toBe("Fix the bug");
    expect(cs.prSource!.headSha).toBe("headsha");
    expect(cs.prSource!.baseSha).toBe("basesha");
    expect(cs.prSource!.baseRef).toBe("main");
    expect(cs.prSource!.headRef).toBe("fix-branch");
    expect(cs.prSource!.htmlUrl).toBe("https://github.com/owner/repo/pull/42");
    expect(typeof cs.prSource!.lastFetchedAt).toBe("string");
  });

  it("id is deterministic pr:<host>:<owner>:<repo>:<number>", async () => {
    stubHappyPath();
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.id).toBe("pr:github.com:owner:repo:42");
  });

  it("parses both files into ChangeSet.files", async () => {
    stubHappyPath();
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.files).toHaveLength(2);
    const paths = cs.files.map((f) => f.path);
    expect(paths).toContain("src/foo.ts");
    expect(paths).toContain("src/bar.ts");
  });

  it("attaches line comment to the correct DiffLine", async () => {
    stubHappyPath();
    const cs = await loadPr(COORDS, TOKEN);

    const fooFile = cs.files.find((f) => f.path === "src/foo.ts")!;
    expect(fooFile).toBeDefined();

    // Find any DiffLine with prReviewComments
    const commentedLine = fooFile.hunks
      .flatMap((h) => h.lines)
      .find((l) => l.prReviewComments && l.prReviewComments.length > 0);

    expect(commentedLine).toBeDefined();
    expect(commentedLine!.prReviewComments![0]).toMatchObject({
      id: 100,
      author: "reviewer",
      body: "This is a comment",
    });
  });

  it("populates prConversation from issue comments", async () => {
    stubHappyPath();
    const cs = await loadPr(COORDS, TOKEN);

    expect(cs.prConversation).toHaveLength(1);
    expect(cs.prConversation![0]).toMatchObject({
      id: 200,
      author: "author",
      body: "Great PR!",
    });
  });
});

describe("loadPr — multi-line comment", () => {
  it("sets lineSpan on multi-line comment and attaches to hi line", async () => {
    const multiLineComment = {
      id: 101,
      user: { login: "reviewer" },
      body: "Multi-line comment",
      path: "src/foo.ts",
      line: 4,           // hi line
      original_line: 4,
      start_line: 2,     // lo line
      created_at: "2024-01-01T00:00:00Z",
      html_url: "https://github.com/owner/repo/pull/42#discussion_r101",
      side: "RIGHT",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stubHappyPath(PR_FILES, [multiLineComment as any], ISSUE_COMMENTS);
    const cs = await loadPr(COORDS, TOKEN);

    const fooFile = cs.files.find((f) => f.path === "src/foo.ts")!;
    const commentedLines = fooFile.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.prReviewComments && l.prReviewComments.length > 0);

    // Should attach to the hi (line 4) line only
    expect(commentedLines).toHaveLength(1);
    const comment = commentedLines[0].prReviewComments![0];
    expect(comment.lineSpan).toEqual({ lo: 2, hi: 4 });
  });
});

describe("loadPr — truncation", () => {
  it("sets prSource.truncation when files.length < meta.changed_files", async () => {
    // GitHub says the PR has 5 files but only returns 3 (simulating truncation).
    const truncatedMeta = { ...PR_META, changed_files: 5 };
    const threeFiles = Array.from({ length: 3 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      patch: "@@ -1,1 +1,1 @@\n-old\n+new",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/pulls/42/files")) return makePage(threeFiles);
        if (url.includes("/pulls/42/comments")) return makePage([]);
        if (url.includes("/issues/42/comments")) return makePage([]);
        if (url.includes("/pulls/42")) return makePage(truncatedMeta);
        return makePage({});
      }),
    );
    const cs = await loadPr(COORDS, TOKEN);

    expect(cs.prSource!.truncation).toBeDefined();
    expect(cs.prSource!.truncation!.kind).toBe("files");
    expect(cs.prSource!.truncation!.reason).toContain("3");
    expect(cs.prSource!.truncation!.reason).toContain("5");
  });

  it("does not set truncation when files.length equals meta.changed_files", async () => {
    // PR_META has changed_files: 2, and PR_FILES has 2 files — no truncation.
    stubHappyPath();
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.prSource!.truncation).toBeUndefined();
  });
});

describe("loadPr — comment silently dropped when path/line not in diff", () => {
  it("drops comment with unknown path", async () => {
    const unknownPathComment = {
      id: 999,
      user: { login: "reviewer" },
      body: "Comment on missing file",
      path: "src/nonexistent.ts",
      line: 1,
      original_line: 1,
      start_line: null,
      created_at: "2024-01-01T00:00:00Z",
      html_url: "https://github.com/owner/repo/pull/42#discussion_r999",
      side: "RIGHT" as const,
    };
    stubHappyPath(PR_FILES, [unknownPathComment], ISSUE_COMMENTS);
    const cs = await loadPr(COORDS, TOKEN);

    // No DiffLine across any file should have prReviewComments
    const allLines = cs.files.flatMap((f) =>
      f.hunks.flatMap((h) => h.lines),
    );
    const withComments = allLines.filter(
      (l) => l.prReviewComments && l.prReviewComments.length > 0,
    );
    expect(withComments).toHaveLength(0);
  });

  it("drops comment with a line number not in the diff", async () => {
    const outOfRangeComment = {
      id: 998,
      user: { login: "reviewer" },
      body: "Comment on context line not in diff",
      path: "src/foo.ts",
      line: 999, // no such line in the diff
      original_line: 999,
      start_line: null,
      created_at: "2024-01-01T00:00:00Z",
      html_url: "https://github.com/owner/repo/pull/42#discussion_r998",
      side: "RIGHT" as const,
    };
    stubHappyPath(PR_FILES, [outOfRangeComment], ISSUE_COMMENTS);
    const cs = await loadPr(COORDS, TOKEN);

    const allLines = cs.files.flatMap((f) =>
      f.hunks.flatMap((h) => h.lines),
    );
    const withComments = allLines.filter(
      (l) => l.prReviewComments && l.prReviewComments.length > 0,
    );
    expect(withComments).toHaveLength(0);
  });
});

describe("loadPr — file status synthesis", () => {
  function stubWithFiles(files: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/pulls/42/files")) return makePage(files);
        if (url.includes("/pulls/42/comments")) return makePage([]);
        if (url.includes("/issues/42/comments")) return makePage([]);
        if (url.includes("/pulls/42")) return makePage(PR_META);
        return makePage({});
      }),
    );
  }

  it("added file results in DiffFile.status === 'added'", async () => {
    stubWithFiles([
      {
        filename: "src/new.ts",
        status: "added",
        patch: "@@ -0,0 +1,2 @@\n+line1\n+line2",
      },
    ]);
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].status).toBe("added");
    expect(cs.files[0].path).toBe("src/new.ts");
  });

  it("removed file results in DiffFile.status === 'deleted'", async () => {
    stubWithFiles([
      {
        filename: "src/gone.ts",
        status: "removed",
        patch: "@@ -1,2 +0,0 @@\n-line1\n-line2",
      },
    ]);
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].status).toBe("deleted");
    expect(cs.files[0].path).toBe("src/gone.ts");
  });

  it("renamed file results in DiffFile.status === 'renamed' with new path", async () => {
    stubWithFiles([
      {
        filename: "src/new-name.ts",
        status: "renamed",
        previous_filename: "src/old-name.ts",
        patch: "@@ -1,2 +1,2 @@\n context\n-old\n+new",
      },
    ]);
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].status).toBe("renamed");
    expect(cs.files[0].path).toBe("src/new-name.ts");
  });

  it("modified file results in DiffFile.status === 'modified'", async () => {
    stubWithFiles([PR_FILES[0]]);
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].status).toBe("modified");
  });
});

describe("loadPr — state mapping", () => {
  it("maps closed+merged to 'merged'", async () => {
    const mergedMeta = { ...PR_META, state: "closed" as const, merged: true };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/pulls/42/files")) return makePage(PR_FILES);
        if (url.includes("/pulls/42/comments")) return makePage([]);
        if (url.includes("/issues/42/comments")) return makePage([]);
        if (url.includes("/pulls/42")) return makePage(mergedMeta);
        return makePage({});
      }),
    );
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.prSource!.state).toBe("merged");
  });

  it("maps closed+not merged to 'closed'", async () => {
    const closedMeta = { ...PR_META, state: "closed" as const, merged: false };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/pulls/42/files")) return makePage(PR_FILES);
        if (url.includes("/pulls/42/comments")) return makePage([]);
        if (url.includes("/issues/42/comments")) return makePage([]);
        if (url.includes("/pulls/42")) return makePage(closedMeta);
        return makePage({});
      }),
    );
    const cs = await loadPr(COORDS, TOKEN);
    expect(cs.prSource!.state).toBe("closed");
  });
});
