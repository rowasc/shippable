// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authSet, authClear, authList, AuthClientError } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("authSet", () => {
  it("POSTs the credential and value to /api/auth/set", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await authSet({ kind: "anthropic" }, "sk-test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/set$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ credential: { kind: "anthropic" }, value: "sk-test" });
  });

  it("throws AuthClientError on non-2xx with a discriminator", async () => {
    vi.stubGlobal("fetch", mockFetch(400, { error: "host_blocked" }));
    await expect(
      authSet({ kind: "github", host: "localhost" }, "x"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof AuthClientError && e.discriminator === "host_blocked",
    );
  });
});

describe("authClear", () => {
  it("POSTs the credential to /api/auth/clear", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await authClear({ kind: "github", host: "github.com" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/clear$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      credential: { kind: "github", host: "github.com" },
    });
  });
});

describe("authList", () => {
  it("GETs /api/auth/list and returns the credentials array", async () => {
    const credentials = [
      { kind: "anthropic" },
      { kind: "github", host: "github.com" },
    ];
    vi.stubGlobal("fetch", mockFetch(200, { credentials }));
    expect(await authList()).toEqual(credentials);
  });

  it("throws AuthClientError when the response is missing the credentials array", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    await expect(authList()).rejects.toBeInstanceOf(AuthClientError);
  });
});
