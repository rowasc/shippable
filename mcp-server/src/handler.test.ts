import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PORT,
  handleCheckReviewComments,
  handlePostReviewReply,
} from "./handler.js";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function makeFetch(response: Response | Promise<Response> | Error): {
  fetchFn: typeof fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Default discovery stub for tests that don't care about port-file lookup.
// Without this the real disk would be consulted and a stray port file on a
// dev box would flip test results. Tests that exercise discovery pass an
// explicit `discoverPort` stub instead.
const noDiscovery = async () => null;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleCheckReviewComments", () => {
  it("returns the payload when the server has pending comments", async () => {
    const payload =
      "<reviewer-feedback from=\"shippable\" commit=\"abc\"><comment id=\"c1\" file=\"x.ts\" lines=\"1\" kind=\"block\">hi</comment></reviewer-feedback>";
    const { fetchFn } = makeFetch(jsonResponse({ payload, ids: ["a", "b"] }));

    const result = await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, discoverPort: noDiscovery },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: payload }]);
  });

  it("returns 'No pending comments.' when payload is empty", async () => {
    const { fetchFn } = makeFetch(jsonResponse({ payload: "", ids: [] }));

    const result = await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, discoverPort: noDiscovery },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: "No pending comments." },
    ]);
  });

  it("falls back to deps.cwd() when worktreePath is absent", async () => {
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      {},
      { fetchFn, cwd: () => "/tmp/x", discoverPort: noDiscovery },
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.worktreePath).toBe("/tmp/x");
  });

  it("explicit worktreePath wins over deps.cwd()", async () => {
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      { worktreePath: "/tmp/y" },
      { fetchFn, cwd: () => "/tmp/x", discoverPort: noDiscovery },
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.worktreePath).toBe("/tmp/y");
  });

  it("returns an error result on HTTP 500 with port and status in the message", async () => {
    const { fetchFn } = makeFetch(
      new Response("oops", { status: 500 }),
    );

    const result = await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, port: 4242 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("4242");
    expect(result.content[0]!.text).toContain("500");
  });

  it("returns an error result when the response body is not valid JSON", async () => {
    const { fetchFn } = makeFetch(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, port: 5151 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/JSON|parse/i);
  });

  it("returns an error result without throwing on fetch rejection", async () => {
    const { fetchFn } = makeFetch(new Error("ECONNREFUSED"));

    const result = await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, port: 7777 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("ECONNREFUSED");
    expect(result.content[0]!.text).toContain("7777");
  });

  it("honors deps.port when provided", async () => {
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, port: 4000 },
    );

    expect(calls[0]!.url).toBe("http://127.0.0.1:4000/api/agent/pull");
  });

  it("honors SHIPPABLE_PORT env when deps.port is absent", async () => {
    vi.stubEnv("SHIPPABLE_PORT", "5000");
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn },
    );

    expect(calls[0]!.url).toBe("http://127.0.0.1:5000/api/agent/pull");
  });

  it("falls back to DEFAULT_PORT when deps.port, SHIPPABLE_PORT, and discovery are all absent", async () => {
    vi.stubEnv("SHIPPABLE_PORT", "");
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, discoverPort: noDiscovery },
    );

    expect(DEFAULT_PORT).toBe(3001);
    expect(calls[0]!.url).toBe(`http://127.0.0.1:${DEFAULT_PORT}/api/agent/pull`);
  });

  it("uses the discovered port when SHIPPABLE_PORT is unset", async () => {
    vi.stubEnv("SHIPPABLE_PORT", "");
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, discoverPort: async () => 52613 },
    );

    expect(calls[0]!.url).toBe("http://127.0.0.1:52613/api/agent/pull");
  });

  it("SHIPPABLE_PORT wins over discovery", async () => {
    vi.stubEnv("SHIPPABLE_PORT", "6000");
    const { fetchFn, calls } = makeFetch(
      jsonResponse({ payload: "", ids: [] }),
    );

    await handleCheckReviewComments(
      { worktreePath: "/repo" },
      { fetchFn, discoverPort: async () => 52613 },
    );

    expect(calls[0]!.url).toBe("http://127.0.0.1:6000/api/agent/pull");
  });
});

describe("handlePostReviewReply", () => {
  it("POSTs to /api/agent/replies with the input and returns the assigned id", async () => {
    const { fetchFn, calls } = makeFetch(jsonResponse({ id: "reply-1" }));

    const result = await handlePostReviewReply(
      {
        worktreePath: "/repo",
        commentId: "c1",
        replyText: "fixed it",
        outcome: "addressed",
      },
      { fetchFn, discoverPort: noDiscovery },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("reply-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/api\/agent\/replies$/);
    // Wire field on the local server endpoint stays `body` — the
    // `replyText` rename is contained to the MCP tool's input schema.
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({
      worktreePath: "/repo",
      commentId: "c1",
      body: "fixed it",
      outcome: "addressed",
    });
  });

  it("falls back to deps.cwd() when worktreePath is absent", async () => {
    const { fetchFn, calls } = makeFetch(jsonResponse({ id: "x" }));

    await handlePostReviewReply(
      { commentId: "c1", replyText: "x", outcome: "noted" },
      { fetchFn, cwd: () => "/tmp/cwd", discoverPort: noDiscovery },
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.worktreePath).toBe("/tmp/cwd");
  });

  it("returns an error result on HTTP 500 with port and status in the message", async () => {
    const { fetchFn } = makeFetch(new Response("oops", { status: 500 }));

    const result = await handlePostReviewReply(
      {
        worktreePath: "/repo",
        commentId: "c1",
        replyText: "x",
        outcome: "addressed",
      },
      { fetchFn, port: 4242 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("4242");
    expect(result.content[0]!.text).toContain("500");
  });

  it("returns an error result without throwing on fetch rejection", async () => {
    const { fetchFn } = makeFetch(new Error("ECONNREFUSED"));

    const result = await handlePostReviewReply(
      {
        worktreePath: "/repo",
        commentId: "c1",
        replyText: "x",
        outcome: "declined",
      },
      { fetchFn, port: 7777 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("ECONNREFUSED");
    expect(result.content[0]!.text).toContain("7777");
  });

  it("honors SHIPPABLE_PORT env when deps.port is absent", async () => {
    vi.stubEnv("SHIPPABLE_PORT", "5050");
    const { fetchFn, calls } = makeFetch(jsonResponse({ id: "x" }));

    await handlePostReviewReply(
      {
        worktreePath: "/repo",
        commentId: "c1",
        replyText: "x",
        outcome: "noted",
      },
      { fetchFn },
    );

    expect(calls[0]!.url).toBe("http://127.0.0.1:5050/api/agent/replies");
  });

  it("returns an error result when the response body is not valid JSON", async () => {
    const { fetchFn } = makeFetch(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await handlePostReviewReply(
      {
        worktreePath: "/repo",
        commentId: "c1",
        replyText: "x",
        outcome: "addressed",
      },
      { fetchFn, port: 5151 },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/JSON|parse/i);
  });
});
