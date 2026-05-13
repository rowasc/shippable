import { describe, it, expect, vi, afterEach } from "vitest";
import { ProxyAgent } from "undici";
import {
  githubFetch,
  githubFetchAll,
  GithubApiError,
} from "./api-client.ts";
import { __resetDispatcherForTests } from "../proxy.ts";

const API_BASE = "https://api.github.com";
const TOKEN = "ghp_test_token";

function makeFetchResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headersObj = new Headers({ "Content-Type": "application/json", ...headers });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
  __resetDispatcherForTests();
});

describe("githubFetch", () => {
  it("injects Authorization: Bearer header", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", mockFetch);

    await githubFetch(API_BASE, "/repos/owner/repo/pulls/1", { token: TOKEN });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("sets required GitHub headers", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", mockFetch);

    await githubFetch(API_BASE, "/repos/owner/repo/pulls/1", { token: TOKEN });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(headers["User-Agent"]).toBeTruthy();
  });

  it("returns json on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(200, { title: "hello" })),
    );
    const result = await githubFetch(API_BASE, "/repos/o/r/pulls/1", {
      token: TOKEN,
    });
    expect(result.json).toEqual({ title: "hello" });
    expect(result.status).toBe(200);
  });

  it("throws github_auth_failed with hint invalid-token on 401", async () => {
    // githubFetch always sends a Bearer token; a 401 back means *that
    // token* was rejected, not that one is missing. The "no token in the
    // store" case is handled by the route handler before we reach here.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(401, { message: "Bad credentials" })),
    );
    await expect(
      githubFetch(API_BASE, "/repos/o/r/pulls/1", { token: TOKEN }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GithubApiError &&
        e.error.kind === "github_auth_failed" &&
        e.error.hint === "invalid-token",
    );
  });

  it("github_auth_failed (invalid-token) includes host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(401, {})),
    );
    await expect(
      githubFetch(API_BASE, "/repos/o/r/pulls/1", {
        token: TOKEN,
        host: "github.com",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof GithubApiError)) return false;
      const err = e.error;
      return (
        err.kind === "github_auth_failed" &&
        err.host === "github.com" &&
        err.hint === "invalid-token"
      );
    });
  });

  it("throws github_auth_failed with hint rate-limit on 403 + X-RateLimit-Remaining: 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          makeFetchResponse(403, {}, { "X-RateLimit-Remaining": "0" }),
        ),
    );
    await expect(
      githubFetch(API_BASE, "/repos/o/r/pulls/1", { token: TOKEN }),
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof GithubApiError)) return false;
      const err = e.error;
      return (
        err.kind === "github_auth_failed" &&
        "hint" in err &&
        err.hint === "rate-limit"
      );
    });
  });

  it("throws github_auth_failed with hint scope on 403 without rate-limit header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(403, {})),
    );
    await expect(
      githubFetch(API_BASE, "/repos/o/r/pulls/1", { token: TOKEN }),
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof GithubApiError)) return false;
      const err = e.error;
      return (
        err.kind === "github_auth_failed" &&
        "hint" in err &&
        err.hint === "scope"
      );
    });
  });

  it("throws github_pr_not_found on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(404, { message: "Not Found" })),
    );
    await expect(
      githubFetch(API_BASE, "/repos/o/r/pulls/1", { token: TOKEN }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GithubApiError && e.error.kind === "github_pr_not_found",
    );
  });

  it("forwards a ProxyAgent dispatcher when HTTPS_PROXY is set", async () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:3128";
    __resetDispatcherForTests();

    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", mockFetch);

    await githubFetch(API_BASE, "/repos/o/r/pulls/1", { token: TOKEN });

    const [, init] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { dispatcher?: unknown },
    ];
    expect(init.dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it("throws github_upstream on 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(502, { message: "Bad Gateway" })),
    );
    await expect(
      githubFetch(API_BASE, "/repos/o/r/pulls/1", { token: TOKEN }),
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof GithubApiError)) return false;
      const err = e.error;
      return (
        err.kind === "github_upstream" &&
        "status" in err &&
        err.status === 502
      );
    });
  });
});

describe("githubFetchAll", () => {
  it("returns all items from a single page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(200, [{ id: 1 }, { id: 2 }])),
    );
    const result = await githubFetchAll<{ id: number }>(
      API_BASE,
      "/repos/o/r/pulls/1/files?per_page=100",
      { token: TOKEN },
    );
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("follows Link: rel=next and concatenates pages", async () => {
    const page1Headers = new Headers({
      "Content-Type": "application/json",
      Link: `<https://api.github.com/repos/o/r/pulls/1/files?page=2>; rel="next"`,
    });
    const page2Headers = new Headers({ "Content-Type": "application/json" });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: page1Headers,
        json: () => Promise.resolve([{ id: 1 }, { id: 2 }]),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: page2Headers,
        json: () => Promise.resolve([{ id: 3 }]),
      } as unknown as Response);

    vi.stubGlobal("fetch", mockFetch);

    const result = await githubFetchAll<{ id: number }>(
      API_BASE,
      "/repos/o/r/pulls/1/files?per_page=100",
      { token: TOKEN },
    );
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops when there is no next link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(200, [{ id: 1 }])),
    );
    const result = await githubFetchAll<{ id: number }>(
      API_BASE,
      "/path",
      { token: TOKEN },
    );
    expect(result).toHaveLength(1);
  });

  it("throws github_pr_not_found on 404 during pagination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(404, {})),
    );
    await expect(
      githubFetchAll(API_BASE, "/repos/o/r/pulls/999/files", { token: TOKEN }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GithubApiError && e.error.kind === "github_pr_not_found",
    );
  });
});
