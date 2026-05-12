// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { CredentialsProvider, useCredentials } from "./useCredentials";
import type { Credential } from "./credential";

vi.mock("./client", () => ({
  authSet: vi.fn(),
  authClear: vi.fn(),
  authList: vi.fn(),
}));

vi.mock("../keychain", () => ({
  isTauri: vi.fn(),
  keychainGet: vi.fn(),
  keychainSet: vi.fn(),
  keychainRemove: vi.fn(),
}));

vi.mock("../githubHostTrust", () => ({
  readTrustedGithubHosts: vi.fn(() => []),
}));

import * as client from "./client";
import * as keychain from "../keychain";
import * as hostTrust from "../githubHostTrust";

const SKIP_KEY = "shippable:anthropic:skip";

function renderHook() {
  const recorded: { value: ReturnType<typeof useCredentials> | null } = {
    value: null,
  };
  function Probe() {
    recorded.value = useCredentials();
    return null;
  }
  render(
    <CredentialsProvider>
      <Probe />
    </CredentialsProvider>,
  );
  return recorded;
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(client.authList).mockResolvedValue([]);
  vi.mocked(client.authSet).mockResolvedValue();
  vi.mocked(client.authClear).mockResolvedValue();
  vi.mocked(keychain.isTauri).mockReturnValue(false);
  vi.mocked(keychain.keychainGet).mockResolvedValue(null);
  vi.mocked(keychain.keychainSet).mockResolvedValue();
  vi.mocked(keychain.keychainRemove).mockResolvedValue();
  vi.mocked(hostTrust.readTrustedGithubHosts).mockReturnValue([]);
});

afterEach(() => cleanup());

describe("useCredentials initial state", () => {
  it("loads the list from authList on mount", async () => {
    const list: Credential[] = [
      { kind: "anthropic" },
      { kind: "github", host: "github.com" },
    ];
    vi.mocked(client.authList).mockResolvedValue(list);
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    expect(hook.value?.list).toEqual(list);
  });

  it("reports anthropicSkipped from localStorage", async () => {
    window.localStorage.setItem(SKIP_KEY, "true");
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    expect(hook.value?.anthropicSkipped).toBe(true);
  });
});

describe("rehydrate (Tauri)", () => {
  it("reads anthropic and trusted github hosts from Keychain and forwards hits to authSet", async () => {
    vi.mocked(keychain.isTauri).mockReturnValue(true);
    vi.mocked(hostTrust.readTrustedGithubHosts).mockReturnValue([
      "ghe.example.com",
    ]);
    vi.mocked(keychain.keychainGet).mockImplementation(async (account) => {
      if (account === "ANTHROPIC_API_KEY") return "sk-cached";
      if (account === "GITHUB_TOKEN:github.com") return "ghp_cached";
      return null;
    });
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.rehydrate();
    });
    expect(client.authSet).toHaveBeenCalledWith(
      { kind: "anthropic" },
      "sk-cached",
    );
    expect(client.authSet).toHaveBeenCalledWith(
      { kind: "github", host: "github.com" },
      "ghp_cached",
    );
    // ghe.example.com missed → no authSet for that host.
    expect(client.authSet).not.toHaveBeenCalledWith(
      { kind: "github", host: "ghe.example.com" },
      expect.any(String),
    );
  });

  it("is a no-op in non-Tauri mode", async () => {
    vi.mocked(keychain.isTauri).mockReturnValue(false);
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.rehydrate();
    });
    expect(keychain.keychainGet).not.toHaveBeenCalled();
    expect(client.authSet).not.toHaveBeenCalled();
  });
});

describe("set", () => {
  it("calls keychainSet and authSet in Tauri mode and refreshes the list", async () => {
    vi.mocked(keychain.isTauri).mockReturnValue(true);
    vi.mocked(client.authList)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ kind: "anthropic" }]);
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.set({ kind: "anthropic" }, "sk-new");
    });
    expect(keychain.keychainSet).toHaveBeenCalledWith(
      "ANTHROPIC_API_KEY",
      "sk-new",
    );
    expect(client.authSet).toHaveBeenCalledWith(
      { kind: "anthropic" },
      "sk-new",
    );
    expect(hook.value?.list).toEqual([{ kind: "anthropic" }]);
  });

  it("does not call keychainSet in non-Tauri mode but still calls authSet", async () => {
    vi.mocked(keychain.isTauri).mockReturnValue(false);
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.set({ kind: "github", host: "github.com" }, "ghp_x");
    });
    expect(keychain.keychainSet).not.toHaveBeenCalled();
    expect(client.authSet).toHaveBeenCalled();
  });

  it("clears the anthropic skip flag when setting an anthropic credential", async () => {
    window.localStorage.setItem(SKIP_KEY, "true");
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.set({ kind: "anthropic" }, "sk-new");
    });
    expect(window.localStorage.getItem(SKIP_KEY)).toBeNull();
    expect(hook.value?.anthropicSkipped).toBe(false);
  });
});

describe("clear", () => {
  it("calls keychainRemove and authClear in Tauri mode and refreshes the list", async () => {
    vi.mocked(keychain.isTauri).mockReturnValue(true);
    vi.mocked(client.authList)
      .mockResolvedValueOnce([{ kind: "anthropic" }])
      .mockResolvedValueOnce([]);
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.clear({ kind: "anthropic" });
    });
    expect(keychain.keychainRemove).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
    expect(client.authClear).toHaveBeenCalledWith({ kind: "anthropic" });
    expect(hook.value?.list).toEqual([]);
  });

  it("does not call keychainRemove in non-Tauri mode but still calls authClear", async () => {
    vi.mocked(keychain.isTauri).mockReturnValue(false);
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    await act(async () => {
      await hook.value!.clear({ kind: "github", host: "github.com" });
    });
    expect(keychain.keychainRemove).not.toHaveBeenCalled();
    expect(client.authClear).toHaveBeenCalled();
  });
});

describe("skipAnthropic", () => {
  it("writes the skip flag and updates anthropicSkipped", async () => {
    const hook = renderHook();
    await waitFor(() => expect(hook.value?.status).toBe("ready"));
    act(() => {
      hook.value!.skipAnthropic();
    });
    expect(window.localStorage.getItem(SKIP_KEY)).toBe("true");
    expect(hook.value?.anthropicSkipped).toBe(true);
  });
});
