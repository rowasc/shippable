import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProxyAgent } from "undici";
import { getDispatcher, __resetDispatcherForTests } from "./proxy.ts";

const ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"] as const;

function clearProxyEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  __resetDispatcherForTests();
  clearProxyEnv();
});

afterEach(() => {
  clearProxyEnv();
  __resetDispatcherForTests();
  vi.restoreAllMocks();
});

describe("getDispatcher", () => {
  it("returns undefined when no env vars are set", () => {
    expect(getDispatcher()).toBeUndefined();
    expect(getDispatcher("github.com")).toBeUndefined();
  });

  it("returns a ProxyAgent when HTTPS_PROXY is set", () => {
    process.env.HTTPS_PROXY = "http://example.com:3128";
    const dispatcher = getDispatcher();
    expect(dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it("honors lower-case https_proxy", () => {
    process.env.https_proxy = "http://example.com:3128";
    const dispatcher = getDispatcher();
    expect(dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it("returns undefined and does not throw on a malformed URL", () => {
    process.env.HTTPS_PROXY = "::not a url::";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => getDispatcher()).not.toThrow();
    expect(getDispatcher()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("NO_PROXY exact match returns undefined; other hosts still get the agent", () => {
    process.env.HTTPS_PROXY = "http://example.com:3128";
    process.env.NO_PROXY = "foo.example.com";
    expect(getDispatcher("foo.example.com")).toBeUndefined();
    expect(getDispatcher("github.com")).toBeInstanceOf(ProxyAgent);
  });

  it("NO_PROXY .suffix match", () => {
    process.env.HTTPS_PROXY = "http://example.com:3128";
    process.env.NO_PROXY = ".internal.example";
    expect(getDispatcher("api.internal.example")).toBeUndefined();
    expect(getDispatcher("github.com")).toBeInstanceOf(ProxyAgent);
  });

  it("memoizes the dispatcher across calls", () => {
    process.env.HTTPS_PROXY = "http://example.com:3128";
    const a = getDispatcher();
    const b = getDispatcher();
    expect(a).toBe(b);
  });
});
