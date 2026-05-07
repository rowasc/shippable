// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Welcome } from "./Welcome";

afterEach(() => {
  cleanup();
  isTauriMock.mockReturnValue(false);
  keychainGetMock.mockResolvedValue(null);
  setGithubTokenMock.mockResolvedValue(undefined);
});

const { loadGithubPrMock, setGithubTokenMock } = vi.hoisted(() => ({
  loadGithubPrMock: vi.fn(),
  setGithubTokenMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../githubPrClient", () => ({
  loadGithubPr: loadGithubPrMock,
  setGithubToken: setGithubTokenMock,
  GithubFetchError: class GithubFetchError extends Error {
    discriminator: string;
    host?: string;
    hint?: string;
    constructor(discriminator: string, message: string, host?: string, hint?: string) {
      super(message);
      this.name = "GithubFetchError";
      this.discriminator = discriminator;
      this.host = host;
      this.hint = hint;
    }
  },
  GH_ERROR_MESSAGES: {
    github_pr_not_found: "PR not found.",
    github_upstream: "GitHub returned an error. Try again.",
    invalid_pr_url: "That doesn't look like a valid PR URL.",
    unknown: "Something went wrong loading the PR.",
  },
}));

const { isTauriMock, keychainGetMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  keychainGetMock: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
}));

vi.mock("../keychain", () => ({
  isTauri: isTauriMock,
  keychainGet: keychainGetMock,
  keychainSet: vi.fn().mockResolvedValue(undefined),
}));

// Disable worktree / server-backed sections for cleaner tests.
vi.mock("../useWorktreeLoader", () => ({
  useWorktreeLoader: () => ({
    serverAvailable: false,
    wtDir: "",
    setWtDir: vi.fn(),
    wtBusy: false,
    wtPickerBusy: false,
    wtList: null,
    wtLoadingPath: null,
    err: null,
    showManualPath: false,
    setShowManualPath: vi.fn(),
    pickDirectory: vi.fn(),
    scanWorktrees: vi.fn(),
    loadFromWorktree: vi.fn(),
  }),
}));

function renderWelcome(onLoad = vi.fn(), onRecentsChange = vi.fn()) {
  return render(
    <Welcome recents={[]} onLoad={onLoad} onRecentsChange={onRecentsChange} />,
  );
}

describe("Welcome — GitHub PR section", () => {
  it("renders the 'From a GitHub PR' section", () => {
    renderWelcome();
    expect(screen.getByText(/from a github pr/i)).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i),
    ).toBeTruthy();
  });

  it("calls loadGithubPr with the entered URL on submit", async () => {
    const fakeCs = {
      id: "pr:github.com:owner:repo:1",
      title: "Fix bug",
      files: [],
    };
    loadGithubPrMock.mockResolvedValue(fakeCs);
    const onLoad = vi.fn();

    renderWelcome(onLoad);

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });

    const button = screen.getByRole("button", { name: /load pr/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(loadGithubPrMock).toHaveBeenCalledWith(
        "https://github.com/owner/repo/pull/1",
      ),
    );
    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        {},
        expect.objectContaining({ kind: "pr", prUrl: "https://github.com/owner/repo/pull/1" }),
      ),
    );
  });

  it("opens the token modal when loadGithubPr throws github_token_required", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_token_required", "github_token_required", "github.com"),
    );

    renderWelcome();

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /load pr/i }));

    await waitFor(() =>
      expect(screen.getByText(/needs a GitHub Personal Access Token/i)).toBeTruthy(),
    );
  });

  it("calls onLoad with pr source on successful load", async () => {
    const fakeCs = {
      id: "pr:github.com:owner:repo:42",
      title: "My PR",
      files: [{ path: "foo.ts", hunks: [] }],
    };
    loadGithubPrMock.mockResolvedValue(fakeCs);
    const onLoad = vi.fn();

    renderWelcome(onLoad);

    fireEvent.change(
      screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i),
      { target: { value: "https://github.com/owner/repo/pull/42" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /load pr/i }));

    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        {},
        { kind: "pr", prUrl: "https://github.com/owner/repo/pull/42" },
      ),
    );
  });

  it("does not open the token modal when Tauri Keychain has a cached token (rehydrate path)", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    const fakeCs = { id: "pr:github.com:owner:repo:1", title: "Test", files: [] };
    loadGithubPrMock
      .mockRejectedValueOnce(
        new GithubFetchError("github_token_required", "github_token_required", "github.com"),
      )
      .mockResolvedValueOnce(fakeCs);
    isTauriMock.mockReturnValue(true);
    keychainGetMock.mockResolvedValue("ghp_cached_token");

    const onLoad = vi.fn();
    renderWelcome(onLoad);

    const input = screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i);
    fireEvent.change(input, { target: { value: "https://github.com/owner/repo/pull/1" } });
    fireEvent.click(screen.getByRole("button", { name: /load pr/i }));

    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        {},
        expect.objectContaining({ kind: "pr" }),
      ),
    );
    expect(screen.queryByText(/needs a GitHub Personal Access Token/i)).toBeNull();
    expect(setGithubTokenMock).toHaveBeenCalledWith("github.com", "ghp_cached_token");
  });

  it("renders an inline error for github_pr_not_found", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_pr_not_found", "github_pr_not_found"),
    );

    renderWelcome();

    fireEvent.change(
      screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i),
      { target: { value: "https://github.com/owner/repo/pull/9999" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /load pr/i }));

    await waitFor(() =>
      expect(screen.getByText("PR not found.")).toBeTruthy(),
    );
  });
});
