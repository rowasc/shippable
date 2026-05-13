// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { loadGithubPr, GithubFetchError } from "./githubPrClient";

// apiUrl in browser dev mode just returns the path unchanged.
vi.mock("./apiUrl", () => ({
  apiUrl: (path: string) => Promise.resolve(path),
}));

describe("loadGithubPr — error handling", () => {
  it("surfaces a 401 github_token_required as GithubFetchError with the right discriminator and host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ error: "github_token_required", host: "github.com" }),
      }),
    );

    await expect(
      loadGithubPr("https://github.com/owner/repo/pull/1"),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof GithubFetchError)) return false;
      return (
        err.discriminator === "github_token_required" &&
        err.host === "github.com"
      );
    });
  });

  it("does NOT throw a plain Error for github_token_required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ error: "github_token_required", host: "github.com" }),
      }),
    );

    let thrown: unknown;
    try {
      await loadGithubPr("https://github.com/owner/repo/pull/1");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(GithubFetchError);
    // Specifically NOT a plain Error that isn't a GithubFetchError
    expect((thrown as GithubFetchError).discriminator).toBe(
      "github_token_required",
    );
  });

  it("surfaces github_auth_failed with host and hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            error: "github_auth_failed",
            host: "github.com",
            hint: "Check token scopes",
          }),
      }),
    );

    await expect(
      loadGithubPr("https://github.com/owner/repo/pull/1"),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof GithubFetchError)) return false;
      return (
        err.discriminator === "github_auth_failed" &&
        err.host === "github.com" &&
        err.hint === "Check token scopes"
      );
    });
  });

  it("returns the changeset, prInteractions, and prDetached on a 200 response", async () => {
    const fakeCs = { id: "pr:github.com:owner:repo:1", title: "Fix bug" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ changeSet: fakeCs, prInteractions: {}, prDetached: [] }),
      }),
    );

    const result = await loadGithubPr("https://github.com/owner/repo/pull/1");
    expect(result.changeSet).toEqual(fakeCs);
    expect(result.prInteractions).toEqual({});
    expect(result.prDetached).toEqual([]);
  });

  it("defaults prInteractions and prDetached when the server omits them", async () => {
    const fakeCs = { id: "pr:github.com:owner:repo:1", title: "Fix bug" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ changeSet: fakeCs }),
      }),
    );

    const result = await loadGithubPr("https://github.com/owner/repo/pull/1");
    expect(result.prInteractions).toEqual({});
    expect(result.prDetached).toEqual([]);
  });

  it("throws invalid_pr_url for an empty URL", async () => {
    await expect(loadGithubPr("  ")).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof GithubFetchError)) return false;
      return err.discriminator === "invalid_pr_url";
    });
  });
});
