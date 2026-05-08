import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, postJson } from "./apiClient";

function fetchReturning(
  status: number,
  body: unknown,
): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("apiClient — request shape", () => {
  // Guards against an accidental refactor that drops JSON.stringify or the
  // Content-Type header — would silently send "[object Object]" through the
  // 15 migrated call sites, which the server would reject in confusing ways.
  it("postJson sends POST with Content-Type: application/json and a serialised body", async () => {
    const fetch = fetchReturning(200, { ok: true });
    vi.stubGlobal("fetch", fetch);
    await postJson("/api/x", { a: 1, b: "two" });
    const [, init] = fetch.mock.calls[0]!;
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({ a: 1, b: "two" });
  });
});

describe("apiClient — error envelope", () => {
  it("throws ApiError using the envelope's error string even when status is 2xx", async () => {
    // The server occasionally returns 200 with { error } — the original
    // hand-written pattern honoured this, and call sites depend on it.
    vi.stubGlobal("fetch", fetchReturning(200, { error: "soft fail" }));
    await expect(postJson("/api/x", {})).rejects.toMatchObject({
      name: "ApiError",
      message: "soft fail",
      status: 200,
    });
  });

  it("throws ApiError with the envelope message in preference to the HTTP code", async () => {
    vi.stubGlobal("fetch", fetchReturning(503, { error: "no anthropic key" }));
    await expect(postJson("/api/x", {})).rejects.toMatchObject({
      message: "no anthropic key",
      status: 503,
    });
  });

  it("throws ApiError with HTTP <status> when no envelope is present", async () => {
    vi.stubGlobal("fetch", fetchReturning(500, { unrelated: "shape" }));
    await expect(postJson("/api/x", {})).rejects.toMatchObject({
      message: "HTTP 500",
      status: 500,
    });
  });

  it("ApiError is an Error subclass with status preserved", async () => {
    vi.stubGlobal("fetch", fetchReturning(429, { error: "slow down" }));
    try {
      await postJson("/api/x", {});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(429);
      expect((e as ApiError).name).toBe("ApiError");
    }
  });
});
